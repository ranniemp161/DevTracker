'use client';

import { useEffect, useRef } from 'react';

/** A single-key shortcut, optionally with Ctrl/⌘ (`mod`). Letters match either case. */
export interface Shortcut {
  key: string;
  mod?: boolean;
  run: () => void;
}

/**
 * True when a keypress belongs to something else: typing in a field, an open menu or dialog,
 * or a key combination the shortcut doesn't ask for. Shortcuts never fire then.
 */
export function isShortcutBlocked(event: KeyboardEvent, wantsMod = false): boolean {
  if (event.defaultPrevented || event.isComposing || event.altKey) return true;
  const mod = event.ctrlKey || event.metaKey;
  if (mod !== wantsMod) return true;
  const target = event.target as HTMLElement | null;
  // Ctrl/⌘ shortcuts (like save) also work while typing; plain keys never do.
  if (!wantsMod && target) {
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
      return true;
    }
  }
  return Boolean(document.querySelector('dialog[open], :popover-open'));
}

/** Whether `event` is the given shortcut (letters case-insensitive, `?` with or without Shift). */
export function matchesShortcut(event: KeyboardEvent, shortcut: Pick<Shortcut, 'key' | 'mod'>) {
  if (isShortcutBlocked(event, shortcut.mod)) return false;
  return event.key.toLowerCase() === shortcut.key.toLowerCase();
}

/** Registers page shortcuts while the component is mounted. The latest handlers always run. */
export function useShortcuts(shortcuts: Shortcut[], enabled = true) {
  const latest = useRef(shortcuts);
  useEffect(() => {
    latest.current = shortcuts;
  });
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      const hit = latest.current.find((s) => matchesShortcut(event, s));
      if (!hit) return;
      event.preventDefault();
      hit.run();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

/** Clicks the first visible element matching `selector` (e.g. a property chip). */
export function clickFirst(selector: string): boolean {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el || (el as HTMLButtonElement).disabled) return false;
  el.click();
  return true;
}

/** Shortcuts listed in the `?` help dialog. */
export const SHORTCUT_HELP: { group: string; items: { keys: string[]; label: string }[] }[] = [
  {
    group: 'Anywhere',
    items: [
      { keys: ['Ctrl/⌘', 'K'], label: 'Search tasks and projects' },
      { keys: ['?'], label: 'Show keyboard shortcuts' },
    ],
  },
  {
    group: 'Board',
    items: [
      { keys: ['N'], label: 'New task' },
      { keys: ['/'], label: 'Search tasks on the board' },
    ],
  },
  {
    group: 'Task page',
    items: [
      { keys: ['S'], label: 'Change status' },
      { keys: ['P'], label: 'Change priority' },
      { keys: ['A'], label: 'Assign someone' },
      { keys: ['L'], label: 'Add a label' },
      { keys: ['D'], label: 'Set the due date' },
      { keys: ['M'], label: 'Choose a milestone' },
      { keys: ['E'], label: 'Edit the description' },
      { keys: ['C'], label: 'Write a comment' },
      { keys: ['J'], label: 'Next task' },
      { keys: ['K'], label: 'Previous task' },
      { keys: ['Ctrl/⌘', 'S'], label: 'Save changes' },
      { keys: ['Esc'], label: 'Back to the board' },
    ],
  },
];
