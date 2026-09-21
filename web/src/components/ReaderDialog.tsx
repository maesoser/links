import { Badge, Button, Dialog, Link, Tabs, Text } from "@cloudflare/kumo";
import { FileText, RefreshCw, X } from "lucide-react";
import type { LinkItem } from "../types";
import { formatDate, formatReadingTime } from "../lib/format";
import { markdownToHtml } from "../lib/markdown";

interface ReaderDialogProps {
  link: LinkItem | null;
  open: boolean;
  tab: "summary" | "article";
  onTabChange: (tab: "summary" | "article") => void;
  onOpenChange: (open: boolean) => void;
  onRetry?: (id: string) => void;
  onRefetch?: (id: string) => void;
}

export function ReaderDialog({
  link,
  open,
  tab,
  onTabChange,
  onOpenChange,
  onRetry,
  onRefetch,
}: ReaderDialogProps) {
  const isPdf = Boolean(link?.is_pdf);
  const failed = link?.processing_status === "failed";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog
        size="xl"
        className="flex max-h-[min(90dvh,860px)] flex-col overflow-hidden p-0 max-sm:h-[calc(100dvh-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px)-16px)] max-sm:max-h-none"
      >
        <div className="flex items-start justify-between gap-3 border-b border-kumo-hairline p-4 sm:p-5">
          <div className="min-w-0 flex-1">
            <Dialog.Title className="text-xl font-semibold leading-snug">
              {link?.title || "Untitled"}
            </Dialog.Title>
            <Dialog.Description className="sr-only">
              Article reader
            </Dialog.Description>
            {link ? (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Badge
                  variant={link.status === "unread" ? "info" : "neutral"}
                  appearance="dot"
                >
                  {link.status === "unread" ? "Unread" : "Read"}
                </Badge>
                {isPdf ? (
                  <Badge variant="info" icon={<FileText size={12} />}>PDF</Badge>
                ) : null}
                {failed ? (
                  <Badge variant="error" appearance="dot">Failed</Badge>
                ) : null}
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
                {(link.tags ?? []).map((tag) => (
                  <Badge key={tag} variant="outline">{tag}</Badge>
                ))}
                <Link
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="plain"
                  className="max-w-full truncate font-mono text-xs text-kumo-subtle"
                >
                  {link.url}
                </Link>
              </div>
            ) : null}
          </div>
          <div className="flex shrink-0 gap-1">
            <Dialog.Close
              aria-label="Close"
              render={(props) => (
                <Button
                  {...props}
                  variant="secondary"
                  size="sm"
                  shape="square"
                  icon={<X size={16} />}
                  aria-label="Close"
                />
              )}
            />
          </div>
        </div>

        <div className="border-b border-kumo-hairline px-4 sm:px-5">
          <Tabs
            variant="underline"
            value={tab}
            onValueChange={(value) => onTabChange(value as "summary" | "article")}
            tabs={[
              { value: "summary", label: "Summary" },
              { value: "article", label: "Article" },
            ]}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
          {isPdf ? (
            <div className="flex flex-col gap-3">
              <Text variant="secondary">
                This is a PDF. Extracted text and summaries aren't available — open the original file instead.
              </Text>
              {link ? (
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-md bg-kumo-brand px-3 py-1.5 text-sm font-medium text-white"
                >
                  <FileText size={16} />
                  Open PDF
                </a>
              ) : null}
            </div>
          ) : tab === "summary" ? (
            link?.ai_summary ? (
              <div
                className="prose"
                dangerouslySetInnerHTML={{ __html: markdownToHtml(link.ai_summary) }}
              />
            ) : (
              <div className="flex flex-col gap-3">
                <Text variant="secondary">
                  {failed
                    ? link.processing_error || "Processing failed. Retry to try again."
                    : "No summary available yet. Content may still be processing."}
                </Text>
                {failed && link && onRetry ? (
                  <Button
                    variant="secondary"
                    icon={<RefreshCw size={16} />}
                    onClick={() => onRetry(link.id)}
                  >
                    Retry
                  </Button>
                ) : null}
              </div>
            )
          ) : link?.markdown_content ? (
            <div
              className="prose"
              dangerouslySetInnerHTML={{ __html: markdownToHtml(link.markdown_content) }}
            />
          ) : (
            <div className="flex flex-col gap-3">
              <Text variant="secondary">
                {failed
                  ? link.processing_error || "Processing failed. Retry to try again."
                  : "Content is being processed. This may take a few moments."}
              </Text>
              {failed && link && onRetry ? (
                <Button
                  variant="secondary"
                  icon={<RefreshCw size={16} />}
                  onClick={() => onRetry(link.id)}
                >
                  Retry
                </Button>
              ) : link ? (
                <Link
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open original article <Link.ExternalIcon />
                </Link>
              ) : null}
            </div>
          )}
        </div>
      </Dialog>
    </Dialog.Root>
  );
}
