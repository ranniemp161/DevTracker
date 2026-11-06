'use client';

import { Card } from '@/components/ui';
import { useProject } from '../projects/project-context';
import { ActivityFeed } from './activity-feed';

export function ProjectActivity() {
  const { project } = useProject();
  return (
    <Card title="Activity" description="Everything that happened in this project, newest first.">
      <ActivityFeed projectId={project.id} />
    </Card>
  );
}
