import { useEffect, useState } from "react";
import { Button, Dialog, Input } from "@cloudflare/kumo";
import { Plus, X } from "lucide-react";

interface AddLinkDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (url: string) => Promise<boolean>;
}

export function AddLinkDialog({ open, onOpenChange, onSave }: AddLinkDialogProps) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setUrl("");
      setError("");
      setSaving(false);
    }
  }, [open]);

  async function handleSave() {
    const rawUrl = url.trim();
    if (!rawUrl) {
      setError("Please enter a URL");
      return;
    }

    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("Protocol must be http or https");
      }
    } catch {
      setError("Please enter a valid http:// or https:// URL");
      return;
    }

    setSaving(true);
    const ok = await onSave(rawUrl);
    setSaving(false);
    if (ok) onOpenChange(false);
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog className="p-6">
        <div className="mb-4 flex items-start justify-between gap-4">
          <Dialog.Title className="text-lg font-semibold">Add a link</Dialog.Title>
          <Dialog.Close
            aria-label="Close"
            render={(props) => (
              <Button
                {...props}
                variant="secondary"
                shape="square"
                icon={<X size={16} />}
                aria-label="Close"
              />
            )}
          />
        </div>
        <Dialog.Description className="sr-only">
          Paste a URL to save it for later.
        </Dialog.Description>
        <Input
          type="url"
          label="URL"
          placeholder="https://example.com/article"
          value={url}
          error={error || undefined}
          onValueChange={(value) => {
            setUrl(value);
            setError("");
          }}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void handleSave();
            }
          }}
        />
        <div className="mt-6 flex justify-end gap-2">
          <Dialog.Close
            render={(props) => (
              <Button variant="secondary" {...props}>
                Cancel
              </Button>
            )}
          />
          <Button
            variant="primary"
            icon={<Plus size={16} />}
            loading={saving}
            onClick={() => void handleSave()}
          >
            Save
          </Button>
        </div>
      </Dialog>
    </Dialog.Root>
  );
}
