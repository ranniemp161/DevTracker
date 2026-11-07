import { HttpStatus, Inject, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Socket } from 'socket.io';
import { SessionsService } from '../auth/sessions.service';
import { AppException } from '../common/errors/app.exception';
import { isUuid } from '../common/pipes/uuid-param.pipe';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { ProjectAccessService } from '../projects/project-access.service';
import { WorkspaceAccessService } from '../workspaces/workspace-access.service';
import { verifyTicket } from './realtime-ticket';
import { parseSubscribableRoom, userRoom } from './rooms';

/** A client may follow at most this many workspace/project rooms at once. */
const MAX_ROOMS = 50;

interface SocketData {
  userId: string;
  sessionId: string;
  timer?: NodeJS.Timeout;
}

/**
 * Real-time gateway (architecture §10, decision record 0007).
 *
 * - **Connect:** the client presents a short-lived signed ticket. Its session must still exist
 *   and its email be verified; otherwise the socket is refused.
 * - **Rooms:** `user:<id>` is joined by the server. `workspace:<id>` and `project:<id>` are
 *   joined only through `subscribe`, which runs the same access checks as the REST API.
 * - **Lifetime:** the server closes every connection after `maxConnectionMs` (below Vercel's
 *   function limit). The client reconnects with a fresh ticket, so a revoked session or a lost
 *   membership stops receiving events within minutes, and clients reconcile from the API.
 *
 * Clients only receive event envelopes (IDs and small change sets); they load content through
 * the API, which enforces authorization again.
 */
@WebSocketGateway()
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly sessions: SessionsService,
    private readonly workspaces: WorkspaceAccessService,
    private readonly projects: ProjectAccessService,
  ) {}

  async handleConnection(socket: Socket): Promise<void> {
    const claims = verifyTicket(this.config.realtime.secret, socket.handshake.auth?.token);
    const auth = claims && isUuid(claims.sid) ? await this.sessions.findActive(claims.sid) : null;
    if (!claims || !auth || auth.user.id !== claims.uid || !auth.user.emailVerifiedAt) {
      socket.emit('realtime.error', { code: 'UNAUTHENTICATED' });
      socket.disconnect(true);
      return;
    }
    const data = socket.data as SocketData;
    data.userId = auth.user.id;
    data.sessionId = auth.session.id;
    data.timer = setTimeout(() => socket.disconnect(true), this.config.realtime.maxConnectionMs);
    data.timer.unref?.();
    await socket.join(userRoom(auth.user.id));
    socket.emit('realtime.ready', { userId: auth.user.id });
  }

  handleDisconnect(socket: Socket): void {
    const timer = (socket.data as SocketData).timer;
    if (timer) clearTimeout(timer);
  }

  @SubscribeMessage('subscribe')
  async subscribe(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { room?: unknown } | undefined,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const data = socket.data as SocketData;
    if (!data.userId) return { ok: false, error: 'UNAUTHENTICATED' };
    const room = parseSubscribableRoom(body?.room);
    if (!room) return { ok: false, error: 'INVALID_ROOM' };
    const name = `${room.kind}:${room.id}`;
    if (socket.rooms.has(name)) return { ok: true };
    if (socket.rooms.size > MAX_ROOMS) return { ok: false, error: 'TOO_MANY_ROOMS' };
    try {
      if (room.kind === 'workspace') await this.workspaces.require(data.userId, room.id);
      else await this.projects.require(data.userId, room.id);
    } catch (err) {
      if (err instanceof AppException) {
        // Same answer for "no access" and "does not exist", as in the REST API.
        return {
          ok: false,
          error: err.getStatus() === HttpStatus.FORBIDDEN ? 'FORBIDDEN' : 'NOT_FOUND',
        };
      }
      this.logger.error(
        'Room authorization failed',
        err instanceof Error ? err.stack : String(err),
      );
      return { ok: false, error: 'INTERNAL_ERROR' };
    }
    await socket.join(name);
    return { ok: true };
  }

  @SubscribeMessage('unsubscribe')
  async unsubscribe(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: { room?: unknown } | undefined,
  ): Promise<{ ok: true }> {
    const room = parseSubscribableRoom(body?.room);
    if (room) await socket.leave(`${room.kind}:${room.id}`);
    return { ok: true };
  }
}
