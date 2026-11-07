'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { io, type Socket } from 'socket.io-client';
import { api } from './api';

/**
 * Real-time client (architecture §10, decision record 0007).
 *
 * - The socket connects to the API origin directly (`NEXT_PUBLIC_REALTIME_URL`) with a
 *   60-second ticket fetched through the same-origin `/api/v1` proxy, on every (re)connect.
 * - WebSocket transport only (Vercel Functions do not support long-polling).
 * - The server closes connections every few minutes; the client reconnects with exponential
 *   backoff (1 s doubling to 30 s), rejoins its rooms and asks components to reconcile.
 * - Events are hints: components refetch from the API, which stays the source of truth.
 *   Duplicates (at-least-once delivery) are dropped by envelope `id`.
 */

export interface RealtimeEvent {
  id: string;
  type: string;
  workspaceId: string | null;
  projectId: string | null;
  entity: { type: string; id: string };
  payload: Record<string, unknown>;
}

type Listener = (event: RealtimeEvent) => void;

const REALTIME_URL = process.env.NEXT_PUBLIC_REALTIME_URL ?? 'http://localhost:4000';
const REALTIME_PATH = '/api/v1/realtime/socket';
const MIN_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;
const SEEN_LIMIT = 500;

class RealtimeClient {
  private socket: Socket | null = null;
  private readonly rooms = new Map<string, number>();
  private readonly listeners = new Set<Listener>();
  private readonly reconnectListeners = new Set<() => void>();
  private readonly connectionListeners = new Set<(connected: boolean) => void>();
  private readonly seen: string[] = [];
  private backoff = MIN_BACKOFF_MS;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private everReady = false;
  private stopped = false;
  private connected = false;

  isConnected(): boolean {
    return this.connected;
  }

  private setConnected(val: boolean): void {
    if (this.connected === val) return;
    this.connected = val;
    for (const fn of this.connectionListeners) fn(val);
  }

  start(): void {
    if (this.socket || !REALTIME_URL) return;
    this.stopped = false;
    const socket = io(REALTIME_URL, {
      path: REALTIME_PATH,
      transports: ['websocket'],
      // We schedule reconnects ourselves: Socket.IO does not reconnect after the server closes
      // a connection, which ours does on purpose.
      reconnection: false,
      autoConnect: false,
      auth: (cb) => {
        api<{ token: string }>('/realtime/token', { method: 'POST' }).then(
          ({ token }) => cb({ token }),
          () => cb({}),
        );
      },
    });
    socket.on('realtime.ready', () => {
      this.backoff = MIN_BACKOFF_MS;
      this.setConnected(true);
      for (const room of this.rooms.keys()) socket.emit('subscribe', { room });
      if (this.everReady) for (const fn of this.reconnectListeners) fn();
      this.everReady = true;
    });
    socket.on('disconnect', () => {
      this.setConnected(false);
      this.scheduleReconnect();
    });
    socket.on('connect_error', () => {
      this.setConnected(false);
      this.scheduleReconnect();
    });
    socket.onAny((type: string, event: RealtimeEvent) => {
      if (type.startsWith('realtime.') || !event?.id) return;
      if (this.seen.includes(event.id)) return;
      this.seen.push(event.id);
      if (this.seen.length > SEEN_LIMIT) this.seen.shift();
      for (const fn of this.listeners) fn({ ...event, type });
    });
    this.socket = socket;
    socket.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.socket?.disconnect();
    this.socket = null;
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.retryTimer) return;
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.stopped && this.socket && !this.socket.connected) this.socket.connect();
    }, delay);
  }

  /** Reference-counted room membership. Returns the release function. */
  join(room: string): () => void {
    const count = this.rooms.get(room) ?? 0;
    this.rooms.set(room, count + 1);
    if (count === 0 && this.socket?.connected) this.socket.emit('subscribe', { room });
    return () => {
      const left = (this.rooms.get(room) ?? 1) - 1;
      if (left > 0) {
        this.rooms.set(room, left);
        return;
      }
      this.rooms.delete(room);
      if (this.socket?.connected) this.socket.emit('unsubscribe', { room });
    };
  }

  listen(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onReconnect(fn: () => void): () => void {
    this.reconnectListeners.add(fn);
    return () => this.reconnectListeners.delete(fn);
  }

  onConnectionChange(fn: (connected: boolean) => void): () => void {
    this.connectionListeners.add(fn);
    return () => this.connectionListeners.delete(fn);
  }
}

const RealtimeContext = createContext<RealtimeClient | null>(null);

/** One connection per signed-in browser tab. Mount inside the authenticated app shell. */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const client = useMemo(() => new RealtimeClient(), []);
  useEffect(() => {
    client.start();
    return () => client.stop();
  }, [client]);
  return <RealtimeContext.Provider value={client}>{children}</RealtimeContext.Provider>;
}

/** Follows `workspace:<id>` or `project:<id>` while mounted (pass null to skip). */
export function useRealtimeRoom(room: string | null): void {
  const client = useContext(RealtimeContext);
  useEffect(() => {
    if (!client || !room) return;
    return client.join(room);
  }, [client, room]);
}

/**
 * Calls `onChange` (debounced) when an event matching `match` arrives, and after every
 * reconnect, since events may have been missed while disconnected.
 */
export function useRealtimeRefresh(
  match: (event: RealtimeEvent) => boolean,
  onChange: () => void,
  debounceMs = 250,
): void {
  const client = useContext(RealtimeContext);
  const latest = useRef({ match, onChange });
  useEffect(() => {
    latest.current = { match, onChange };
  });
  useEffect(() => {
    if (!client) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const fire = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => latest.current.onChange(), debounceMs);
    };
    const offEvent = client.listen((event) => {
      if (latest.current.match(event)) fire();
    });
    const offReconnect = client.onReconnect(fire);
    return () => {
      offEvent();
      offReconnect();
      if (timer) clearTimeout(timer);
    };
  }, [client, debounceMs]);
}

/** Returns true if the WebSocket is currently open and ready. */
export function useRealtimeConnected(): boolean {
  const client = useContext(RealtimeContext);
  return useSyncExternalStore(
    (notify) => (client ? client.onConnectionChange(notify) : () => {}),
    () => (client ? client.isConnected() : false),
    () => false,
  );
}
