import { McpServer } from '@modelcontextprotocol/server';
import { createMcpHandler } from 'agents/mcp/server';
import { z } from 'zod';
import { Env, Link } from './types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeTag(raw: string): string | null {
  const tag = raw.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9._-]/g, '');
  if (!tag || tag.length > 40) return null;
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
    if (tags.length >= 12) break;
  }
  return tags;
}

async function attachTags(env: Env, links: Link[]): Promise<Link[]> {
  if (links.length === 0) return links;
  const ids = links.map(l => l.id);
  const placeholders = ids.map(() => '?').join(',');
  const tagResult = await env.DB.prepare(
    `SELECT link_id, tag FROM link_tags WHERE link_id IN (${placeholders}) ORDER BY tag`
  ).bind(...ids).all<{ link_id: string; tag: string }>();

  const tagsByLink = new Map<string, string[]>();
  for (const row of tagResult.results) {
    const current = tagsByLink.get(row.link_id) ?? [];
    current.push(row.tag);
    tagsByLink.set(row.link_id, current);
  }
  return links.map(l => ({ ...l, tags: tagsByLink.get(l.id) ?? [] }));
}

function linkToText(link: Link): string {
  const parts: string[] = [];
  parts.push(`ID: ${link.id}`);
  parts.push(`URL: ${link.url}`);
  if (link.title) parts.push(`Title: ${link.title}`);
  if (link.description) parts.push(`Description: ${link.description}`);
  if (link.author) parts.push(`Author: ${link.author}`);
  if (link.site_name) parts.push(`Site: ${link.site_name}`);
  if (link.published_date) parts.push(`Published: ${link.published_date}`);
  parts.push(`Status: ${link.status}`);
  parts.push(`Starred: ${link.starred ? 'yes' : 'no'}`);
  if (link.reading_time_minutes) parts.push(`Reading time: ${link.reading_time_minutes} min`);
  if (link.tags && link.tags.length > 0) parts.push(`Tags: ${link.tags.join(', ')}`);
  parts.push(`Added: ${link.created_at}`);
  return parts.join('\n');
}

// ── Server factory ────────────────────────────────────────────────────────────

