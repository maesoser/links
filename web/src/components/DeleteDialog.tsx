import { Button, Dialog } from "@cloudflare/kumo";

interface DeleteDialogProps {
  open: boolean;
  title?: string | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function DeleteDialog({ open, title, onOpenChange, onConfirm }: DeleteDialogProps) {
  return (
    <Dialog.Root role="alertdialog" open={open} onOpenChange={onOpenChange}>
      <Dialog size="sm" className="p-6">
        <Dialog.Title className="text-lg font-semibold">Delete link?</Dialog.Title>
        <Dialog.Description className="mt-2 text-kumo-subtle">
          {title
            ? `“${title}” will be permanently removed.`
            : "This link will be permanently removed."}
        </Dialog.Description>
        <div className="mt-6 flex justify-end gap-2">
          <Dialog.Close
            render={(props) => (
              <Button variant="secondary" {...props}>
                Cancel
              </Button>
            )}
          />
          <Button
            variant="destructive"
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}
          >
            Delete
          </Button>
        </div>
      </Dialog>
    </Dialog.Root>
  );
}
