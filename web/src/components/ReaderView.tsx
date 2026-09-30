import { Badge, Button, LayerCard, Link, Text } from "@cloudflare/kumo";
import { ChevronLeft, ExternalLink, FileText, RefreshCw } from "lucide-react";
import type { LinkItem } from "../types";
import { formatDate, formatReadingTime } from "../lib/format";
import { markdownToHtml } from "../lib/markdown";

interface ReaderViewProps {
  link: LinkItem;
  onBack: () => void;
  onRetry?: (id: string) => void;
}

export function ReaderView({ link, onBack, onRetry }: ReaderViewProps) {
  const isPdf = Boolean(link.is_pdf);
  const failed = link.processing_status === "failed";
  const tags = link.tags ?? [];

  let domain = "";
  try { domain = new URL(link.url).hostname; } catch { domain = link.url; }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-kumo-canvas">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 p-3 pb-[max(2rem,env(safe-area-inset-bottom))] sm:p-6">

        {/* Back link */}
        <div>
          <Link
            href="#"
            variant="plain"
            className="inline-flex items-center gap-1 text-sm"
            render={<button type="button" onClick={onBack} />}
          >
            <ChevronLeft size={15} />
            Back to articles
          </Link>
        </div>

        {/* ── Surface-style card: metadata + summary ── */}
        <LayerCard className="p-5">
          <div className="flex flex-col gap-3">

            {/* Title */}
            <h1 className="text-xl font-semibold leading-snug text-kumo-default">
              {link.title || "Untitled"}
            </h1>

            {/* Site / author */}
            {(link.site_name || link.author) ? (
              <Text variant="secondary" size="sm" as="p">
                {link.site_name ?? ""}
                {link.site_name && link.author ? " · " : ""}
                {link.author ? `by ${link.author}` : ""}
              </Text>
            ) : null}

            {/* Status row */}
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge
                variant={link.status === "unread" ? "info" : "neutral"}
                appearance="dot"
              >
                {link.status === "unread" ? "Unread" : "Read"}
              </Badge>
              {isPdf ? <Badge variant="info" icon={<FileText size={12} />}>PDF</Badge> : null}
              {failed ? <Badge variant="error" appearance="dot">Failed</Badge> : null}
              {link.reading_time_minutes ? (
                <Text variant="secondary" size="sm" as="span">
                  {formatReadingTime(link.reading_time_minutes)}
                </Text>
              ) : null}
              {link.created_at ? (
                <Text variant="secondary" size="sm" as="span">
                  Added {formatDate(link.created_at)}
                </Text>
              ) : null}
            </div>

            {/* Tags */}
            {tags.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {tags.map((tag) => (
                  <Badge key={tag} variant="outline">{tag}</Badge>
                ))}
              </div>
            ) : null}

            {/* Domain link */}
            <div>
              <Link
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                variant="plain"
                className="inline-flex items-center gap-1 font-mono text-xs text-kumo-subtle"
              >
                {domain}
                <Link.ExternalIcon />
              </Link>
            </div>

            {/* Divider */}
            <div className="border-t border-kumo-hairline" />

            {/* Summary */}
            {isPdf ? (
              <div className="flex flex-col gap-3">
                <Text variant="secondary" size="sm">
                  This is a PDF — extracted text and summaries aren't available.
                </Text>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 self-start rounded-md bg-kumo-brand px-3 py-1.5 text-sm font-medium text-white"
                >
                  <FileText size={15} />
                  Open PDF
                </a>
              </div>
            ) : link.ai_summary ? (
              <div
                className="prose prose-sm max-w-none"
                dangerouslySetInnerHTML={{ __html: markdownToHtml(link.ai_summary) }}
              />
            ) : (
              <div className="flex flex-col gap-3">
                <Text variant="secondary" size="sm">
                  {failed
                    ? link.processing_error || "Processing failed."
                    : "No summary available yet — content may still be processing."}
                </Text>
                {failed && onRetry ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<RefreshCw size={14} />}
                    onClick={() => onRetry(link.id)}
                  >
                    Retry
                  </Button>
                ) : null}
              </div>
            )}
          </div>
        </LayerCard>

        {/* ── Basic card: full article content ── */}
        {!isPdf ? (
          <LayerCard>
            <LayerCard.Secondary className="flex items-center justify-between gap-2">
              <span>Article</span>
              <Link
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                variant="plain"
                className="flex items-center gap-1 text-xs text-kumo-subtle"
              >
                Open original <ExternalLink size={11} />
              </Link>
            </LayerCard.Secondary>
            <LayerCard.Primary>
              {link.markdown_content ? (
                <div
                  className="prose prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: markdownToHtml(link.markdown_content) }}
                />
              ) : (
                <div className="flex flex-col gap-3">
                  <Text variant="secondary" size="sm">
                    {failed
                      ? link.processing_error || "Processing failed."
                      : "Content is being processed. This may take a few moments."}
                  </Text>
                  {failed && onRetry ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<RefreshCw size={14} />}
                      onClick={() => onRetry(link.id)}
                    >
                      Retry
                    </Button>
                  ) : (
                    <Link href={link.url} target="_blank" rel="noopener noreferrer">
                      Open original article <Link.ExternalIcon />
                    </Link>
                  )}
                </div>
              )}
            </LayerCard.Primary>
          </LayerCard>
        ) : null}

      </div>
    </div>
  );
}