function createServer(env: Env): McpServer {
  const server = new McpServer({ name: 'links', version: '1.0.0' });

  // ── search_links ────────────────────────────────────────────────────────────
  server.registerTool(
    'search_links',
    {
      description:
        'Search and filter saved links. Returns matching links with metadata. Use get_link to fetch full article content.',
      inputSchema: {
        query: z.string().optional().describe('Full-text search across title, URL, summary, and tags'),
        status: z.enum(['read', 'unread']).optional().describe('Filter by read status'),
        tag: z.string().optional().describe('Filter by a specific tag'),
        starred: z.boolean().optional().describe('If true, only return starred links'),
        limit: z.number().int().min(1).max(50).default(20).describe('Max results (default 20, max 50)'),
      },
    },
    async ({ query, status, tag, starred, limit }) => {
      let sql = 'SELECT l.* FROM links l WHERE 1=1';
      const params: unknown[] = [];

      if (status) { sql += ' AND l.status = ?'; params.push(status); }
      if (starred) { sql += ' AND l.starred = 1'; }
      if (tag) { sql += ' AND EXISTS (SELECT 1 FROM link_tags lt WHERE lt.link_id = l.id AND lt.tag = ?)'; params.push(normalizeTag(tag) ?? tag); }
      if (query) {
        sql += ' AND (l.title LIKE ? OR l.url LIKE ? OR l.ai_summary LIKE ? OR EXISTS (SELECT 1 FROM link_tags lt WHERE lt.link_id = l.id AND lt.tag LIKE ?))';
        const like = `%${query}%`;
        params.push(like, like, like, like);
      }
      sql += ' ORDER BY l.created_at DESC LIMIT ?';
      params.push(limit ?? 20);

      const result = await env.DB.prepare(sql).bind(...params).all<Link>();
      const links = await attachTags(env, result.results);

      if (links.length === 0) {
        return { content: [{ type: 'text', text: 'No links found matching your criteria.' }] };
      }
      return {
        content: [{ type: 'text', text: `Found ${links.length} link(s):\n\n${links.map(linkToText).join('\n\n---\n\n')}` }],
      };
    }
  );

  // ── get_link ────────────────────────────────────────────────────────────────
  server.registerTool(
    'get_link',
    {
      description: 'Get a single saved link by ID, including the full article content and AI summary.',
      inputSchema: {
        id: z.string().describe('The link UUID'),
      },
    },
    async ({ id }) => {
      const link = await env.DB.prepare('SELECT * FROM links WHERE id = ?').bind(id).first<Link>();
      if (!link) {
        return { content: [{ type: 'text', text: `No link found with ID: ${id}` }], isError: true };
      }
      const [withTags] = await attachTags(env, [link]);
      const parts: string[] = [linkToText(withTags)];
      if (withTags.ai_summary) parts.push(`\n## Summary\n${withTags.ai_summary}`);
      if (withTags.markdown_content) parts.push(`\n## Article Content\n${withTags.markdown_content}`);
      return { content: [{ type: 'text', text: parts.join('\n') }] };
    }
  );

  // ── save_link ───────────────────────────────────────────────────────────────
  server.registerTool(
    'save_link',
    {
      description:
        'Save a new URL to the read-it-later library. The link is fetched and processed asynchronously (metadata, article content, AI summary).',
      inputSchema: {
        url: z.string().url().describe('The URL to save'),
        title: z.string().optional().describe('Optional title override'),
      },
    },
    async ({ url, title }) => {
      let parsed: URL;
      try { parsed = new URL(url); } catch {
        return { content: [{ type: 'text', text: `Invalid URL: ${url}` }], isError: true };
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { content: [{ type: 'text', text: 'Only http and https URLs are supported.' }], isError: true };
      }

      const id = crypto.randomUUID();
      const domain = parsed.hostname;

      try {
        await env.DB.prepare(
          'INSERT INTO links (id, url, title, domain, status) VALUES (?, ?, ?, ?, ?)'
        ).bind(id, url, title ?? null, domain, 'unread').run();
      } catch (error: unknown) {
        if (error instanceof Error && error.message?.includes('UNIQUE constraint failed')) {
          const existing = await env.DB.prepare('SELECT id FROM links WHERE url = ?').bind(url).first<{ id: string }>();
          return { content: [{ type: 'text', text: `Link already saved with ID: ${existing?.id ?? 'unknown'}` }] };
        }
        return {
          content: [{ type: 'text', text: `Failed to save link: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }

      try { await env.LINK_QUEUE.send({ linkId: id }); } catch { /* non-fatal */ }

      return {
        content: [{ type: 'text', text: `Saved link with ID: ${id}\nURL: ${url}\nProcessing will complete in the background.` }],
      };
    }
  );

  // ── list_tags ───────────────────────────────────────────────────────────────
  server.registerTool(
    'list_tags',
    {
      description: 'List all tags in the library with the count of links per tag.',
    },
    async () => {
      const result = await env.DB.prepare(
        'SELECT tag, COUNT(*) as count FROM link_tags GROUP BY tag ORDER BY count DESC, tag ASC'
      ).all<{ tag: string; count: number }>();

      if (result.results.length === 0) {
        return { content: [{ type: 'text', text: 'No tags found.' }] };
      }
      return {
        content: [{ type: 'text', text: `Tags:\n\n${result.results.map(r => `${r.tag} (${r.count})`).join('\n')}` }],
      };
    }
  );

  // ── update_link ─────────────────────────────────────────────────────────────
  server.registerTool(
    'update_link',
    {
      description: 'Update a saved link: mark read/unread, star/unstar, or change tags.',
      inputSchema: {
        id: z.string().describe('The link UUID'),
        status: z.enum(['read', 'unread']).optional().describe('New read status'),
        starred: z.boolean().optional().describe('Star or unstar the link'),
        tags: z.array(z.string()).optional().describe('Replace the full tag list (max 12 tags)'),
      },
    },
    async ({ id, status, starred, tags }) => {
      const existing = await env.DB.prepare('SELECT id FROM links WHERE id = ?').bind(id).first<{ id: string }>();
      if (!existing) {
        return { content: [{ type: 'text', text: `No link found with ID: ${id}` }], isError: true };
      }

      const setClauses: string[] = ['updated_at = CURRENT_TIMESTAMP'];
      const params: unknown[] = [];

      if (status !== undefined) { setClauses.push('status = ?'); params.push(status); }
      if (starred !== undefined) { setClauses.push('starred = ?'); params.push(starred ? 1 : 0); }

      const statements: D1PreparedStatement[] = [];
      if (setClauses.length > 1) {
        statements.push(env.DB.prepare(`UPDATE links SET ${setClauses.join(', ')} WHERE id = ?`).bind(...params, id));
      }
      if (tags !== undefined) {
        const normalized = normalizeTags(tags);
        statements.push(env.DB.prepare('DELETE FROM link_tags WHERE link_id = ?').bind(id));
        for (const tag of normalized) {
          statements.push(env.DB.prepare('INSERT INTO link_tags (link_id, tag) VALUES (?, ?)').bind(id, tag));
        }
      }
      if (statements.length > 0) await env.DB.batch(statements);

      const changed: string[] = [];
      if (status !== undefined) changed.push(`status → ${status}`);
      if (starred !== undefined) changed.push(`starred → ${starred}`);
      if (tags !== undefined) changed.push(`tags → [${normalizeTags(tags).join(', ')}]`);

      return { content: [{ type: 'text', text: `Updated link ${id}:\n${changed.join('\n')}` }] };
    }
  );

  // ── delete_link ─────────────────────────────────────────────────────────────
  server.registerTool(
    'delete_link',
    {
      description: 'Permanently delete a saved link and all its associated data.',
      inputSchema: {
        id: z.string().describe('The link UUID to delete'),
      },
    },
    async ({ id }) => {
      const existing = await env.DB.prepare('SELECT id, url FROM links WHERE id = ?').bind(id).first<{ id: string; url: string }>();
      if (!existing) {
        return { content: [{ type: 'text', text: `No link found with ID: ${id}` }], isError: true };
      }
      await env.DB.prepare('DELETE FROM links WHERE id = ?').bind(id).run();
      return { content: [{ type: 'text', text: `Deleted link ${id} (${existing.url})` }] };
    }
  );

  return server;
}

// ── Export a factory that creates the per-request MCP handler ─────────────────
// env is not available at module scope in a Worker, so we build the handler
// lazily and cache it per-request via the env-closure pattern.

export function createMcpServerHandler(env: Env) {
  return createMcpHandler(
    () => createServer(env),
    {
      route: '/mcp',
      corsOptions: false, // Cloudflare Access protects the route at network level
    }
  );
}
