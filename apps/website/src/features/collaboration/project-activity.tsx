'use client';

import { useProject } from '../projects/project-context';
import { ActivityFeed } from './activity-feed';

export function ProjectActivity() {
  const { project } = useProject();
  return (
    <div className="space-y-4">
      <p className="text-sm text-fg-muted">
        Everything that happened in this project, newest first.
      </p>
      <ActivityFeed projectId={project.id} groupByDay />
    </div>
  );
}
