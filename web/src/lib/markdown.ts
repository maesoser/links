import { marked } from "marked";
import DOMPurify from "dompurify";

marked.use({ gfm: true, breaks: false });

// Open all links in a new tab.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
  // Hide images that fail to load instead of showing a broken icon.
  if (node.tagName === "IMG") {
    node.setAttribute("onerror", "this.style.display='none'");
    node.setAttribute("loading", "lazy");
  }
});

// Prose-only tag allowlist — drops nav, header, footer, form, button, script,
// style, and any other chrome that toMarkdown may pass through from page HTML.
const ALLOWED_TAGS = [
  "p", "br", "hr",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li",
  "strong", "em", "s", "del", "ins", "mark", "sub", "sup",
  "blockquote",
  "pre", "code",
  "a",
  "img",
  "figure", "figcaption",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td",
  "details", "summary",
  "span", "div",
];

const ALLOWED_ATTR = [
  "href", "title", "target", "rel",
  "src", "alt", "width", "height", "loading", "onerror",
  "class", "id",
  "colspan", "rowspan",
  "open",
];

export function stripTldrLabel(markdown: string): string {
  return markdown.replace(/^\s*(\*\*)?TL;?DR:?(\*\*)?\s*/i, "").trimStart();
}

export function markdownToHtml(markdown: string | null | undefined): string {
  if (!markdown) return "";
  return DOMPurify.sanitize(marked.parse(stripTldrLabel(markdown)) as string, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
  });
}
