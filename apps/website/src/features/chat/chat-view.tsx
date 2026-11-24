'use client';

import type { ProjectMessage, ProjectMessagePage } from '@devtrack/types';
import type { CreateChatMessageInput } from '@devtrack/validators';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDownIcon } from '@/components/icons';
import { Button, Divider, ErrorState } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useRealtimeConnected, useRealtimeRefresh, useRealtimeRoom } from '@/lib/realtime';
import { useProject } from '../projects/project-context';
import { useSession } from '../session/session-context';
import { ChatComposer } from './chat-composer';
import { ChatMessageItem, type OptimisticChatMessage } from './chat-message-item';
import { ChatPhoneNotifications } from './chat-phone-notifications';

function mergeMessages(
  previous: OptimisticChatMessage[],
  incoming: ProjectMessage[],
  viewerId: string,
) {
  const messages = new Map(previous.map((message) => [message.id, message]));
  for (const message of incoming) {
    if (message.author?.id === viewerId) messages.delete(`opt-${message.clientRequestId}`);
    messages.set(message.id, message);
  }
  return [...messages.values()].sort((a, b) => a.sequence - b.sequence);
}

export function ChatView() {
  const { project } = useProject();
  const searchParams = useSearchParams();
  const targetMessageId = searchParams.get('message') ?? undefined;
  return (
    <ChatThread key={`${project.id}:${targetMessageId ?? ''}`} targetMessageId={targetMessageId} />
  );
}

