import { useState } from "react";
import {
  Badge,
  Button,
  Checkbox,
  DropdownMenu,
  LayerCard,
  Text,
} from "@cloudflare/kumo";
import {
  BookOpen,
  Check,
  FileText,
  MoreHorizontal,
  RefreshCw,
  RotateCcw,
  Star,
  Tag,
  Trash2,
} from "lucide-react";
import type { LinkItem } from "../types";
import { formatDate, formatReadingTime } from "../lib/format";
import { DeleteDialog } from "./DeleteDialog";
import { TagDialog } from "./TagDialog";

interface LinkCardProps {
  link: LinkItem;
  selected: boolean;
  selectionMode: boolean;
  onOpen: (id: string) => void;
  onToggle: (id: string, status: LinkItem["status"]) => void;
  onDelete: (id: string) => void;
  onStar: (id: string, starred: boolean) => void;
  onRetry: (id: string) => void;
  onTagsChange: (id: string, tags: string[]) => void;
  onSelect: (id: string, selected: boolean) => void;
}

export function LinkCard({
  link,
  selected,
  selectionMode,
  onOpen,
  onToggle,
  onDelete,
  onStar,
  onRetry,
  onTagsChange,
  onSelect,
}: LinkCardProps) {
  const [tagsOpen, setTagsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const domain = link.domain || new URL(link.url).hostname;
  const ddgFaviconUrl = `https://icons.duckduckgo.com/ip3/${domain}.ico`;

  // If the stored favicon_url is just the guessed /favicon.ico fallback
  // (no explicit path was found in the page's <link> tags), skip it and
  // go straight to DuckDuckGo to avoid a wasted failing request.
  const isGuessedFallback =
    !link.favicon_url ||
    link.favicon_url === `https://${domain}/favicon.ico` ||
    link.favicon_url === `http://${domain}/favicon.ico`;
  const faviconUrl = isGuessedFallback ? ddgFaviconUrl : link.favicon_url;

  // Generate a letter-avatar SVG as a data URI — used as the final fallback.
  // DuckDuckGo always returns something, but this covers offline / CDN failures.
  function letterFaviconDataUri(d: string): string {
    const letter = (d[0] ?? "?").toUpperCase();
    const hue = [...d].reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;
    const bg = `hsl(${hue},55%,45%)`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="${bg}"/><text x="8" y="12" font-size="10" font-family="sans-serif" fill="#fff" text-anchor="middle">${letter}</text></svg>`;
    return `data:image/svg+xml;base64,${btoa(svg)}`;
  }

  function handleFaviconError(e: React.SyntheticEvent<HTMLImageElement>) {
    const img = e.currentTarget;
    if (img.src !== ddgFaviconUrl) {
      // First failure: stored favicon_url was broken — try DuckDuckGo CDN.
      img.src = ddgFaviconUrl;
    } else {
      // Second failure: DuckDuckGo also failed (e.g. offline) — use letter avatar.
      img.src = letterFaviconDataUri(domain);
      img.onerror = null; // data URI can never fail; stop the error chain.
    }
  }

  const failed = link.processing_status === "failed";
  const isPdf = Boolean(link.is_pdf);
  const isProcessed = Boolean(link.scraped_at || link.metadata_extracted_at || isPdf);
  const starred = Boolean(link.starred);
  const tags = link.tags ?? [];

  function open() {
    if (selectionMode) {
      onSelect(link.id, !selected);
      return;
    }
    onOpen(link.id);
  }

  return (
    <>
      <div
        className="cursor-pointer"
        role="button"
        tabIndex={0}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            open();
          }
        }}
      >
        <LayerCard className={`p-4 ${selected ? "ring-1 ring-kumo-brand" : ""}`}>
          <div className="flex flex-col gap-2">
            <div className="flex items-start gap-3">
              <div
                className="mt-0.5 shrink-0"
                onClick={(e) => e.stopPropagation()}
              >
                <Checkbox
                  aria-label={`Select ${link.title || "link"}`}
                  checked={selected}
                  onCheckedChange={(checked) => onSelect(link.id, Boolean(checked))}
                />
              </div>
              <img
                className="mt-0.5 size-4 shrink-0 rounded-sm opacity-80"
                src={faviconUrl}
                alt=""
                onError={handleFaviconError}
              />
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2">
                  <Text variant="heading" as="h2">
                    {link.title || "Untitled"}
                  </Text>
                </div>
                {link.description ? (
                  <div className="mt-1 line-clamp-2">
                    <Text variant="secondary" size="sm" as="span">
                      {link.description}
                    </Text>
                  </div>
                ) : null}
              </div>
              <div
                className="flex shrink-0 gap-1"
                onClick={(e) => e.stopPropagation()}
              >
                {failed ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    shape="square"
                    icon={<RefreshCw size={16} />}
                    aria-label="Retry processing"
                    title="Retry"
                    onClick={() => onRetry(link.id)}
                  />
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    shape="square"
                    icon={link.status === "read" ? <RotateCcw size={16} /> : <Check size={16} />}
                    aria-label={link.status === "read" ? "Mark unread" : "Mark read"}
                    title={link.status === "read" ? "Mark unread" : "Mark read"}
                    onClick={() => onToggle(link.id, link.status)}
                  />
                )}
                <DropdownMenu>
                  <DropdownMenu.Trigger
                    render={
                      <Button
                        variant="ghost"
                        size="sm"
                        shape="square"
                        icon={<MoreHorizontal size={16} />}
                        aria-label="More actions"
                      />
                    }
                  />
                  <DropdownMenu.Content>
                    <DropdownMenu.Item
                      icon={Star}
                      onClick={() => onStar(link.id, !starred)}
                    >
                      {starred ? "Unstar" : "Star"}
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      icon={link.status === "read" ? RotateCcw : Check}
                      onClick={() => onToggle(link.id, link.status)}
                    >
                      {link.status === "read" ? "Mark unread" : "Mark read"}
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      icon={Tag}
                      onClick={() => setTagsOpen(true)}
                    >
                      Edit tags
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      icon={RefreshCw}
                      onClick={() => onRetry(link.id)}
                    >
                      {failed ? "Retry" : "Re-fetch content"}
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator />
                    <DropdownMenu.Item
                      icon={Trash2}
                      variant="danger"
                      onClick={() => setDeleteOpen(true)}
                    >
                      Delete
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu>
              </div>
            </div>

            <Text variant="mono-secondary" truncate as="span">
              {link.url}
            </Text>

            <div className="flex flex-wrap items-center gap-1.5">
              {starred ? <Badge variant="warning" icon={<Star size={12} />}>Starred</Badge> : null}
              {isPdf ? <Badge variant="info" icon={<FileText size={12} />}>PDF</Badge> : null}
              {link.site_name ? <Badge variant="outline">{link.site_name}</Badge> : null}
              {link.author ? <Badge variant="outline">by {link.author}</Badge> : null}
              <Badge variant="neutral">{formatDate(link.created_at)}</Badge>
              {link.reading_time_minutes ? (
                <Badge variant="secondary" icon={<BookOpen size={12} />}>
                  {formatReadingTime(link.reading_time_minutes)}
                </Badge>
              ) : null}
              {failed ? (
                <Badge variant="error" appearance="dot">Failed</Badge>
              ) : !isProcessed ? (
                <Badge variant="warning" appearance="dot">Processing</Badge>
              ) : null}
              {tags.map((tag) => (
                <Badge key={tag} variant="outline">{tag}</Badge>
              ))}
            </div>
          </div>
        </LayerCard>
      </div>

      <TagDialog
        open={tagsOpen}
        tags={tags}
        onOpenChange={setTagsOpen}
        onSave={(next) => onTagsChange(link.id, next)}
      />
      <DeleteDialog
        open={deleteOpen}
        title={link.title}
        onOpenChange={setDeleteOpen}
        onConfirm={() => onDelete(link.id)}
      />
    </>
  );
}
