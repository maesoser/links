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
  let faviconHref: string | null = null;

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
        if (!faviconHref) faviconHref = el.getAttribute('href') ?? null;
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
    favicon: faviconHref ? resolveUrl(faviconHref, url) : `${urlObj.protocol}//${urlObj.host}/favicon.ico`,
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
