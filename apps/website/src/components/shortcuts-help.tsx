'use client';

import { useEffect, useId, useRef } from 'react';
import { SHORTCUT_HELP } from '@/lib/shortcuts';
import { Button } from './ui';

/** The `?` dialog: every keyboard shortcut, grouped by where it works. */
export function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => e.target === e.currentTarget && dialog.current?.close()}
      className="m-auto w-full max-w-md rounded-panel border border-line bg-surface p-0 text-fg shadow-overlay backdrop:bg-fg/40"
    >
      <div className="space-y-5 p-5">
        <h2 id={titleId} className="text-md font-semibold">
          Keyboard shortcuts
        </h2>
        {SHORTCUT_HELP.map((group) => (
          <section key={group.group} className="space-y-2">
            <h3 className="text-xs font-medium text-fg-muted">{group.group}</h3>
            <dl className="space-y-1.5">
              {group.items.map((item) => (
                <div key={item.label} className="flex items-center justify-between gap-3 text-sm">
                  <dt className="text-fg-secondary">{item.label}</dt>
                  <dd className="flex shrink-0 gap-1">
                    {item.keys.map((k) => (
                      <kbd
                        key={k}
                        className="min-w-6 rounded-kbd border border-line bg-surface-muted px-1.5 text-center text-xs text-fg"
                      >
                        {k}
                      </kbd>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        <p className="text-xs text-fg-subtle">Shortcuts pause while you type in a field.</p>
        <div className="flex justify-end">
          <Button variant="ghost" onClick={() => dialog.current?.close()}>
            Close
          </Button>
        </div>
      </div>
    </dialog>
  );
}
