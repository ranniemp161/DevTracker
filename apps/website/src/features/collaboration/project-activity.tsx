'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { FilterChip } from '@/components/ui';
import { useProject } from '../projects/project-context';
import { ActivityFeed } from './activity-feed';
import { ACTIVITY_FILTERS, parseActivityCategory } from './activity-filter';

export function ProjectActivity() {
  const { project } = useProject();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const category = parseActivityCategory(searchParams.get('category'));
  const current = ACTIVITY_FILTERS.find((f) => f.value === category)!;

  function select(value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set('category', value);
    else params.delete('category');
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-fg-muted">
          Everything that happened in this project, newest first.
        </p>
        <div role="group" aria-label="Filter activity" className="flex flex-wrap gap-1.5">
          {ACTIVITY_FILTERS.map((f) => (
            <FilterChip
              key={f.label}
              pressed={f.value === category}
              onClick={() => select(f.value)}
            >
              {f.label}
            </FilterChip>
          ))}
        </div>
      </div>
      <ActivityFeed
        key={category ?? 'all'}
        projectId={project.id}
        groupByDay
        category={category ?? undefined}
        emptyMessage={current.empty}
      />
    </div>
  );
}
