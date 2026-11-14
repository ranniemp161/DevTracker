/** A short confirmation shown after an action, optionally with one follow-up (e.g. Undo). */
export interface ToastAction {
  label: string;
  onClick: () => void | Promise<void>;
}

export interface Toast {
  id: number;
  message: string;
  action?: ToastAction;
}

/** More than this and the oldest message makes room. */
export const MAX_TOASTS = 3;
/** How long a message stays when nobody hovers or focuses it. */
export const TOAST_DURATION_MS = 6_000;

export function pushToast(list: readonly Toast[], toast: Toast): Toast[] {
  return [...list, toast].slice(-MAX_TOASTS);
}

export function removeToast(list: readonly Toast[], id: number): Toast[] {
  return list.filter((t) => t.id !== id);
}
