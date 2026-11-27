'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Button } from './ui';

/**
 * Modal confirmation built on the native <dialog>: the browser makes the page inert,
 * traps focus, closes on Escape or the back gesture, and returns focus to the opener.
 * Escape and Cancel both count as "cancel".
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  tone = 'danger',
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  tone?: 'danger' | 'primary';
  /** Keeps the confirm button off until the dialog's own fields are filled in. */
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={children ? bodyId : undefined}
      onClose={(e) => {
        const dialog = e.currentTarget;
        const confirmed = dialog.returnValue === 'confirm';
        // Escape sets no value and browsers differ on clearing the old one.
        dialog.returnValue = '';
        if (confirmed) onConfirm();
        else onCancel();
      }}
      className="m-auto max-w-dialog rounded-panel border border-line bg-surface p-5 text-fg shadow-overlay backdrop:bg-fg/40"
    >
      <h2 id={titleId} className="text-md font-semibold">
        {title}
      </h2>
      {children ? (
        <div id={bodyId} className="mt-2 text-sm text-fg-muted">
          {children}
        </div>
      ) : null}
      <form method="dialog" className="mt-5 flex flex-wrap justify-end gap-2">
        {/* The safe action takes focus, so Enter never confirms by accident. */}
        <Button type="submit" value="cancel" variant="ghost" autoFocus>
          Cancel
        </Button>
        <Button type="submit" value="confirm" variant={tone} disabled={confirmDisabled}>
          {confirmLabel}
        </Button>
      </form>
    </dialog>
  );
}
