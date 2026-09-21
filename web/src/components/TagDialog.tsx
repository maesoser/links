import { useEffect, useState } from "react";
import { Button, Dialog, TagInput } from "@cloudflare/kumo";
import { X } from "lucide-react";

interface TagDialogProps {
  open: boolean;
  tags: string[];
  onOpenChange: (open: boolean) => void;
  onSave: (tags: string[]) => void;
}

export function TagDialog({ open, tags, onOpenChange, onSave }: TagDialogProps) {
  const [draft, setDraft] = useState<string[]>(tags);

  useEffect(() => {
    if (open) setDraft(tags);
  }, [open, tags]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog size="sm" className="p-6">
        <div className="mb-4 flex items-start justify-between gap-4">
          <Dialog.Title className="text-lg font-semibold">Edit tags</Dialog.Title>
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
          Add or remove tags for this link.
        </Dialog.Description>
        <TagInput
          label="Tags"
          placeholder="Add a tag"
          maxValues={12}
          value={draft}
          onValueChange={setDraft}
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
            onClick={() => {
              onSave(draft);
              onOpenChange(false);
            }}
          >
            Save
          </Button>
        </div>
      </Dialog>
    </Dialog.Root>
  );
}
