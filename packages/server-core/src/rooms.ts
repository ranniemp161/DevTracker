/**
 * Socket.IO rooms (architecture §10). Clients never join a room by name alone: the gateway
 * authorizes every join, and `user:` rooms are joined only by the server.
 */
export type RoomKind = 'workspace' | 'project' | 'user';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ROOM_PATTERN = new RegExp(`^(workspace|project):(${UUID})$`);

export const userRoom = (userId: string) => `user:${userId}`;
export const projectRoom = (projectId: string) => `project:${projectId}`;
export const workspaceRoom = (workspaceId: string) => `workspace:${workspaceId}`;

/** A room a client may ask to join (`workspace:<uuid>` or `project:<uuid>`), else null. */
export function parseSubscribableRoom(
  room: unknown,
): { kind: 'workspace' | 'project'; id: string } | null {
  if (typeof room !== 'string') return null;
  const match = ROOM_PATTERN.exec(room.toLowerCase());
  return match ? { kind: match[1] as 'workspace' | 'project', id: match[2]! } : null;
}

export interface OutboxEnvelope {
  type: string;
  workspaceId: string | null;
  projectId: string | null;
  entity: { type: string; id: string };
}

/**
 * Where an outbox event goes:
 * - notifications go only to their recipient (`aggregate_id` is the user);
 * - project events go to the project room;
 * - workspace-level events (no project) go to the workspace room.
 */
export function roomsFor(
  eventType: string,
  aggregateId: string,
  envelope: OutboxEnvelope,
): string[] {
  if (eventType.startsWith('notification.') || eventType === 'chat.read')
    return [userRoom(aggregateId)];
  if (envelope.projectId) return [projectRoom(envelope.projectId)];
  if (envelope.workspaceId) return [workspaceRoom(envelope.workspaceId)];
  return [];
}
