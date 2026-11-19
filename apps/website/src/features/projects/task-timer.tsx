'use client';

import type { ActiveTaskTimer } from '@devtrack/types';
import Link from 'next/link';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useToast } from '@/components/toaster';
import { Button } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/lib/use-api-query';

const activePath = '/time-tracker/active';

/** The calendar date in the viewer's time zone. */
export function localWorkDate(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

type TimerState = ReturnType<typeof useTimerState>;
const TimerContext = createContext<TimerState | null>(null);

function useTimerState() {
  const query = useApiQuery<{ timer: ActiveTaskTimer | null }>(activePath);
  const reload = query.reload;
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [override, setOverride] = useState<{
    base: typeof query.data;
    timer: ActiveTaskTimer | null;
  }>();
  const [saved, setSaved] = useState<{ taskId: string }>();
  const timer = override && override.base === query.data ? override.timer : query.data?.timer;

  useEffect(() => {
    window.addEventListener('focus', reload);
    return () => window.removeEventListener('focus', reload);
  }, [reload]);

  async function change(action: () => Promise<ActiveTaskTimer | null>, savedTaskId?: string) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      setOverride({ base: query.data, timer: await action() });
      if (savedTaskId) {
        setSaved({ taskId: savedTaskId });
        toast.show('Time entry saved.');
      }
    } catch (error) {
      toast.show(error instanceof ApiError ? error.message : 'Could not update the timer.');
    } finally {
      pending.current = false;
      setBusy(false);
      reload();
    }
  }

  function start(taskId: string) {
    void change(async () => {
      const response = await api<{ timer: ActiveTaskTimer }>(`/tasks/${taskId}/timer`, {
        body: { spentOn: localWorkDate(), replaceTimerId: timer?.id },
      });
      return response.timer;
    }, timer?.taskId);
  }

  function finish(discard: boolean) {
    if (!timer) return;
    if (discard && !window.confirm('Discard this timer without logging any time?')) return;
    void change(
      async () => {
        const path = `/time-tracker/${timer.id}`;
        await (discard ? api(path, { method: 'DELETE' }) : api(`${path}/stop`, { method: 'POST' }));
        return null;
      },
      discard ? undefined : timer.taskId,
    );
  }

  return { timer, busy, saved, error: query.error, reload, start, finish };
}

export function TaskTimerProvider({ children }: { children: ReactNode }) {
  const state = useTimerState();
  return <TimerContext.Provider value={state}>{children}</TimerContext.Provider>;
}

export function useTaskTimer() {
  const state = useContext(TimerContext);
  if (!state) throw new Error('TaskTimerProvider is missing.');
  return state;
}

export function ActiveTimerBar() {
  const { timer, busy, finish } = useTaskTimer();
  return timer ? <RunningTimer key={timer.id} timer={timer} busy={busy} finish={finish} /> : null;
}

function RunningTimer({
  timer,
  busy,
  finish,
}: {
  timer: ActiveTaskTimer;
  busy: boolean;
  finish: (discard: boolean) => void;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);
  const seconds = Math.max(0, Math.floor((now - Date.parse(timer.startedAt)) / 1000));
  const elapsed = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map((unit) => String(unit).padStart(2, '0'))
    .join(':');

  return (
    <section
      aria-label="Active work timer"
      className="shrink-0 border-b border-line bg-surface px-3 py-2 sm:px-7"
    >
      <div className="flex items-center gap-2 sm:gap-3">
        <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-primary" />
        <span
          role="timer"
          aria-label="Elapsed time"
          className="shrink-0 text-sm font-semibold tabular-nums"
        >
          {elapsed}
        </span>
        {timer.projectId ? (
          <Link
            href={`/projects/${timer.projectId}/tasks/${timer.taskId}`}
            className="min-w-0 flex-1 truncate text-sm text-fg-secondary hover:underline"
          >
            {timer.taskTitle}
          </Link>
        ) : (
          <span className="min-w-0 flex-1 truncate text-sm text-fg-secondary">
            Task unavailable
          </span>
        )}
        <Button
          variant="primary"
          size="sm"
          disabled={busy || !timer.canStop}
          onClick={() => finish(false)}
        >
          Stop
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => finish(true)}>
          Discard
        </Button>
      </div>
      {timer.projectId && !timer.canStop ? (
        <p className="mt-1 text-label text-fg-secondary">
          This project is archived. You can discard the timer.
        </p>
      ) : null}
      {seconds >= 86_400 ? (
        <p className="mt-1 text-label text-fg-secondary">
          Stopping saves up to 24 hours. Log any additional work separately.
        </p>
      ) : null}
    </section>
  );
}

export function TaskTimerButton({ taskId }: { taskId: string }) {
  const { timer, busy, error, reload, start, finish } = useTaskTimer();
  if (error && timer === undefined) {
    return (
      <Button size="sm" variant="secondary" onClick={reload}>
        Retry loading timer
      </Button>
    );
  }
  if (timer?.taskId === taskId) {
    return (
      <Button
        size="sm"
        variant="primary"
        disabled={busy || !timer.canStop}
        onClick={() => finish(false)}
      >
        Stop timer
      </Button>
    );
  }
  return (
    <Button
      size="sm"
      variant="primary"
      disabled={busy || timer === undefined || timer?.canStop === false}
      onClick={() => start(taskId)}
    >
      {timer ? 'Stop and switch' : 'Start timer'}
    </Button>
  );
}
