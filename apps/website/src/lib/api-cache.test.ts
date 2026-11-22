import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  api: vi.fn<(path: string) => Promise<unknown>>(),
  writeListeners: [] as (() => void)[],
}));

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>();
  return {
    ...actual,
    api: mocks.api,
    onApiWrite: (fn: () => void) => {
      mocks.writeListeners.push(fn);
      return () => undefined;
    },
  };
});

const { ApiError } = await import('./api');
const { clearApiCache, fetchIntoCache, readCache, revalidate, subscribeCache } =
  await import('./api-cache');

/** A request the test answers by hand. */
function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  clearApiCache();
  mocks.api.mockReset();
  vi.useRealTimers();
});

describe('api cache', () => {
  it('shares a request already in flight', async () => {
    mocks.api.mockResolvedValue({ n: 1 });
    await Promise.all([fetchIntoCache('/a'), fetchIntoCache('/a')]);
    expect(mocks.api).toHaveBeenCalledTimes(1);
    expect(readCache('/a')?.data).toEqual({ n: 1 });
  });

  it('keeps cached data on screen while it refreshes in the background', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    mocks.api.mockResolvedValueOnce({ n: 1 });
    await fetchIntoCache('/a');

    vi.setSystemTime(Date.now() + 10_000);
    const next = deferred();
    mocks.api.mockReturnValueOnce(next.promise);
    revalidate('/a');
    expect(readCache('/a')?.data).toEqual({ n: 1 });

    next.resolve({ n: 2 });
    await flush();
    expect(readCache('/a')?.data).toEqual({ n: 2 });
  });

  it('does not refetch data fetched a moment ago', async () => {
    mocks.api.mockResolvedValue({ n: 1 });
    await fetchIntoCache('/a');
    revalidate('/a');
    expect(mocks.api).toHaveBeenCalledTimes(1);
  });

  it('lets a forced reload win over an older request that answers later', async () => {
    const older = deferred();
    const newer = deferred();
    mocks.api.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    void fetchIntoCache('/a');
    void fetchIntoCache('/a', true);

    newer.resolve('new');
    await flush();
    older.resolve('old');
    await flush();
    expect(readCache('/a')?.data).toBe('new');
  });

  it('stores failures, and a new mount loads again instead of showing the old one', async () => {
    mocks.api.mockRejectedValueOnce(new ApiError(404, 'NOT_FOUND', 'Gone'));
    await fetchIntoCache('/a');
    expect(readCache('/a')?.error?.status).toBe(404);
    expect(readCache('/a')?.data).toBeUndefined();

    const next = deferred();
    mocks.api.mockReturnValueOnce(next.promise);
    revalidate('/a');
    expect(readCache('/a')).toBeUndefined();
    next.resolve('ok');
    await flush();
    expect(readCache('/a')?.data).toBe('ok');
  });

  it('wraps unknown failures in an ApiError', async () => {
    mocks.api.mockRejectedValueOnce(new Error('boom'));
    await fetchIntoCache('/a');
    expect(readCache('/a')?.error).toBeInstanceOf(ApiError);
  });

  it('forgets everything when the session has ended', async () => {
    mocks.api.mockResolvedValueOnce('private');
    await fetchIntoCache('/a');
    mocks.api.mockRejectedValueOnce(new ApiError(401, 'UNAUTHENTICATED', 'Sign in'));
    await fetchIntoCache('/b');
    expect(readCache('/a')).toBeUndefined();
    expect(readCache('/b')?.error?.status).toBe(401);
  });

  it('after a write, drops only what no screen is showing', async () => {
    mocks.api.mockResolvedValue('x');
    await Promise.all([fetchIntoCache('/shown'), fetchIntoCache('/hidden')]);
    const unsubscribe = subscribeCache('/shown', () => undefined);

    mocks.writeListeners.forEach((fn) => fn());
    expect(readCache('/shown')?.data).toBe('x');
    expect(readCache('/hidden')).toBeUndefined();
    unsubscribe();
  });

  it('tells subscribers about changes, and clearing empties the cache', async () => {
    const onChange = vi.fn();
    const unsubscribe = subscribeCache('/a', onChange);
    mocks.api.mockResolvedValue('x');
    await fetchIntoCache('/a');
    expect(onChange).toHaveBeenCalledTimes(1);

    clearApiCache();
    expect(readCache('/a')).toBeUndefined();
    expect(onChange).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});
