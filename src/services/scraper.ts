import { Env } from '../types';
import { prepareArticle } from './summarizer';

export interface ScraperResult {
  title: string | null;
  markdown: string | null;
}

// CSS selectors tried in order; the first one that yields enough content wins.
// Falls back to the full page if none match or all are too thin.
const ARTICLE_SELECTORS = [
  'article',
  '[role="main"]',
  'main',
  '.post-content',
  '.article-body',
  '.article-content',
  '.entry-content',
  '.post-body',
  '.content-body',
  '.story-body',
  '.article__body',
  '.post__content',
  '#article-body',
  '#main-content',
  '#content',
].join(', ');

// Minimum character count for a selector-scoped result to be considered useful.
const MIN_CONTENT_LENGTH = 200;

async function toMarkdownWith(
  html: string,
  hostname: string,
  cssSelector: string | undefined,
  env: Env,
): Promise<string | null> {
  const opts: Record<string, unknown> = { hostname };
  if (cssSelector) opts.cssSelector = cssSelector;

  const results = await env.AI.toMarkdown(
    [{ name: 'page.html', blob: new Blob([html], { type: 'text/html' }) }],
    { conversionOptions: { html: opts } },
  );

  const result = Array.isArray(results) ? results[0] : results;
  if (!result || result.format === 'error') return null;
  return result.data?.trim() || null;
}

// ─── Core extraction logic (works on a pre-fetched HTML string) ───────────────

export async function extractArticleContentFromHtml(
  html: string,
  url: string,
  env: Env,
): Promise<ScraperResult> {
  try {
    const hostname = new URL(url).hostname;

    // 1. Try scoped extraction first; fall back to full page if the result is thin.
    let markdown = await toMarkdownWith(html, hostname, ARTICLE_SELECTORS, env);

    if (!markdown || markdown.length < MIN_CONTENT_LENGTH) {
      console.log(JSON.stringify({ msg: 'scraper_selector_fallback', hostname, len: markdown?.length ?? 0 }));
      markdown = await toMarkdownWith(html, hostname, undefined, env);
    }

    if (!markdown) return { title: null, markdown: null };

    // 2. Strip navigation noise from what was stored (same filter the summarizer uses).
    const cleaned = prepareArticle(markdown);
    if (!cleaned || cleaned.length < MIN_CONTENT_LENGTH) {
      // prepareArticle was too aggressive — keep the raw markdown instead.
      console.log(JSON.stringify({ msg: 'scraper_prepare_too_aggressive', hostname }));
    }

    const final = (cleaned && cleaned.length >= MIN_CONTENT_LENGTH) ? cleaned : markdown;

    // 3. Enforce content length cap.
    const capped = final.length > 50000
      ? final.substring(0, 50000) + '\n\n[Content truncated...]'
      : final;

    return { title: null, markdown: capped };
  } catch (error: unknown) {
    console.error('Scraping error:', error instanceof Error ? error.message : String(error));
    return { title: null, markdown: null };
  }
}


