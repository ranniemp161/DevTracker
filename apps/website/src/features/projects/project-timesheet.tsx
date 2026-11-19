'use client';

import type { ProjectTimesheetRow } from '@devtrack/types';
import Link from 'next/link';
import { useState } from 'react';
import { Button, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { useApiQuery } from '@/lib/use-api-query';
import { formatDate, formatMinutes } from './labels';
import { useProject } from './project-context';
import { localWorkDate } from './task-timer';

function currentPeriod() {
  const to = localWorkDate();
  return { from: `${to.slice(0, 7)}-01`, to };
}

function presetPeriods() {
  const month = currentPeriod();
  // Work with calendar dates so daylight-saving changes do not shift the boundaries.
  const today = new Date(`${month.to}T00:00:00Z`);
  const mondayOffset = (today.getUTCDay() + 6) % 7;
  const dateAt = (daysAgo: number) => {
    const date = new Date(today);
    date.setUTCDate(date.getUTCDate() - daysAgo);
    return date.toISOString().slice(0, 10);
  };
  return [
    { label: 'This week', from: dateAt(mondayOffset), to: month.to },
    { label: 'Last week', from: dateAt(mondayOffset + 7), to: dateAt(mondayOffset + 1) },
    { label: 'This month', ...month },
  ];
}

function collaboratorTotals(rows: ProjectTimesheetRow[]) {
  const totals = new Map<string, { id: string; name: string; minutes: number }>();
  for (const row of rows) {
    const id = row.user?.id ?? 'deleted';
    const previous = totals.get(id);
    totals.set(id, {
      id,
      name: row.user?.username ?? 'Deleted user',
      minutes: (previous?.minutes ?? 0) + row.minutes,
    });
  }
  return [...totals.values()].sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name));
}

const dateInput = 'h-9 rounded-control border border-line-control bg-surface px-2 text-sm text-fg';

