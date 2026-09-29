import { MAX_BODY_BYTES } from '../utils/constants';

export interface LinkMetadata {
  title: string | null;
  description: string | null;
  author: string | null;
  siteName: string | null;
  publishedDate: string | null;
  image: string | null;
  favicon: string | null;
  type: string | null;
  domain: string | null;
}

// ─── Core extraction logic (works on a pre-fetched HTML string) ───────────────

export async function extractMetadataFromHtml(html: string, url: string): Promise<LinkMetadata> {
  const urlObj = new URL(url);
  const domain = urlObj.hostname.replace(/^www\./, '');

  const meta: Record<string, string> = {};
  let titleText = '';

  // Collect all candidate favicon tags so we can pick the best one afterward.
  interface FaviconCandidate {
    href: string;
    rel: string;   // full rel attribute value
    type: string;  // mime type hint, e.g. "image/png"
    sizes: string; // e.g. "32x32"
  }
  const faviconCandidates: FaviconCandidate[] = [];

  await new HTMLRewriter()
    .on('title', {
      text(chunk) {
        titleText += chunk.text;
      }
    })
    .on('meta', {
      element(el) {
        const property = el.getAttribute('property')?.toLowerCase() ?? '';
        const name     = el.getAttribute('name')?.toLowerCase() ?? '';
        const itemprop = el.getAttribute('itemprop')?.toLowerCase() ?? '';
        const content  = el.getAttribute('content') ?? '';
        if (!content) return;
        const key = property || name || itemprop;
        if (key && !meta[key]) meta[key] = content;
      }
    })
    .on('link[rel~="icon"], link[rel~="shortcut"], link[rel~="apple-touch-icon"]', {
      element(el) {
        const href = el.getAttribute('href') ?? '';
        if (!href) return;
        faviconCandidates.push({
          href,
          rel:   (el.getAttribute('rel') ?? '').toLowerCase(),
          type:  (el.getAttribute('type') ?? '').toLowerCase(),
          sizes: (el.getAttribute('sizes') ?? '').toLowerCase(),
        });
      }
    })
    .on('time[datetime]', {
      element(el) {
        if (!meta['article:published_time']) {
          meta['article:published_time'] = el.getAttribute('datetime') ?? '';
        }
      }
    })
    .transform(new Response(html))
    .text();

  const imageRaw = meta['og:image'] || meta['twitter:image'] || meta['image'] || '';

  return {
    title:
      cleanText(meta['og:title'] ?? meta['twitter:title'] ?? meta['name'] ?? titleText) || null,
    description:
      cleanText(meta['og:description'] ?? meta['twitter:description'] ?? meta['description'] ?? meta['itemprop:description'] ?? '') || null,
    author:
      cleanText(meta['author'] ?? meta['article:author'] ?? meta['twitter:creator'] ?? '') || null,
    siteName:
      cleanText(meta['og:site_name'] ?? meta['twitter:site'] ?? meta['application-name'] ?? '') || null,
    publishedDate:
      meta['article:published_time'] || meta['publish_date'] || meta['publication_date'] || meta['datepublished'] || null,
    image: imageRaw ? resolveUrl(imageRaw, url) : null,
    favicon: pickBestFavicon(faviconCandidates, url),
    type: meta['og:type'] || null,
    domain,
  };
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

/** Stream a Response body into a string, capped at maxBytes. Stops early when
 *  stopMarker is found (e.g. '</head>'). Always cancels the reader on exit. */
export async function streamToString(
  response: Response,
  maxBytes: number,
  stopMarker?: string,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return ''; // response has no body (e.g. 204 or Workers mock)

  const decoder = new TextDecoder();
  let text = '';
  let done = false;

  try {
    while (!done && text.length < maxBytes) {
      const { value, done: streamDone } = await reader.read();
      done = streamDone;
      if (value) text += decoder.decode(value, { stream: !done });
      if (stopMarker && text.includes(stopMarker)) break;
    }
  } finally {
    reader.cancel();
  }

  return text;
}

function cleanText(text: string): string {
  if (!text) return '';

  const entities: Record<string, string> = {
    '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"',
    '&#39;': "'", '&apos;': "'", '&nbsp;': ' ', '&mdash;': '—',
    '&ndash;': '–', '&hellip;': '…', '&copy;': '©', '&reg;': '®',
    '&trade;': '™', '&ldquo;': '"', '&rdquo;': '"', '&lsquo;': "'", '&rsquo;': "'",
  };

  let decoded = text;
  for (const [entity, char] of Object.entries(entities)) {
    decoded = decoded.replace(new RegExp(entity, 'gi'), char);
  }
  decoded = decoded.replace(/&#(\d+);/g,    (_, d) => String.fromCharCode(parseInt(d, 10)));
  decoded = decoded.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));

  return decoded.replace(/\s+/g, ' ').trim();
}

