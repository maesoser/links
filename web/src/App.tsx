import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Banner,
  Button,
  Empty,
  InputGroup,
  Tabs,
  Text,
  useKumoToastManager,
} from "@cloudflare/kumo";
import {
  BookCheck,
  Check,
  Download,
  Inbox,
  Link as LinkIcon,
  Moon,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Star,
  Sun,
  Trash2,
  WifiOff,
  X,
} from "lucide-react";
import type { BulkAction, FilterValue, LinkItem, ThemeMode } from "./types";
import { AddLinkDialog } from "./components/AddLinkDialog";
import { LinkCard } from "./components/LinkCard";
import { ReaderDialog } from "./components/ReaderDialog";

const PAGE_SIZE = 50;

function getInitialTheme(): ThemeMode {
  const saved = localStorage.getItem("theme");
  return saved === "light" || saved === "dark" ? saved : "dark";
}

export default function App() {
  const toast = useKumoToastManager();
  const [theme, setTheme] = useState<ThemeMode>(getInitialTheme);
  const [online, setOnline] = useState(navigator.onLine);
  const [filter, setFilter] = useState<FilterValue>("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [readCount, setReadCount] = useState(0);
  const [starredCount, setStarredCount] = useState(0);
  const [loadError, setLoadError] = useState<"offline" | "failed" | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [readerLink, setReaderLink] = useState<LinkItem | null>(null);
  const [readerTab, setReaderTab] = useState<"summary" | "article">("summary");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    document.documentElement.setAttribute("data-mode", theme);
    localStorage.setItem("theme", theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute("content", theme === "dark" ? "#1a1a1a" : "#f5f5f5");
  }, [theme]);

  const listRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(handle);
  }, [search]);

  const loadStats = useCallback(async () => {
    try {
      const response = await fetch("/api/stats");
      if (!response.ok) return;
      const stats = await response.json();
      setUnreadCount(stats.unread ?? 0);
      setReadCount(stats.read ?? 0);
      setStarredCount(stats.starred ?? 0);
    } catch (error) {
      console.error("Failed to load stats:", error);
    }
  }, []);

  const fetchLinks = useCallback(
    async (append: boolean, nextOffset: number) => {
      try {
        let url = `/api/links?limit=${PAGE_SIZE}&offset=${nextOffset}`;
        if (filter === "unread" || filter === "read") url += `&status=${filter}`;
        if (filter === "starred") url += "&starred=1";
        if (filter === "failed") url += "&failed=1";
        if (debouncedSearch) url += `&search=${encodeURIComponent(debouncedSearch)}`;

        const response = await fetch(url);
        const data = await response.json();

        if (response.status === 503 && data.error === "offline") {
          if (!append) setLoadError("offline");
          return;
        }

        if (!response.ok) throw new Error(`Server error ${response.status}`);

        const newLinks: LinkItem[] = (data.links ?? []).map((link: LinkItem) => ({
          ...link,
          tags: link.tags ?? [],
          starred: Number(link.starred) || 0,
          is_pdf: Number(link.is_pdf) || 0,
        }));
        setTotal(data.total ?? 0);
        setOffset(nextOffset + newLinks.length);
        setLinks((prev) => (append ? [...prev, ...newLinks] : newLinks));
        if (!append) setSelected(new Set());
        setLoadError(null);
      } catch (error) {
        console.error("Failed to load links:", error);
        if (!append) setLoadError("failed");
      }
    },
    [filter, debouncedSearch]
  );

  const reload = useCallback(() => {
    setLinks([]);
    setOffset(0);
    listRef.current?.scrollTo(0, 0);
    void fetchLinks(false, 0);
  }, [fetchLinks]);

  useEffect(() => {
    reload();
    void loadStats();
  }, [reload, loadStats]);

  useEffect(() => {
    const on = () => {
      setOnline(true);
      reload();
      void loadStats();
    };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, [reload, loadStats]);

  const remaining = total - links.length;
  const selectedIds = useMemo(() => [...selected], [selected]);
  const selectionMode = selected.size > 0;

  function patchLink(id: string, patch: Partial<LinkItem>) {
    setLinks((prev) => prev.map((link) => (link.id === id ? { ...link, ...patch } : link)));
    setReaderLink((current) => (current?.id === id ? { ...current, ...patch } : current));
  }

  async function handleSave(url: string): Promise<boolean> {
    try {
      const response = await fetch("/api/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });

      if (response.status === 409) {
        toast.add({ title: "This URL has already been saved", variant: "warning" });
        return false;
      }

      if (response.status === 503) {
        const body = await response.json().catch(() => ({}));
        if (body.error === "offline") {
          toast.add({
            title: "You're offline — link cannot be saved right now",
            variant: "warning",
          });
          return false;
        }
      }

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Server error ${response.status}`);
      }

      toast.add({ title: "Link saved", variant: "success" });
      reload();
      void loadStats();
      return true;
    } catch (error) {
      const offline = !navigator.onLine;
      toast.add({
        title: offline
          ? "You're offline — link cannot be saved right now"
          : `Failed to add link: ${error instanceof Error ? error.message : String(error)}`,
        variant: offline ? "warning" : "error",
      });
      return false;
    }
  }

  async function handleToggle(id: string, currentStatus: LinkItem["status"]) {
    const newStatus = currentStatus === "read" ? "unread" : "read";
    try {
      const response = await fetch(`/api/links/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!response.ok) throw new Error(`Server error ${response.status}`);
      patchLink(id, { status: newStatus });
      void loadStats();
    } catch (error) {
      toast.add({
        title: `Failed to update link: ${error instanceof Error ? error.message : String(error)}`,
        variant: "error",
      });
    }
  }

  async function handleStar(id: string, starred: boolean) {
    try {
      const response = await fetch(`/api/links/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ starred }),
      });
      if (!response.ok) throw new Error(`Server error ${response.status}`);
      patchLink(id, { starred: starred ? 1 : 0 });
      void loadStats();
    } catch (error) {
      toast.add({
        title: `Failed to update link: ${error instanceof Error ? error.message : String(error)}`,
        variant: "error",
      });
    }
  }

  async function handleTagsChange(id: string, tags: string[]) {
    const previous = links.find((link) => link.id === id)?.tags ?? [];
    patchLink(id, { tags });
    try {
      const response = await fetch(`/api/links/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags }),
      });
      if (!response.ok) throw new Error(`Server error ${response.status}`);
      const updated = await response.json();
      patchLink(id, { tags: updated.tags ?? tags });
    } catch (error) {
      patchLink(id, { tags: previous });
      toast.add({
        title: `Failed to update tags: ${error instanceof Error ? error.message : String(error)}`,
        variant: "error",
      });
    }
  }

  async function handleDelete(id: string) {
    try {
      const response = await fetch(`/api/links/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(`Server error ${response.status}`);
      toast.add({ title: "Link deleted", variant: "success" });
      if (readerLink?.id === id) setReaderLink(null);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      reload();
      void loadStats();
    } catch (error) {
      toast.add({
        title: `Failed to delete link: ${error instanceof Error ? error.message : String(error)}`,
        variant: "error",
      });
    }
  }

  async function handleRetry(id: string) {
    try {
      const response = await fetch(`/api/links/${id}/reprocess`, { method: "POST" });
      if (!response.ok) throw new Error(`Server error ${response.status}`);
      toast.add({ title: "Reprocessing queued", variant: "success" });
      patchLink(id, { processing_status: "pending", processing_error: null });
    } catch (error) {
      toast.add({
        title: `Failed to retry: ${error instanceof Error ? error.message : String(error)}`,
        variant: "error",
      });
    }
  }

  async function handleBulk(action: BulkAction) {
    if (selectedIds.length === 0) return;
    try {
      const response = await fetch("/api/links/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: selectedIds, action }),
      });
      if (!response.ok) throw new Error(`Server error ${response.status}`);
      const labels: Record<BulkAction, string> = {
        read: "Marked as read",
        unread: "Marked as unread",
        delete: "Deleted",
        resummarize: "Queued for re-summarization",
        star: "Starred",
        unstar: "Unstarred",
      };
      toast.add({ title: labels[action], variant: "success" });
      setSelected(new Set());
      reload();
      void loadStats();
    } catch (error) {
      toast.add({
        title: `Bulk action failed: ${error instanceof Error ? error.message : String(error)}`,
        variant: "error",
      });
    }
  }

  function toggleSelect(id: string, value: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (value) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const emptyState = useMemo(() => {
    if (loadError === "offline") {
      return (
        <Empty
          icon={<WifiOff size={48} />}
          title="You're offline"
          description="Connect to the internet to load your links."
        />
      );
    }
    if (loadError === "failed") {
      return (
        <Empty
          title="Failed to load links"
          description="Please refresh to try again."
        />
      );
    }
    return (
      <Empty
        icon={<LinkIcon size={48} />}
        title="No links found"
        description="Try adjusting your filters or search"
        contents={
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => setAddOpen(true)}>
            Add a link
          </Button>
        }
      />
    );
  }, [loadError]);

  return (
    <div className="flex h-dvh flex-col bg-kumo-canvas text-kumo-default">
      <header className="flex shrink-0 items-center gap-3 border-b border-kumo-hairline bg-kumo-base px-4 pt-[env(safe-area-inset-top,0px)]">
        <div className="flex min-h-12 flex-1 items-center gap-3">
          <div className="flex items-center gap-2">
            <LinkIcon size={18} className="text-kumo-brand" />
            <Text variant="heading" as="h1">
              Links
            </Text>
          </div>
          {!online ? (
            <Banner
              size="sm"
              variant="alert"
              icon={<WifiOff size={14} />}
              description="Offline"
              className="py-1"
            />
          ) : null}
          <div className="ml-auto flex items-center gap-3 text-sm text-kumo-subtle">
            <span className="flex items-center gap-1" title="Unread" aria-label={`${unreadCount} unread`}>
              <Inbox size={14} aria-hidden="true" />
              <span className="tabular-nums text-kumo-default">{unreadCount}</span>
            </span>
            <span className="flex items-center gap-1" title="Read" aria-label={`${readCount} read`}>
              <BookCheck size={14} aria-hidden="true" />
              <span className="tabular-nums text-kumo-default">{readCount}</span>
            </span>
            <span className="flex items-center gap-1" title="Starred" aria-label={`${starredCount} starred`}>
              <Star size={14} aria-hidden="true" />
              <span className="tabular-nums text-kumo-default">{starredCount}</span>
            </span>
            <Button
              variant="ghost"
              size="sm"
              shape="square"
              icon={<Download size={16} />}
              aria-label="Export as JSON"
              title="Export as JSON"
              onClick={() => { window.location.href = '/api/export'; }}
            />
            <Button
              variant="ghost"
              size="sm"
              shape="square"
              icon={theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
              aria-label="Toggle theme"
              title="Toggle theme"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            />
          </div>
        </div>
      </header>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-kumo-hairline bg-kumo-base px-4 py-2">
        <Button
          variant="primary"
          size="sm"
          shape="square"
          icon={<Plus size={16} />}
          aria-label="Add link"
          title="Add link"
          onClick={() => setAddOpen(true)}
        />
        <Tabs
          variant="segmented"
          size="sm"
          className="shrink-0"
          value={filter}
          onValueChange={(value) => setFilter(value as FilterValue)}
          tabs={[
            { value: "all", label: "All" },
            { value: "unread", label: "Unread" },
            { value: "read", label: "Read" },
            { value: "starred", label: "Starred" },
            { value: "failed", label: "Failed" },
          ]}
        />
        <InputGroup size="sm" className="min-w-0 flex-1 basis-40">
          <InputGroup.Addon>
            <Search size={16} />
          </InputGroup.Addon>
          <InputGroup.Input
            type="search"
            placeholder="Search..."
            aria-label="Search links"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </InputGroup>
      </div>

      {selectionMode ? (
        <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-kumo-hairline bg-kumo-base px-4 py-2">
          <Text size="sm" as="span">{selected.size} selected</Text>
          <Button
            variant="ghost"
            size="sm"
            shape="square"
            icon={<Check size={16} />}
            aria-label="Mark read"
            title="Mark read"
            onClick={() => void handleBulk("read")}
          />
          <Button
            variant="ghost"
            size="sm"
            shape="square"
            icon={<RotateCcw size={16} />}
            aria-label="Mark unread"
            title="Mark unread"
            onClick={() => void handleBulk("unread")}
          />
          <Button
            variant="ghost"
            size="sm"
            shape="square"
            icon={<Star size={16} />}
            aria-label="Star"
            title="Star"
            onClick={() => void handleBulk("star")}
          />
          <Button
            variant="ghost"
            size="sm"
            shape="square"
            icon={<RefreshCw size={16} />}
            aria-label="Re-summarize"
            title="Re-summarize"
            onClick={() => void handleBulk("resummarize")}
          />
          <Button
            variant="ghost"
            size="sm"
            shape="square"
            icon={<Trash2 size={16} />}
            aria-label="Delete"
            title="Delete"
            onClick={() => void handleBulk("delete")}
          />
          <Button
            variant="ghost"
            size="sm"
            shape="square"
            icon={<X size={16} />}
            aria-label="Clear selection"
            title="Clear selection"
            onClick={() => setSelected(new Set())}
          />
        </div>
      ) : null}

      <main ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto flex max-w-3xl flex-col gap-2 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4 sm:pb-[max(1rem,env(safe-area-inset-bottom))]">
          {links.length === 0 ? (
            emptyState
          ) : (
            <>
              {links.map((link) => (
                <LinkCard
                  key={link.id}
                  link={link}
                  selected={selected.has(link.id)}
                  selectionMode={selectionMode}
                  onOpen={(id) => {
                    const found = links.find((item) => item.id === id) ?? null;
                    setReaderLink(found);
                    setReaderTab(found?.is_pdf ? "article" : "summary");
                  }}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                  onStar={handleStar}
                  onRetry={handleRetry}
                  onTagsChange={handleTagsChange}
                  onSelect={toggleSelect}
                />
              ))}
              {remaining > 0 ? (
                <div className="flex justify-center py-4">
                  <Button variant="secondary" onClick={() => void fetchLinks(true, offset)}>
                    Load more
                    <Text variant="secondary" size="xs" as="span">
                      {remaining} remaining
                    </Text>
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </main>

      <AddLinkDialog open={addOpen} onOpenChange={setAddOpen} onSave={handleSave} />
      <ReaderDialog
        link={readerLink}
        open={Boolean(readerLink)}
        tab={readerTab}
        onTabChange={setReaderTab}
        onRetry={handleRetry}
        onRefetch={handleRetry}
        onOpenChange={(open) => {
          if (!open) setReaderLink(null);
        }}
      />
    </div>
  );
}
