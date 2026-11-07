'use client';

import type { ProjectMessage, ProjectMessagePage } from '@devtrack/types';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Divider, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { useRealtimeConnected, useRealtimeRefresh, useRealtimeRoom } from '@/lib/realtime';
import { useProject } from '../projects/project-context';
import { useSession } from '../session/session-context';
import { ChatComposer } from './chat-composer';
import { ChatMessageItem, type OptimisticChatMessage } from './chat-message-item';

export function ChatView() {
  const { project, members, readOnly, reloadChatUnread } = useProject();
  const { user } = useSession();
  const searchParams = useSearchParams();
  const targetMessageId = searchParams.get('message') ?? undefined;

  const [messages, setMessages] = useState<OptimisticChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [hasMoreBefore, setHasMoreBefore] = useState(false);
  const [accessLost, setAccessLost] = useState(false);
  const [showNewMessagesBtn, setShowNewMessagesBtn] = useState(false);
  const [sending, setSending] = useState(false);

  const isConnected = useRealtimeConnected();
  const listContainerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const maxAcknowledgedSeqRef = useRef(0);

  // Follow the project room for live updates
  useRealtimeRoom(`project:${project.id}`);

  // Monotonically advance read state
  const acknowledgeRead = useCallback(
    async (seq: number) => {
      if (seq <= maxAcknowledgedSeqRef.current) return;
      maxAcknowledgedSeqRef.current = seq;
      try {
        await api(`/projects/${project.id}/chat/read`, {
          method: 'PUT',
          body: { sequence: seq },
        });
        reloadChatUnread();
      } catch {
        // Ignored; next read update will advance
      }
    },
    [project.id, reloadChatUnread],
  );

  // Load initial messages
  useEffect(() => {
    let cancelled = false;
    const query = targetMessageId ? `around=${targetMessageId}&limit=50` : 'limit=50';
    api<ProjectMessagePage>(`/projects/${project.id}/messages?${query}`)
      .then((page) => {
        if (cancelled) return;
        setMessages(page.messages);
        setHasMoreBefore(page.hasMoreBefore);
        setAccessLost(false);
        setLoading(false);
        if (page.messages.length > 0) {
          const highestSeq = Math.max(...page.messages.map((m) => m.sequence));
          void acknowledgeRead(highestSeq);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoading(false);
        if (err instanceof ApiError && (err.status === 404 || err.status === 403)) {
          setAccessLost(true);
          setMessages([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [project.id, targetMessageId, acknowledgeRead]);

  // Handle scroll events: track if near bottom and hide/show new messages button
  const handleScroll = () => {
    const el = listContainerRef.current;
    if (!el) return;
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const isNear = distanceToBottom < 80;
    isNearBottomRef.current = isNear;
    if (isNear) {
      setShowNewMessagesBtn(false);
      // If user reaches bottom, acknowledge the highest displayed sequence
      if (messages.length > 0) {
        const highestSeq = Math.max(...messages.map((m) => m.sequence));
        void acknowledgeRead(highestSeq);
      }
    }
  };

  // Scroll to bottom helper
  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    const el = listContainerRef.current;
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior });
    }
  };

  // Auto-scroll on initial load or target deep-link
  useEffect(() => {
    if (!loading && messages.length > 0 && !targetMessageId) {
      const el = listContainerRef.current;
      if (el) {
        el.scrollTo({ top: el.scrollHeight, behavior: 'auto' });
      }
    }
  }, [loading, messages.length, targetMessageId]);

  // Load earlier messages (preserves scroll position!)
  const loadEarlier = async () => {
    if (loadingEarlier || messages.length === 0) return;
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

  // Reconcile messages from server
  const reconcileMessages = useCallback(async () => {
    try {
      const page = await api<ProjectMessagePage>(`/projects/${project.id}/messages?limit=50`);
      setMessages((prev) => {
        // Merge latest with existing
        const map = new Map<string, OptimisticChatMessage>();
        for (const m of prev) map.set(m.id, m);
        for (const m of page.messages) map.set(m.id, m);
        const sorted = Array.from(map.values()).sort((a, b) => a.sequence - b.sequence);
        return sorted;
      });

      if (isNearBottomRef.current) {
        if (page.messages.length > 0) {
          const maxSeq = Math.max(...page.messages.map((m) => m.sequence));
          acknowledgeRead(maxSeq);
        }
      } else {
        setShowNewMessagesBtn(true);
      }
    } catch (err: unknown) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 403)) {
        setAccessLost(true);
        setMessages([]);
      }
    }
  }, [project.id, acknowledgeRead]);

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
  const handleSend = async (body: string, taskId?: string) => {
    const clientRequestId = crypto.randomUUID();
    const highestSeq = messages.length > 0 ? Math.max(...messages.map((m) => m.sequence)) : 0;

    const optimistic: OptimisticChatMessage = {
      id: `opt-${clientRequestId}`,
      projectId: project.id,
      sequence: highestSeq + 1,
      clientRequestId,
      author: {
        id: user.id,
        username: user.username,
        avatarUrl: user.avatarUrl,
      },
      body,
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
    setSending(true);
    isNearBottomRef.current = true;
    requestAnimationFrame(() => scrollToBottom('smooth'));

    try {
      const res = await api<{ message: ProjectMessage }>(`/projects/${project.id}/messages`, {
        method: 'POST',
        body: { body, clientRequestId, taskId },
      });

      setMessages((prev) =>
        prev.map((m) => (m.clientRequestId === clientRequestId ? res.message : m)),
      );

      acknowledgeRead(res.message.sequence);
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.clientRequestId === clientRequestId
            ? { ...m, status: 'failed', errorMessage: 'Could not send message.' }
            : m,
        ),
      );
    } finally {
      setSending(false);
    }
  };

  // Retry failed optimistic message
  const handleRetry = async (failedMsg: OptimisticChatMessage) => {
    if (!failedMsg.body) return;
    setMessages((prev) =>
      prev.map((m) =>
        m.clientRequestId === failedMsg.clientRequestId ? { ...m, status: 'sending' } : m,
      ),
    );

    try {
      const res = await api<{ message: ProjectMessage }>(`/projects/${project.id}/messages`, {
        method: 'POST',
        body: {
          body: failedMsg.body,
          clientRequestId: failedMsg.clientRequestId,
          taskId: failedMsg.task?.id,
        },
      });

      setMessages((prev) =>
        prev.map((m) => (m.clientRequestId === failedMsg.clientRequestId ? res.message : m)),
      );

      acknowledgeRead(res.message.sequence);
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.clientRequestId === failedMsg.clientRequestId
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
      <div className="space-y-4 max-w-xl mx-auto py-8">
        <ErrorState
          message="You no longer have access to this project's chat."
          onRetry={reconcileMessages}
        />
        <div className="text-center">
          <Link
            href={`/workspaces/${project.workspaceId}/projects`}
            className="text-xs font-medium text-accent hover:underline"
          >
            ← Back to projects
          </Link>
        </div>
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
    <div className="flex h-[calc(100dvh-13.5rem)] min-h-[440px] max-h-[850px] flex-col rounded-xl border border-border bg-surface shadow-xs overflow-hidden">
      {/* Disconnect warning bar */}
      {!isConnected ? (
        <div className="border-b border-amber-200 bg-amber-50/90 px-4 py-2 text-xs font-medium text-amber-900 flex items-center gap-2">
          <svg
            aria-hidden="true"
            className="size-4 shrink-0 text-amber-700"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
              clipRule="evenodd"
            />
          </svg>
          <span>Disconnected — reconnecting… polling for new messages every 15s.</span>
        </div>
      ) : null}

      {/* Message history container */}
      <div
        ref={listContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-2 custom-scrollbar"
      >
        {hasMoreBefore ? (
          <div className="py-2 text-center">
            <Button size="sm" variant="secondary" disabled={loadingEarlier} onClick={loadEarlier}>
              {loadingEarlier ? 'Loading earlier messages…' : 'Load earlier messages'}
            </Button>
          </div>
        ) : null}

        {loading ? (
          <div className="space-y-4 py-6">
            <Skeleton className="h-12 w-3/4 rounded-lg" />
            <Skeleton className="h-16 w-1/2 rounded-lg ml-auto" />
            <Skeleton className="h-12 w-2/3 rounded-lg" />
          </div>
        ) : messages.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <EmptyState
              title="No messages yet"
              description="Start the conversation with your project team."
            />
          </div>
        ) : (
          renderedElements
        )}
      </div>

      {/* Floating "New messages" button when scrolled up */}
      {showNewMessagesBtn ? (
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              scrollToBottom('smooth');
              setShowNewMessagesBtn(false);
            }}
            className="absolute bottom-3 right-6 z-10 flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-1.5 text-xs font-semibold text-white shadow-md hover:bg-accent-hover transition-colors"
          >
            ↓ New messages
          </button>
        </div>
      ) : null}

      {/* Bottom composer container */}
      <div className="border-t border-border p-3 sm:p-4 bg-subtle/30">
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
