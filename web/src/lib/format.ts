export function formatReadingTime(minutes: number | null | undefined): string {
  if (!minutes) return "";
  if (minutes === 1) return "1 min read";
  if (minutes < 60) return `${minutes} min read`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (rem === 0) return hours === 1 ? "1 hour" : `${hours} hours`;
  return hours === 1 ? `1 hour ${rem} min` : `${hours} hours ${rem} min`;
}

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const diff = Date.now() - date.getTime();
  const days = Math.floor(diff / 86400000);

  if (days === 0) {
    const hours = Math.floor(diff / 3600000);
    if (hours === 0) {
      const mins = Math.floor(diff / 60000);
      return mins <= 1 ? "just now" : `${mins}m ago`;
    }
    return hours === 1 ? "1h ago" : `${hours}h ago`;
  }
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString();
}