// Preferred MIME types for a favicon rendered at 16–32 px.
// SVG is excluded because it can contain scripts and renders inconsistently
// at tiny sizes. JPEG is excluded because it is lossy and rarely the
// canonical favicon format — sites that publish a JPEG icon almost always
// also publish a PNG or ICO version.
const PREFERRED_TYPES = new Set(['image/x-icon', 'image/vnd.microsoft.icon', 'image/png', 'image/webp']);
const PREFERRED_EXTS  = new Set(['.ico', '.png', '.webp']);
const AVOIDED_EXTS    = new Set(['.jpg', '.jpeg', '.svg']);

function pickBestFavicon(
  candidates: Array<{ href: string; rel: string; type: string; sizes: string }>,
  pageUrl: string,
): string {
  const urlObj = new URL(pageUrl);
  const fallback = `${urlObj.protocol}//${urlObj.host}/favicon.ico`;

  if (candidates.length === 0) return fallback;

  // Score each candidate. Higher = better.
  function score(c: { href: string; rel: string; type: string; sizes: string }): number {
    let s = 0;

    // Strongly prefer standard rel="icon" over apple-touch-icon / shortcut.
    if (c.rel === 'icon' || c.rel === 'shortcut icon') s += 40;
    else if (c.rel.includes('apple-touch-icon')) s += 10;

    // Prefer known-good MIME types declared in the type attribute.
    if (c.type && PREFERRED_TYPES.has(c.type)) s += 30;
    // Penalise JPEG and SVG explicitly declared via type.
    if (c.type === 'image/jpeg' || c.type === 'image/jpg') s -= 20;
    if (c.type === 'image/svg+xml') s -= 10;

    // Prefer known-good extensions inferred from the href.
    const ext = c.href.split('?')[0].toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? '';
    if (PREFERRED_EXTS.has(ext)) s += 20;
    if (AVOIDED_EXTS.has(ext))   s -= 15;

    // Prefer small/medium sizes (16, 32, 48) over large apple-touch ones (180+).
    const sizeMatch = c.sizes.match(/(\d+)x(\d+)/);
    if (sizeMatch) {
      const dim = parseInt(sizeMatch[1], 10);
      if (dim <= 48)       s += 15;
      else if (dim <= 96)  s += 5;
      else                 s -= 5;   // 180×180 apple-touch-icon, etc.
    }

    return s;
  }

  const best = candidates.reduce((a, b) => (score(a) >= score(b) ? a : b));
  const resolved = resolveUrl(best.href, pageUrl);
  return resolved || fallback;
}

function resolveUrl(relUrl: string, baseUrl: string): string {
  if (!relUrl) return '';
  try {
    if (relUrl.startsWith('http://') || relUrl.startsWith('https://')) return relUrl;
    if (relUrl.startsWith('//')) return new URL(baseUrl).protocol + relUrl;
    return new URL(relUrl, baseUrl).href;
  } catch {
    return relUrl;
  }
}
