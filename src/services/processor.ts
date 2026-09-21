import { Env, Link } from '../types';
import { extractMetadataFromHtml, streamToString } from './metadata';
import { extractArticleContentFromHtml } from './scraper';
import { generateSummary } from './summarizer';
import { calculateReadingTime } from '../utils/reading-time';
import { MAX_BODY_BYTES } from '../utils/constants';

export async function resummarizeLink(linkId: string, env: Env): Promise<void> {
  const link = await env.DB.prepare(
    'SELECT id, title, markdown_content FROM links WHERE id = ?'
  ).bind(linkId).first<Pick<Link, 'id' | 'title' | 'markdown_content'>>();

  if (!link) {
    console.error(JSON.stringify({ msg: 'resummarize_link_not_found', linkId }));
    return;
  }

  if (!link.markdown_content || link.markdown_content.length < 100) {
    console.log(JSON.stringify({ msg: 'resummarize_skipped_no_content', linkId }));
    return;
  }

  console.log(JSON.stringify({ msg: 'resummarize_start', linkId }));
  const summary = await generateSummary(link.markdown_content, env, link.title);

  await env.DB.prepare(
    'UPDATE links SET ai_summary = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
  ).bind(summary, linkId).run();

  console.log(JSON.stringify({ msg: 'resummarize_done', linkId, hasSummary: Boolean(summary) }));
}

export async function processLink(linkId: string, env: Env, ctx: ExecutionContext): Promise<void> {
  console.log(JSON.stringify({ msg: 'processing_start', linkId }));

  // ── 1. Fetch the link record ─────────────────────────────────────────────
  const link = await env.DB.prepare(
    'SELECT * FROM links WHERE id = ?'
  ).bind(linkId).first<Link>();

  if (!link) {
    console.error(JSON.stringify({ msg: 'link_not_found', linkId }));
    return;
  }

  try {
    // ── 2. Mark as processing ────────────────────────────────────────────────
    // INSERT ... ON CONFLICT preserves the existing row (and its attempts counter)
    // instead of deleting and re-inserting it as INSERT OR REPLACE would.
    await env.DB.prepare(`
      INSERT INTO processing_queue (link_id, status)
        VALUES (?, 'processing')
      ON CONFLICT(link_id) DO UPDATE SET
        status     = 'processing',
        created_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
    `).bind(linkId).run();

    // ── 3. Fetch the target URL exactly once ────────────────────────────────
    console.log(JSON.stringify({ msg: 'fetch_start', linkId, url: link.url }));

    let html = '';
    let isPdf = false;

    // A URL ending in .pdf is always treated as a PDF, even before fetching.
    const urlPath = new URL(link.url).pathname.toLowerCase();
    if (urlPath.endsWith('.pdf')) {
      isPdf = true;
      console.log(JSON.stringify({ msg: 'pdf_detected_by_url', linkId }));
    }

    try {
      // Use Kitesurf (Browser Run) to fetch fully JS-rendered HTML so that
      // SPAs and dynamically rendered pages are correctly extracted.
      const browserResponse = await env.BROWSER.quickAction('content', {
        url: link.url,
        gotoOptions: { waitUntil: 'load' },
      });

      if (!browserResponse.ok) throw new Error(`Kitesurf HTTP ${browserResponse.status}`);

      // Stream up to 512 KB. Both metadata (needs <head>) and toMarkdown
      // (needs full body) work well within this window.
      html = await streamToString(browserResponse, MAX_BODY_BYTES);
    } catch (fetchError: unknown) {
      // A failed fetch is non-fatal: both extractors handle empty HTML gracefully.
      console.error(JSON.stringify({
        msg: 'fetch_error',
        linkId,
        url: link.url,
        error: fetchError instanceof Error ? fetchError.message : String(fetchError),
      }));
    }

    // ── 4. Extract metadata and article content in parallel ─────────────────
    // Both work entirely on the already-buffered HTML string — zero additional
    // network I/O at this point.
    // For PDFs, skip article extraction and summarization entirely.
    console.log(JSON.stringify({ msg: 'extract_start', linkId, isPdf }));

    const [metadata, { markdown }] = await Promise.all([
      extractMetadataFromHtml(html, link.url),
      isPdf ? Promise.resolve({ markdown: null }) : extractArticleContentFromHtml(html, link.url, env),
    ]);

    // ── 5. Generate AI summary (needs markdown output from step 4) ──────────
    let summary: string | null = null;
    let readingTime: number | null = null;

    if (markdown && !isPdf) {
      console.log(JSON.stringify({ msg: 'summary_start', linkId }));
      summary = await generateSummary(markdown, env, metadata.title || link.title);
      readingTime = calculateReadingTime(markdown);
      console.log(JSON.stringify({ msg: 'summary_done', linkId, readingTime }));
    }

    // ── 6. Persist everything + mark completed in a single batch ────────────
    // One D1 round-trip instead of three separate sequential writes.
    // For PDFs: set metadata_extracted_at so the "Processing..." badge disappears,
    // but leave scraped_at NULL to reflect that no article content was saved.
    await env.DB.batch([
      env.DB.prepare(`
        UPDATE links SET
          title                = COALESCE(?, title),
          description          = ?,
          author               = ?,
          site_name            = ?,
          published_date       = ?,
          image_url            = ?,
          favicon_url          = ?,
          content_type         = ?,
          markdown_content     = ?,
          ai_summary           = ?,
          reading_time_minutes = ?,
          is_pdf               = ?,
          metadata_extracted_at = CURRENT_TIMESTAMP,
          scraped_at           = ${isPdf ? 'NULL' : 'CURRENT_TIMESTAMP'},
          updated_at           = CURRENT_TIMESTAMP
        WHERE id = ?
      `).bind(
        metadata.title || link.title,
        metadata.description,
        metadata.author,
        metadata.siteName,
        metadata.publishedDate,
        metadata.image,
        metadata.favicon,
        isPdf ? 'pdf' : metadata.type,
        markdown,
        summary,
        readingTime,
        isPdf ? 1 : 0,
        linkId,
      ),

      env.DB.prepare(`
        UPDATE processing_queue
        SET status = 'completed', processed_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
        WHERE link_id = ?
      `).bind(linkId),
    ]);

    console.log(JSON.stringify({ msg: 'processing_done', linkId }));

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ msg: 'processing_error', linkId, error: message }));

    await env.DB.prepare(
      'UPDATE processing_queue SET status = ?, error_message = ?, attempts = attempts + 1 WHERE link_id = ?'
    ).bind('failed', message, linkId).run();

    throw error; // re-throw so the queue consumer can call message.retry()
  }
}
