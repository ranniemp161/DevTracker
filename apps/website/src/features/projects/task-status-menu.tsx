'use client';

import { TASK_STATUSES, type TaskStatus } from '@devtrack/types';
import { useEffect, useRef, useState } from 'react';
import { CheckIcon } from '@/components/icons';
import { StatusDot } from '@/components/ui';
import { TASK_STATUS_LABEL } from './labels';

/** Status dot button that opens a menu of statuses; works with keyboard and touch (SPEC R2). */
export function TaskStatusMenu({
  status,
  onSelect,
}: {
  status: TaskStatus;
  onSelect: (status: TaskStatus) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!open) return;
    items.current[TASK_STATUSES.indexOf(status)]?.focus();
    const onClick = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open, status]);

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  function onMenuKeyDown(e: React.KeyboardEvent) {
    const current = items.current.findIndex((el) => el === document.activeElement);
    const move = (index: number) => {
      e.preventDefault();
      items.current[(index + TASK_STATUSES.length) % TASK_STATUSES.length]?.focus();
    };
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') move(current + 1);
    else if (e.key === 'ArrowUp') move(current - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(TASK_STATUSES.length - 1);
    else if (e.key === 'Tab') setOpen(false);
  }

  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Status: ${TASK_STATUS_LABEL[status]}. Change status`}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex size-6.5 items-center justify-center rounded-chip transition-colors hover:bg-surface-muted"
      >
        <StatusDot status={status} className="size-2.5" />
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="Change status"
          onKeyDown={onMenuKeyDown}
          className="absolute top-full right-0 z-20 mt-1 w-44 rounded-card border border-line bg-surface p-1 shadow-overlay"
        >
          {TASK_STATUSES.map((s, i) => (
            <button
              key={s}
              ref={(el) => {
                items.current[i] = el;
              }}
              type="button"
              role="menuitemradio"
              aria-checked={s === status}
              onClick={() => {
                if (s !== status) onSelect(s);
                close();
              }}
              className="flex h-8 w-full items-center gap-2 rounded-control px-2 text-left text-sm text-fg-secondary hover:bg-surface-muted"
            >
              <StatusDot status={s} />
              <span className="flex-1">{TASK_STATUS_LABEL[s]}</span>
              {s === status ? <CheckIcon size={14} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
