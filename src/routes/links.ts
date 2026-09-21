import { Env, Link, CreateLinkRequest, UpdateLinkRequest, BulkLinksRequest } from '../types';
import { processLink } from '../services/processor';

const MAX_TAG_LENGTH = 40;
const MAX_TAGS_PER_LINK = 12;
const MAX_BULK_IDS = 100;

export async function handleLinkRoutes(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (method === 'GET' && path === '/api/links') {
    return getLinks(env, url);
  }

  if (method === 'GET' && path === '/api/tags') {
    return getTags(env);
  }

  if (method === 'POST' && path === '/api/links/bulk') {
    return bulkLinks(request, env);
  }

  if (method === 'GET' && path.match(/^\/api\/links\/[^\/]+$/)) {
    const id = path.split('/')[3];
    return getLink(env, id);
  }

  if (method === 'POST' && path === '/api/links') {
    return createLink(request, env, ctx);
  }

  if (method === 'PUT' && path.match(/^\/api\/links\/[^\/]+$/)) {
    const id = path.split('/')[3];
    return updateLink(request, env, id);
  }

  if (method === 'DELETE' && path.match(/^\/api\/links\/[^\/]+$/)) {
    const id = path.split('/')[3];
    return deleteLink(env, id);
  }

  if (method === 'POST' && path.match(/^\/api\/links\/[^\/]+\/reprocess$/)) {
    const id = path.split('/')[3];
    return reprocessLink(env, ctx, id);
  }

  if (method === 'POST' && path === '/api/process-all') {
    return processAllLinks(env, ctx);
  }

  if (method === 'POST' && path === '/api/resummarize-all') {
    return resummarizeAllLinks(env);
  }

  if (method === 'GET' && path === '/api/stats') {
    return getStats(env);
  }

  if (method === 'GET' && path === '/api/export') {
    return exportLinks(env);
  }

  return new Response('Not Found', { status: 404 });
}

function normalizeTag(raw: string): string | null {
  const tag = raw.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9._-]/g, '');
  if (!tag || tag.length > MAX_TAG_LENGTH) return null;
  return tag;
}

function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const value of raw) {
    if (typeof value !== 'string') continue;
    const tag = normalizeTag(value);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
    if (tags.length >= MAX_TAGS_PER_LINK) break;
  }
  return tags;
}

async function attachTagsAndStatus(env: Env, links: Link[]): Promise<Link[]> {
  if (links.length === 0) return links;

  const ids = links.map(link => link.id);
  const placeholders = ids.map(() => '?').join(',');

  const [tagResult, queueResult] = await env.DB.batch([
    env.DB.prepare(
      `SELECT link_id, tag FROM link_tags WHERE link_id IN (${placeholders}) ORDER BY tag`
    ).bind(...ids),
    env.DB.prepare(
      `SELECT link_id, status, error_message FROM processing_queue WHERE link_id IN (${placeholders})`
    ).bind(...ids),
  ]);

  const tagsByLink = new Map<string, string[]>();
  for (const row of (tagResult as D1Result<{ link_id: string; tag: string }>).results) {
    const current = tagsByLink.get(row.link_id) ?? [];
    current.push(row.tag);
    tagsByLink.set(row.link_id, current);
  }

  const queueByLink = new Map<string, { status: Link['processing_status']; error: string | null }>();
  for (const row of (queueResult as D1Result<{ link_id: string; status: NonNullable<Link['processing_status']>; error_message: string | null }>).results) {
    queueByLink.set(row.link_id, { status: row.status, error: row.error_message });
  }

  return links.map(link => {
    const queue = queueByLink.get(link.id);
    return {
      ...link,
      starred: Number(link.starred) || 0,
      is_pdf: Number(link.is_pdf) || 0,
      tags: tagsByLink.get(link.id) ?? [],
      processing_status: queue?.status ?? null,
      processing_error: queue?.error ?? null,
    };
  });
}

async function replaceTags(env: Env, linkId: string, tags: string[]): Promise<void> {
  const statements = [
    env.DB.prepare('DELETE FROM link_tags WHERE link_id = ?').bind(linkId),
    ...tags.map(tag =>
      env.DB.prepare('INSERT INTO link_tags (link_id, tag) VALUES (?, ?)').bind(linkId, tag)
    ),
  ];
  await env.DB.batch(statements);
}

