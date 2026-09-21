import { Env } from '../types';

const SYSTEM_PROMPT = `You are an expert editor. Summarize the article in this exact Markdown format:

One sentence capturing the author's main point. Do not prefix it with TL;DR, TLDR, or any label.

**Key takeaways:**
- 3 to 5 bullets with the most important arguments, facts, or data.

Write in your own words. Never copy navigation, menus, tables of contents, skip links, ads, comments, or YAML. If the text is mostly chrome, infer the article from the title and remaining prose. Output only the summary.`;

const NOISE_LINE = /^(skip to content|skip to main|table of contents|contents|menu|home|docs|blog|plugins|compare|subscribe|share|follow|sign in|log in|cookie|privacy|terms)$/i;
const TOC_LINE = /^(\*|-|\d+\.)\s+\[[^\]]+\]\([^)]*(#[^)]*)?\)\s*$/;
const LINK_ONLY_LINE = /^\[[^\]]+\]\([^)]+\)\s*$/;
const MD_LINK = /\[([^\]]+)\]\([^)]+\)/g;

function stripFrontmatter(markdown: string): string {
  let content = markdown.trim();
  if (content.startsWith('---')) {
    const end = content.indexOf('\n---', 3);
    if (end !== -1) content = content.slice(end + 4);
  }
  return content.trim();
}

function isNoiseBlock(block: string): boolean {
  const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return true;

  const joined = lines.join(' ').replace(/\s+/g, ' ').trim();
  if (NOISE_LINE.test(joined)) return true;
  if (joined.length < 40 && LINK_ONLY_LINE.test(joined)) return true;

  const tocLines = lines.filter(l => TOC_LINE.test(l) || LINK_ONLY_LINE.test(l));
  if (tocLines.length >= 2 && tocLines.length / lines.length >= 0.6) return true;

  const stripped = joined.replace(MD_LINK, '$1').replace(/[#*_`>|]/g, '').trim();
  if (stripped.length < 40) return true;

  return false;
}

export function prepareArticle(markdown: string): string {
  let content = stripFrontmatter(markdown)
    .replace(/<!doctype html>/gi, '')
    .replace(/<\/?[^>]+>/g, ' ')
    .replace(/\[Content truncated\.\.\.\]\s*$/, '')
    .replace(/\r\n/g, '\n');

  const blocks = content
    .split(/\n{2,}/)
    .map(b => b.trim())
    .filter(Boolean)
    .filter(b => !isNoiseBlock(b))
    .map(b => b.replace(MD_LINK, '$1').replace(/[*_#>`]/g, '').replace(/\s+/g, ' ').trim())
    .filter(b => b.length >= 40);

  return blocks.join('\n\n').trim();
}

function fallbackSummary(article: string): string | null {
  const paragraphs = article
    .split('\n\n')
    .map(p => p.replace(MD_LINK, '$1').replace(/\s+/g, ' ').trim())
    .filter(p => p.length > 80);

  if (paragraphs.length === 0) return null;

  const tldr = paragraphs[0].slice(0, 280);
  const takeaways = paragraphs.slice(1, 5).map(p => {
    const firstSentence = p.match(/^[^.!?]+[.!?]/);
    return `- ${(firstSentence ? firstSentence[0] : p.substring(0, 160)).trim()}`;
  });

  return `${tldr}\n\n**Key takeaways:**\n${takeaways.join('\n')}`;
}

export async function generateSummary(
  markdown: string,
  env: Env,
  title?: string | null,
): Promise<string | null> {
  const article = prepareArticle(markdown);
  if (!article || article.length < 100) {
    return null;
  }

  try {
    const maxLength = 12000;
    const content = article.length > maxLength
      ? article.substring(0, maxLength) + '...'
      : article;

    const heading = title?.trim() ? `Title: ${title.trim()}\n\n` : '';
    const response = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `${heading}Article:\n\n${content}`,
        },
      ],
      max_tokens: 500,
      temperature: 0.2,
    }) as { response?: string };

    const summary = response?.response?.trim();
    if (!summary) {
      throw new Error('Invalid AI response');
    }

    return summary.replace(/^\s*(\*\*)?TL;?DR:?(\*\*)?\s*/i, '').trim();
  } catch (error: unknown) {
    console.error(JSON.stringify({
      msg: 'summary_generation_error',
      error: error instanceof Error ? error.message : String(error),
    }));
    return fallbackSummary(article);
  }
}