export function ProjectTimesheet() {
  const { project } = useProject();
  const [period, setPeriod] = useState(currentPeriod);
  const [draft, setDraft] = useState(period);
  const [preset, setPreset] = useState<string | null>('This month');
  const query = useApiQuery<{ rows: ProjectTimesheetRow[] }>(
    `/projects/${project.id}/timesheet?from=${period.from}&to=${period.to}`,
  );
  const rows = query.data?.rows ?? [];
  const total = rows.reduce((sum, row) => sum + row.minutes, 0);
  const people = collaboratorTotals(rows);

  function apply(next: typeof period) {
    setDraft(next);
    if (next.from === period.from && next.to === period.to) query.reload();
    else setPeriod(next);
  }

  return (
    <section aria-labelledby="timesheet-heading" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="timesheet-heading" className="text-xl font-semibold tracking-tight">
          Timesheet
        </h2>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={rows.length === 0}
            size="sm"
            variant="secondary"
            onClick={() => window.print()}
          >
            Print report
          </Button>
          <Button
            disabled={rows.length === 0}
            size="sm"
            variant="secondary"
            onClick={() => downloadTimesheet(project.key, period, rows, total)}
          >
            Download CSV
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Date range shortcuts">
        {presetPeriods().map(({ label, from, to }) => (
          <Button
            key={label}
            size="md"
            className="max-md:min-h-11"
            variant={preset === label ? 'primary' : 'secondary'}
            aria-pressed={preset === label}
            onClick={() => {
              setPreset(label);
              apply({ from, to });
            }}
          >
            {label}
          </Button>
        ))}
      </div>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          setPreset(null);
          apply(draft);
        }}
      >
        <label className="grid gap-1 text-label text-fg-secondary">
          Start date
          <input
            className={dateInput}
            type="date"
            required
            value={draft.from}
            max={draft.to || undefined}
            onChange={(event) => setDraft({ ...draft, from: event.target.value })}
          />
        </label>
        <label className="grid gap-1 text-label text-fg-secondary">
          End date
          <input
            className={dateInput}
            type="date"
            required
            value={draft.to}
            min={draft.from || undefined}
            onChange={(event) => setDraft({ ...draft, to: event.target.value })}
          />
        </label>
        <Button type="submit" size="md" variant="secondary">
          Apply dates
        </Button>
      </form>
      {query.error ? (
        <ErrorState message="Could not load the timesheet." onRetry={query.reload} />
      ) : !query.data ? (
        <Skeleton className="h-32" />
      ) : (
        <div className="timesheet-report space-y-4">
          <div className="hidden print:block">
            <h2 className="text-2xl font-semibold">{project.name}</h2>
            <p>Timesheet</p>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-panel border border-line bg-surface-sunken px-4 py-3">
            <div>
              <p className="text-label text-fg-secondary">Total logged</p>
              <p className="text-2xl font-semibold tabular-nums">{formatMinutes(total)}</p>
            </div>
            <p className="text-sm text-fg-secondary">
              {formatDate(period.from)} to {formatDate(period.to)}
            </p>
          </div>
          {rows.length ? (
            <>
              <section aria-labelledby="timesheet-collaborators" className="space-y-2">
                <h3 id="timesheet-collaborators" className="text-label font-semibold">
                  By collaborator
                </h3>
                <dl className="grid gap-x-6 rounded-panel border border-line px-4 py-1 sm:grid-cols-2 print:block print:border-0 print:px-0">
                  {people.map((person) => (
                    <div
                      key={person.id}
                      className="flex min-w-0 items-baseline justify-between gap-4 border-b border-line-subtle py-2 text-sm"
                    >
                      <dt className="min-w-0 break-words text-fg-secondary">{person.name}</dt>
                      <dd className="shrink-0 font-medium tabular-nums">
                        {formatMinutes(person.minutes)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
              <section aria-labelledby="timesheet-tasks" className="space-y-2">
                <h3 id="timesheet-tasks" className="text-label font-semibold">
                  By task
                </h3>
                <div className="overflow-x-auto rounded-panel border border-line print:overflow-visible print:border-0">
                  <table className="w-full text-left text-sm">
                    <caption className="sr-only">Logged time by task and collaborator</caption>
                    <thead className="border-b border-line bg-surface-sunken text-fg-secondary">
                      <tr>
                        <th scope="col" className="px-4 py-2 font-medium">
                          Task
                        </th>
                        <th scope="col" className="px-4 py-2 font-medium">
                          Collaborator
                        </th>
                        <th scope="col" className="px-4 py-2 text-right font-medium">
                          Time
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {rows.map((row) => (
                        <tr key={`${row.taskId}:${row.user?.id ?? 'deleted'}`}>
                          <th scope="row" className="px-4 py-2.5 font-medium">
                            <Link
                              href={`/projects/${project.id}/tasks/${row.taskId}`}
                              className="hover:underline"
                            >
                              <span className="mr-2 whitespace-nowrap text-fg-secondary">
                                {project.key}-{row.taskNumber}
                              </span>
                              {row.taskTitle}
                            </Link>
                          </th>
                          <td className="px-4 py-2.5 text-fg-secondary">
                            {row.user?.username ?? 'Deleted user'}
                          </td>
                          <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">
                            {formatMinutes(row.minutes)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          ) : (
            <EmptyState>No time was logged in this date range.</EmptyState>
          )}
        </div>
      )}
    </section>
  );
}

function downloadTimesheet(
  key: string,
  period: ReturnType<typeof currentPeriod>,
  rows: ProjectTimesheetRow[],
  total: number,
) {
  const records = [
    ['Start date', 'End date', 'Task', 'Task title', 'Collaborator', 'Total minutes', 'Time'],
    ...rows.map((row) => [
      period.from,
      period.to,
      `${key}-${row.taskNumber}`,
      row.taskTitle,
      row.user?.username ?? 'Deleted user',
      String(row.minutes),
      formatMinutes(row.minutes),
    ]),
    [period.from, period.to, '', 'Total', '', String(total), formatMinutes(total)],
  ];
  const csv = records
    .map((record) =>
      record
        .map((cell) => {
          // Protect text supplied by users from being interpreted as spreadsheet formulas.
          const safe =
            /^[\s\uFEFF]*[=+\-@]/.test(cell) || /^[\t\r\n]/.test(cell) ? `'${cell}` : cell;
          return `"${safe.replaceAll('"', '""')}"`;
        })
        .join(','),
    )
    .join('\r\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${key}-timesheet-${period.from}-to-${period.to}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
