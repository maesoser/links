const PROSE_WPM = 238;
const CODE_WPM = 80;
const SECONDS_PER_IMAGE = 12;
const SECONDS_PER_TABLE_ROW = 4;

export function calculateReadingTime(text: string): number {
  if (!text.trim()) return 1;

  const images = (text.match(/!\[[^\]]*\]\([^)]+\)/g) ?? []).length;
  const tableRows = (text.match(/^\s*\|.+\|/gm) ?? []).length;

  const codeBlocks = text.match(/```[\s\S]*?```/g) ?? [];
  const codeWords = codeBlocks.reduce((sum, block) => {
    return sum + block.trim().split(/\s+/).filter(Boolean).length;
  }, 0);

  const prose = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]+`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .trim();
  const proseWords = prose ? prose.split(/\s+/).filter(Boolean).length : 0;

  const minutes =
    proseWords / PROSE_WPM +
    codeWords / CODE_WPM +
    (images * SECONDS_PER_IMAGE) / 60 +
    (tableRows * SECONDS_PER_TABLE_ROW) / 60;

  return Math.max(1, Math.ceil(minutes));
}

export function formatReadingTime(minutes: number): string {
  if (minutes === 1) return '1 min read';
  if (minutes < 60) return `${minutes} min read`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) return hours === 1 ? '1 hour' : `${hours} hours`;
  return hours === 1
    ? `1 hour ${remainingMinutes} min`
    : `${hours} hours ${remainingMinutes} min`;
}