async function getLinks(env: Env, url: URL): Promise<Response> {
  const params = url.searchParams;
  const status = params.get('status');
  const search = params.get('search');
  const tag = params.get('tag');
  const starred = params.get('starred');
  const failed = params.get('failed');

  const rawLimit  = parseInt(params.get('limit')  ?? '', 10);
  const rawOffset = parseInt(params.get('offset') ?? '', 10);
  const limit  = Number.isFinite(rawLimit)  && rawLimit  > 0 ? Math.min(rawLimit,  200) : 50;
  const offset = Number.isFinite(rawOffset) && rawOffset >= 0 ? rawOffset : 0;

  let query      = 'SELECT links.* FROM links WHERE 1=1';
  let countQuery = 'SELECT COUNT(*) as count FROM links WHERE 1=1';
  const bindings:      (string | number | null)[] = [];
  const countBindings: (string | number | null)[] = [];

  if (status === 'read' || status === 'unread') {
    query      += ' AND links.status = ?';
    countQuery += ' AND links.status = ?';
    bindings.push(status);
    countBindings.push(status);
  }

  if (starred === '1' || starred === 'true') {
    query      += ' AND links.starred = 1';
    countQuery += ' AND links.starred = 1';
  }

  if (failed === '1' || failed === 'true') {
    const clause = ` AND EXISTS (
      SELECT 1 FROM processing_queue pq
      WHERE pq.link_id = links.id AND pq.status = 'failed'
    )`;
    query      += clause;
    countQuery += clause;
  }

  if (tag) {
    const normalized = normalizeTag(tag);
    if (normalized) {
      const clause = ' AND EXISTS (SELECT 1 FROM link_tags lt WHERE lt.link_id = links.id AND lt.tag = ?)';
      query      += clause;
      countQuery += clause;
      bindings.push(normalized);
      countBindings.push(normalized);
    }
  }

  if (search) {
    const clause = ` AND (
      links.title LIKE ? OR links.url LIKE ? OR links.ai_summary LIKE ?
      OR EXISTS (SELECT 1 FROM link_tags lt WHERE lt.link_id = links.id AND lt.tag LIKE ?)
    )`;
    query      += clause;
    countQuery += clause;
    const searchPattern = `%${search}%`;
    bindings.push(searchPattern, searchPattern, searchPattern, searchPattern);
    countBindings.push(searchPattern, searchPattern, searchPattern, searchPattern);
  }

  query += ' ORDER BY links.created_at DESC LIMIT ? OFFSET ?';
  bindings.push(limit, offset);

  const [dataResult, countResult] = await env.DB.batch([
    env.DB.prepare(query).bind(...bindings),
    env.DB.prepare(countQuery).bind(...countBindings),
  ]);

  const rawLinks = (dataResult as D1Result<Link>).results;
  const total = ((countResult as D1Result<{ count: number }>).results[0]?.count) ?? 0;
  const links = await attachTagsAndStatus(env, rawLinks);

  return new Response(JSON.stringify({ links, total, limit, offset }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

async function getLink(env: Env, id: string): Promise<Response> {
  const link = await env.DB.prepare('SELECT * FROM links WHERE id = ?').bind(id).first<Link>();

  if (!link) {
    return new Response(JSON.stringify({ error: 'Link not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const [enriched] = await attachTagsAndStatus(env, [link]);

  return new Response(JSON.stringify(enriched), {
    headers: { 'Content-Type': 'application/json' }
  });
}

async function getTags(env: Env): Promise<Response> {
  const result = await env.DB.prepare(
    'SELECT tag, COUNT(*) AS count FROM link_tags GROUP BY tag ORDER BY count DESC, tag ASC'
  ).all<{ tag: string; count: number }>();

  return new Response(JSON.stringify({ tags: result.results }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

async function createLink(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body: CreateLinkRequest = await request.json();

  if (!body.url) {
    return new Response(JSON.stringify({ error: 'URL is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    new URL(body.url);
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid URL' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const id = crypto.randomUUID();

  try {
    await env.DB.prepare(
      'INSERT INTO links (id, url, title, status) VALUES (?, ?, ?, ?)'
    ).bind(id, body.url, body.title || null, 'unread').run();
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('UNIQUE constraint failed')) {
      return new Response(JSON.stringify({ error: 'URL already exists' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    throw error;
  }

  try {
    await env.LINK_QUEUE.send({ linkId: id });
  } catch (queueError: unknown) {
    console.error(JSON.stringify({
      msg: 'queue_send_error',
      linkId: id,
      error: queueError instanceof Error ? queueError.message : String(queueError),
    }));
  }

  const link = await env.DB.prepare('SELECT * FROM links WHERE id = ?').bind(id).first<Link>();
  const [enriched] = await attachTagsAndStatus(env, link ? [link] : []);

  return new Response(JSON.stringify(enriched), {
    status: 201,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function updateLink(request: Request, env: Env, id: string): Promise<Response> {
  const body: UpdateLinkRequest = await request.json();

  const existing = await env.DB.prepare('SELECT * FROM links WHERE id = ?').bind(id).first<Link>();
  if (!existing) {
    return new Response(JSON.stringify({ error: 'Link not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const updates: string[] = ['updated_at = CURRENT_TIMESTAMP'];
  const bindings: (string | number | null)[] = [];

  if (body.status) {
    updates.push('status = ?');
    bindings.push(body.status);
  }

  if (body.title !== undefined) {
    updates.push('title = ?');
    bindings.push(body.title);
  }

  if (body.starred !== undefined) {
    updates.push('starred = ?');
    bindings.push(body.starred ? 1 : 0);
  }

  const hasTags = Array.isArray(body.tags);
  if (updates.length === 1 && !hasTags) {
    return new Response(JSON.stringify({ error: 'No valid updates provided' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (updates.length > 1) {
    bindings.push(id);
    await env.DB.prepare(
      `UPDATE links SET ${updates.join(', ')} WHERE id = ?`
    ).bind(...bindings).run();
  }

  if (hasTags) {
    await replaceTags(env, id, normalizeTags(body.tags));
  }

  const updated = await env.DB.prepare('SELECT * FROM links WHERE id = ?').bind(id).first<Link>();
  const [enriched] = await attachTagsAndStatus(env, updated ? [updated] : []);

  return new Response(JSON.stringify(enriched), {
    headers: { 'Content-Type': 'application/json' }
  });
}

async function deleteLink(env: Env, id: string): Promise<Response> {
  const existing = await env.DB.prepare('SELECT * FROM links WHERE id = ?').bind(id).first<Link>();

  if (!existing) {
    return new Response(JSON.stringify({ error: 'Link not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  await env.DB.prepare('DELETE FROM links WHERE id = ?').bind(id).run();

  return new Response(null, { status: 204 });
}

async function bulkLinks(request: Request, env: Env): Promise<Response> {
  const body: BulkLinksRequest = await request.json();
  const ids = Array.isArray(body.ids)
    ? [...new Set(body.ids.filter((id): id is string => typeof id === 'string' && id.length > 0))]
    : [];

  if (ids.length === 0) {
    return new Response(JSON.stringify({ error: 'ids are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (ids.length > MAX_BULK_IDS) {
    return new Response(JSON.stringify({ error: `At most ${MAX_BULK_IDS} ids allowed` }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const placeholders = ids.map(() => '?').join(',');

  switch (body.action) {
    case 'read':
    case 'unread':
      await env.DB.prepare(
        `UPDATE links SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`
      ).bind(body.action, ...ids).run();
      break;
    case 'star':
    case 'unstar':
      await env.DB.prepare(
        `UPDATE links SET starred = ?, updated_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`
      ).bind(body.action === 'star' ? 1 : 0, ...ids).run();
      break;
    case 'delete':
      await env.DB.prepare(`DELETE FROM links WHERE id IN (${placeholders})`).bind(...ids).run();
      break;
    case 'resummarize': {
      const eligible = await env.DB.prepare(
        `SELECT id FROM links
         WHERE id IN (${placeholders})
           AND markdown_content IS NOT NULL
           AND length(markdown_content) >= 100`
      ).bind(...ids).all<{ id: string }>();
      const batch = eligible.results.map(link => ({
        body: { linkId: link.id, resummarize: true },
      }));
      if (batch.length > 0) {
        await env.LINK_QUEUE.sendBatch(batch);
      }
      return new Response(JSON.stringify({ updated: batch.length, action: body.action }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }
    default:
      return new Response(JSON.stringify({ error: 'Invalid action' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
  }

  return new Response(JSON.stringify({ updated: ids.length, action: body.action }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

async function reprocessLink(env: Env, ctx: ExecutionContext, id: string): Promise<Response> {
  const existing = await env.DB.prepare('SELECT * FROM links WHERE id = ?').bind(id).first<Link>();

  if (!existing) {
    return new Response(JSON.stringify({ error: 'Link not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  await env.DB.prepare(
    'UPDATE links SET markdown_content = NULL, ai_summary = NULL, scraped_at = NULL WHERE id = ?'
  ).bind(id).run();

  await env.LINK_QUEUE.send({ linkId: id });

  return new Response(JSON.stringify({ message: 'Reprocessing queued' }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

async function getStats(env: Env): Promise<Response> {
  const result = await env.DB.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'unread' THEN 1 ELSE 0 END) AS unread,
      SUM(CASE WHEN status = 'read'   THEN 1 ELSE 0 END) AS read,
      SUM(CASE WHEN starred = 1 THEN 1 ELSE 0 END) AS starred,
      SUM(CASE WHEN scraped_at IS NOT NULL OR metadata_extracted_at IS NOT NULL THEN 1 ELSE 0 END) AS processed
    FROM links
  `).first<{ total: number; unread: number; read: number; starred: number; processed: number }>();

  return new Response(JSON.stringify({
    total:     result?.total     ?? 0,
    unread:    result?.unread    ?? 0,
    read:      result?.read      ?? 0,
    starred:   result?.starred   ?? 0,
    processed: result?.processed ?? 0,
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}

async function exportLinks(env: Env): Promise<Response> {
  const [linksResult, tagsResult] = await env.DB.batch([
    env.DB.prepare(`
      SELECT
        id, url, title, description, author, site_name, published_date,
        image_url, favicon_url, content_type, status, reading_time_minutes,
        created_at, updated_at, metadata_extracted_at, scraped_at, domain,
        starred, is_pdf
      FROM links
      ORDER BY created_at DESC
    `),
    env.DB.prepare('SELECT link_id, tag FROM link_tags ORDER BY tag'),
  ]);

  const tagsByLink = new Map<string, string[]>();
  for (const row of (tagsResult as D1Result<{ link_id: string; tag: string }>).results) {
    const current = tagsByLink.get(row.link_id) ?? [];
    current.push(row.tag);
    tagsByLink.set(row.link_id, current);
  }

  const payload = (linksResult as D1Result<Link>).results.map(link => ({
    ...link,
    tags: tagsByLink.get(link.id) ?? [],
  }));

  return new Response(JSON.stringify(payload, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="links-export.json"',
    },
  });
}

async function resummarizeAllLinks(env: Env): Promise<Response> {
  const links = await env.DB.prepare(
    `SELECT id FROM links
     WHERE markdown_content IS NOT NULL
       AND length(markdown_content) >= 100`
  ).all<{ id: string }>();

  const ids = links.results.map(link => link.id);
  const BATCH = 100;

  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH).map(id => ({
      body: { linkId: id, resummarize: true },
    }));
    await env.LINK_QUEUE.sendBatch(batch);
  }

  return new Response(JSON.stringify({
    message: `Queued ${ids.length} links for re-summarization`,
    queued: ids.length,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

async function processAllLinks(env: Env, ctx: ExecutionContext): Promise<Response> {
  const unprocessed = await env.DB.prepare(
    'SELECT id FROM links WHERE metadata_extracted_at IS NULL OR scraped_at IS NULL'
  ).all<{ id: string }>();

  const promises = unprocessed.results.map(link =>
    processLink(link.id, env, ctx).catch(err => {
      console.error(`Failed to process ${link.id}:`, err);
      return { id: link.id, error: err.message };
    })
  );

  ctx.waitUntil(Promise.all(promises));

  return new Response(JSON.stringify({
    message: `Processing ${unprocessed.results.length} links in background`
  }), {
    headers: { 'Content-Type': 'application/json' }
  });
}