function ChatThread({ targetMessageId }: { targetMessageId?: string }) {
  const { project, members, readOnly, reloadChatUnread } = useProject();
  const { user } = useSession();

  const [messages, setMessages] = useState<OptimisticChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [hasMoreBefore, setHasMoreBefore] = useState(false);
  const [hasMoreAfter, setHasMoreAfter] = useState(false);
  const [unreadMessageId, setUnreadMessageId] = useState<string>();
  const [loadingNewer, setLoadingNewer] = useState(false);
  const [historyError, setHistoryError] = useState<string>();
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [accessLost, setAccessLost] = useState(false);
  const [awayFromLatest, setAwayFromLatest] = useState(false);
  const [sending, setSending] = useState(false);

  const isConnected = useRealtimeConnected();
  const listContainerRef = useRef<HTMLDivElement>(null);
  const unreadDividerRef = useRef<HTMLDivElement>(null);
  const scrollIntent = useRef<'unread' | 'latest' | null>(null);
  const isNearBottomRef = useRef(false);
  const maxAcknowledgedSeqRef = useRef(0);
  const historyVersionRef = useRef(0);

  // Follow the project room for live updates
  useRealtimeRoom(`project:${project.id}`);

  // Monotonically advance read state
  const acknowledgeRead = useCallback(
    async (seq: number) => {
      if (seq <= maxAcknowledgedSeqRef.current) return;
      const previous = maxAcknowledgedSeqRef.current;
      maxAcknowledgedSeqRef.current = seq;
      try {
        await api(`/projects/${project.id}/chat/read`, {
          method: 'PUT',
          body: { sequence: seq },
        });
        reloadChatUnread();
      } catch {
        if (maxAcknowledgedSeqRef.current === seq) maxAcknowledgedSeqRef.current = previous;
      }
    },
    [project.id, reloadChatUnread],
  );

  // Load initial messages
  useEffect(() => {
    let cancelled = false;
    const query = targetMessageId ? `around=${targetMessageId}&limit=50` : 'unread=1&limit=50';
    api<ProjectMessagePage>(`/projects/${project.id}/messages?${query}`)
      .then((page) => {
        if (cancelled) return;
        scrollIntent.current = page.unreadMessageId ? 'unread' : targetMessageId ? null : 'latest';
        setMessages(page.messages);
        setHasMoreBefore(page.hasMoreBefore);
        setHasMoreAfter(page.hasMoreAfter);
        setUnreadMessageId(page.unreadMessageId);
        setAccessLost(false);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoading(false);
        if (err instanceof ApiError && (err.status === 404 || err.status === 403)) {
          setAccessLost(true);
          setMessages([]);
        } else {
          setHistoryError('Could not load chat history.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [loadAttempt, project.id, targetMessageId]);

  const handleScroll = useCallback(() => {
    const el = listContainerRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const isNear = distanceToBottom < 80;
    isNearBottomRef.current = isNear;
    setAwayFromLatest(!isNear);
    if (isNear && !hasMoreAfter && !loading) {
      const latest = messages.findLast((message) => !message.status);
      if (latest) void acknowledgeRead(latest.sequence);
    }
  }, [acknowledgeRead, hasMoreAfter, loading, messages]);

  // Position the initial unread page, or follow the end when already caught up.
  useLayoutEffect(() => {
    const el = listContainerRef.current;
    if (loading || !el) return;
    const intent = scrollIntent.current;
    scrollIntent.current = null;
    if (intent === 'latest') el.scrollTop = el.scrollHeight;
    if (intent === 'unread' && unreadDividerRef.current) {
      el.scrollTop +=
        unreadDividerRef.current.getBoundingClientRect().top - el.getBoundingClientRect().top;
    }
    const frame = requestAnimationFrame(handleScroll);
    return () => cancelAnimationFrame(frame);
  }, [handleScroll, loading]);

  // Load earlier messages (preserves scroll position!)
  const loadEarlier = async () => {
    if (loadingEarlier || loadingNewer || messages.length === 0) return;
    const earliestSeq = Math.min(...messages.map((m) => m.sequence));
    const container = listContainerRef.current;
    const prevScrollHeight = container?.scrollHeight ?? 0;
    const prevScrollTop = container?.scrollTop ?? 0;

    setLoadingEarlier(true);
    try {
      const page = await api<ProjectMessagePage>(
        `/projects/${project.id}/messages?before=${earliestSeq}&limit=50`,
      );
      setHasMoreBefore(page.hasMoreBefore);

      setMessages((prev) => {
        const existingIds = new Set(prev.map((m) => m.id));
        const newOnes = page.messages.filter((m) => !existingIds.has(m.id));
        return [...newOnes, ...prev];
      });

      // Restore relative scroll position
      requestAnimationFrame(() => {
        if (container) {
          const newScrollHeight = container.scrollHeight;
          container.scrollTop = newScrollHeight - prevScrollHeight + prevScrollTop;
        }
      });
    } catch {
      // Error loading earlier
    } finally {
      setLoadingEarlier(false);
    }
  };

  async function loadNewer(jump: boolean) {
    if (loadingNewer || loadingEarlier) return;
    const latest = messages.findLast((message) => !message.status);
    if (!jump && !latest) return;
    const version = ++historyVersionRef.current;
    setLoadingNewer(true);
    setHistoryError(undefined);
    try {
      const query = jump ? 'limit=50' : `after=${latest!.sequence}&limit=50`;
      const page = await api<ProjectMessagePage>(`/projects/${project.id}/messages?${query}`);
      if (version !== historyVersionRef.current) return;
      if (jump) {
        scrollIntent.current = 'latest';
        setHasMoreBefore(page.hasMoreBefore);
      }
      setHasMoreAfter(page.hasMoreAfter);
      setMessages((prev) => {
        const kept = jump ? prev.filter((message) => message.status) : prev;
        return mergeMessages(kept, page.messages, user.id);
      });
    } catch (err: unknown) {
      if (version !== historyVersionRef.current) return;
      if (err instanceof ApiError && (err.status === 404 || err.status === 403)) {
        setAccessLost(true);
      } else {
        setHistoryError('Could not load newer messages. Try again.');
      }
    } finally {
      if (version === historyVersionRef.current) setLoadingNewer(false);
    }
  }

  // Reconcile messages from server
  const reconcileMessages = useCallback(async () => {
    if (loading || hasMoreAfter || loadingNewer) return;
    const version = historyVersionRef.current;
    try {
      const page = await api<ProjectMessagePage>(`/projects/${project.id}/messages?limit=50`);
      if (version !== historyVersionRef.current) return;
      if (isNearBottomRef.current) scrollIntent.current = 'latest';
      setMessages((prev) => mergeMessages(prev, page.messages, user.id));
    } catch (err: unknown) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 403)) {
        setAccessLost(true);
        setMessages([]);
      }
    }
  }, [project.id, user.id, loading, hasMoreAfter, loadingNewer]);

  // Real-time events refresh
  useRealtimeRefresh(
    (e) => e.projectId === project.id && e.type.startsWith('chat.'),
    () => {
      reconcileMessages();
    },
  );

  // Reconcile on tab focus or reconnect
  useEffect(() => {
    const onFocus = () => reconcileMessages();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [reconcileMessages]);

  // Polling every 15 seconds while disconnected
  useEffect(() => {
    if (isConnected) return;
    const interval = setInterval(() => {
      reconcileMessages();
    }, 15_000);
    return () => clearInterval(interval);
  }, [isConnected, reconcileMessages]);

  // Send message with optimistic update
  const handleSend = async (body: string, taskId?: string, file?: File) => {
    setSending(true);
    const clientRequestId = crypto.randomUUID();
    const input: CreateChatMessageInput = { body, clientRequestId, taskId };
    if (file) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        input.attachment = {
          name: file.name,
          base64: btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')),
        };
      } catch (error) {
        setSending(false);
        throw error;
      }
    }
    const highestSeq = messages.length > 0 ? Math.max(...messages.map((m) => m.sequence)) : 0;

    const optimistic: OptimisticChatMessage = {
      id: `opt-${clientRequestId}`,
      projectId: project.id,
      sequence: highestSeq + 1,
      clientRequestId,
      kind: 'user',
      github: null,
      author: {
        id: user.id,
        username: user.username,
        avatarUrl: user.avatarUrl,
      },
      body,
      attachment: file ? { name: file.name } : undefined,
      pendingInput: input,
      deleted: false,
      edited: false,
      task: null,
      mentions: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      editedAt: null,
      status: 'sending',
    };

    setMessages((prev) => [...prev, optimistic]);
    if (!hasMoreAfter) scrollIntent.current = 'latest';

    try {
      const res = await api<{ message: ProjectMessage }>(`/projects/${project.id}/messages`, {
        method: 'POST',
        body: input,
      });

      setMessages((prev) => mergeMessages(prev, [res.message], user.id));

      if (hasMoreAfter) void loadNewer(true);
      else void acknowledgeRead(res.message.sequence);
    } catch (error) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === optimistic.id
            ? {
                ...m,
                status: 'failed',
                errorMessage:
                  error instanceof ApiError
                    ? (error.details[0]?.message ?? error.message)
                    : 'Could not send message.',
              }
            : m,
        ),
      );
    } finally {
      setSending(false);
    }
  };

  // Retry failed optimistic message
  const handleRetry = async (failedMsg: OptimisticChatMessage) => {
    if (!failedMsg.pendingInput) return;
    setMessages((prev) =>
      prev.map((m) => (m.id === failedMsg.id ? { ...m, status: 'sending' } : m)),
    );

    try {
      const res = await api<{ message: ProjectMessage }>(`/projects/${project.id}/messages`, {
        method: 'POST',
        body: failedMsg.pendingInput,
      });

      setMessages((prev) => mergeMessages(prev, [res.message], user.id));

      if (hasMoreAfter) void loadNewer(true);
      else void acknowledgeRead(res.message.sequence);
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === failedMsg.id
            ? { ...m, status: 'failed', errorMessage: 'Could not send message.' }
            : m,
        ),
      );
    }
  };

  // Edit message
  const handleEdit = async (messageId: string, newBody: string) => {
    const res = await api<{ message: ProjectMessage }>(`/messages/${messageId}`, {
      method: 'PATCH',
      body: { body: newBody },
    });
    setMessages((prev) => prev.map((m) => (m.id === messageId ? res.message : m)));
  };

  // Delete message
  const handleDelete = async (messageId: string) => {
    await api(`/messages/${messageId}`, { method: 'DELETE' });
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId
          ? {
              ...m,
              deleted: true,
              body: null,
              task: null,
              mentions: [],
            }
          : m,
      ),
    );
  };

  if (accessLost) {
    return (
      <div className="space-y-4">
        <ErrorState
          message="You no longer have access to this project's chat."
          onRetry={reconcileMessages}
        />
        <Link href={`/workspaces/${project.workspaceId}/projects`} className="text-sm underline">
          Back to projects
        </Link>
      </div>
    );
  }

  // Group messages with date separators
  const renderedElements: React.JSX.Element[] = [];
  let lastDateStr = '';

  for (const m of messages) {
    const dateStr = new Date(m.createdAt).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    if (dateStr !== lastDateStr) {
      renderedElements.push(<Divider key={`date-${dateStr}`} label={dateStr} />);
      lastDateStr = dateStr;
    }

    if (m.id === unreadMessageId) {
      renderedElements.push(
        <div
          key="unread"
          ref={unreadDividerRef}
          className="flex items-center gap-3 py-3 text-xs font-semibold text-primary-soft-fg"
        >
          <span aria-hidden="true" className="h-px flex-1 bg-primary/40" />
          Unread messages
          <span aria-hidden="true" className="h-px flex-1 bg-primary/40" />
        </div>,
      );
    }

    renderedElements.push(
      <ChatMessageItem
        key={m.id}
        message={m}
        currentUser={user}
        canManage={project.viewerCanManage}
        readOnly={readOnly}
        isTarget={m.id === targetMessageId}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onRetry={handleRetry}
      />,
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 w-full flex-1 flex-col rounded-panel border border-line bg-surface lg:h-chat">
      <ChatPhoneNotifications key={project.id} projectId={project.id} />
      {/* Header bar / connection warning */}
      {!isConnected ? (
        <div className="border-b border-status-todo-bg bg-status-todo-bg px-4 py-1.5 text-xs text-status-todo-fg">
          Disconnected — reconnecting… polling for new messages every 15s.
        </div>
      ) : null}

      {/* Message history container */}
      <div
        ref={listContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-3 space-y-1"
      >
        {hasMoreBefore ? (
          <div className="py-2 text-center">
            <Button
              size="sm"
              variant="secondary"
              disabled={loadingEarlier || loadingNewer}
              onClick={loadEarlier}
            >
              {loadingEarlier ? 'Loading earlier messages…' : 'Load earlier messages'}
            </Button>
          </div>
        ) : null}

        {loading ? (
          <p className="py-8 text-center text-sm text-fg-subtle">Loading chat history…</p>
        ) : historyError && messages.length === 0 ? (
          <ErrorState
            message={historyError}
            onRetry={() => {
              setHistoryError(undefined);
              setLoading(true);
              setLoadAttempt((attempt) => attempt + 1);
            }}
          />
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center py-16 text-center text-fg-subtle">
            <p className="text-sm font-medium">No messages yet.</p>
            <p className="mt-1 text-xs">Start the conversation with your team.</p>
          </div>
        ) : (
          renderedElements
        )}
        {hasMoreAfter ? (
          <div className="py-2 text-center">
            <Button
              size="sm"
              variant="secondary"
              disabled={loadingNewer || loadingEarlier}
              onClick={() => void loadNewer(false)}
            >
              Load newer messages
            </Button>
          </div>
        ) : null}
      </div>

      {historyError && messages.length > 0 ? (
        <p role="alert" className="px-4 py-2 text-label text-danger">
          {historyError}
        </p>
      ) : null}

      {!loading && (awayFromLatest || hasMoreAfter) ? (
        <div className="flex shrink-0 justify-end border-t border-line px-3 py-1.5">
          <Button
            size="sm"
            variant="secondary"
            disabled={loadingNewer || loadingEarlier}
            onClick={() => void loadNewer(true)}
            className="max-lg:min-h-11"
            icon={<ChevronDownIcon size={16} />}
          >
            Jump to latest
          </Button>
        </div>
      ) : null}

      {/* Bottom composer */}
      <div className="border-t border-line p-3 bg-surface-sunken">
        <ChatComposer
          projectId={project.id}
          members={members}
          readOnly={readOnly}
          onSend={handleSend}
          sending={sending}
        />
      </div>
    </div>
  );
}
