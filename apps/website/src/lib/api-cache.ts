import { api, ApiError, onApiWrite } from './api';

/** What the cache holds for one path: the last response, or the last failure. */
export interface CacheEntry {
  data?: unknown;
  error?: ApiError;
}

/** A response this recent is reused instead of fetched again (e.g. two screens mounting together). */
const FRESH_MS = 2_000;
/** Entries kept for screens that aren't mounted; the oldest unused ones go first. */
const MAX_ENTRIES = 200;

const entries = new Map<string, CacheEntry & { at: number }>();
const listeners = new Map<string, Set<() => void>>();
const inflight = new Map<string, { id: number; promise: Promise<void> }>();
let nextRequestId = 0;

function notify(path: string) {
  listeners.get(path)?.forEach((fn) => fn());
}

function toApiError(err: unknown): ApiError {
  return err instanceof ApiError ? err : new ApiError(0, 'INTERNAL_ERROR', 'Something went wrong.');
}

function store(path: string, entry: CacheEntry) {
  entries.delete(path); // re-insert so Map order is least recently written first
  entries.set(path, { ...entry, at: Date.now() });
  for (const key of entries.keys()) {
    if (entries.size <= MAX_ENTRIES) break;
    if (!listeners.get(key)?.size) entries.delete(key);
  }
  notify(path);
}

/** Loads the data for a cache key. Defaults to `api(path)`; lists that span pages pass their own. */
export type Loader = (path: string) => Promise<unknown>;

/** Replaces the cached data for `path`, e.g. after an optimistic update on screen. */
export function writeCache(path: string, data: unknown): void {
  store(path, { data });
}

/** The cached entry for `path`, if any. Stable between changes, for `useSyncExternalStore`. */
export function readCache(path: string): CacheEntry | undefined {
  return entries.get(path);
}

/** Calls `fn` whenever the entry for `path` changes. Returns the unsubscribe function. */
export function subscribeCache(path: string, fn: () => void): () => void {
  let set = listeners.get(path);
  if (!set) listeners.set(path, (set = new Set()));
  set.add(fn);
  return () => {
    set.delete(fn);
    if (!set.size) listeners.delete(path);
  };
}

/**
 * Fetches `path` into the cache. Shares a request already in flight unless `force` is set;
 * with `force`, a newer request wins over an older one that answers later.
 */
export function fetchIntoCache(path: string, force = false, load: Loader = api): Promise<void> {
  const running = inflight.get(path);
  if (running && !force) return running.promise;
  const id = ++nextRequestId;
  const promise = load(path).then(
    (data) => {
      if (inflight.get(path)?.id === id) store(path, { data });
    },
    (err: unknown) => {
      const error = toApiError(err);
      if (error.status === 401) {
        // Signed out: nothing cached for that session may be shown to the next one.
        clearApiCache();
        store(path, { error });
        return;
      }
      if (inflight.get(path)?.id === id) store(path, { error });
    },
  );
  inflight.set(path, { id, promise });
  void promise.finally(() => {
    if (inflight.get(path)?.id === id) inflight.delete(path);
  });
  return promise;
}

/**
 * A screen showing `path` mounted: keep what is cached on screen and refresh it in the
 * background, unless it was fetched a moment ago. A cached failure is not shown again;
 * the screen loads as if nothing were cached.
 */
export function revalidate(path: string, load?: Loader): void {
  const entry = entries.get(path);
  if (entry?.error) {
    entries.delete(path);
    notify(path);
  } else if (entry && Date.now() - entry.at < FRESH_MS) {
    return;
  }
  void fetchIntoCache(path, false, load);
}

/** Forgets everything, e.g. on sign-out, so the next session starts empty. */
export function clearApiCache(): void {
  inflight.clear();
  const paths = [...entries.keys()];
  entries.clear();
  paths.forEach(notify);
}

// After any write, data that no screen is showing may be out of date: drop it, so those
// screens load fresh next time, as they did before the cache. Screens on view keep their
// data and refresh themselves the way they always have.
onApiWrite(() => {
  for (const path of [...entries.keys()]) {
    if (!listeners.get(path)?.size) entries.delete(path);
  }
});
