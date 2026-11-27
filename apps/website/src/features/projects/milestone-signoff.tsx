'use client';

import type { Milestone } from '@devtrack/types';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { formatDate } from './labels';

/**
 * Client sign-off (decision record 0028 §3–§4). Everyone sees the client's latest approval;
 * leads and admins get the private review link while the milestone is in Client review, to send
 * to the client however they like.
 */
export function MilestoneSignoff({
  milestone: m,
  canManage,
}: {
  milestone: Milestone;
  canManage: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const inReview = m.status === 'CLIENT_REVIEW';

  async function getLink(replace: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ url: string }>(`/milestones/${m.id}/signoff-link`, {
        body: { replace },
      });
      setUrl(res.url);
      setCopied(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (!m.clientApproval && !(canManage && inReview)) return null;

  return (
    <div className="mt-3 space-y-2">
      <h3 className="text-label font-medium text-fg-secondary">Client sign-off</h3>
      {m.clientApproval ? (
        <p className="text-sm text-status-done-fg">
          Approved by {m.clientApproval.name ?? 'the client'} on {formatDate(m.clientApproval.at)}
          {m.clientApproval.note ? (
            <span className="block text-fg-muted">“{m.clientApproval.note}”</span>
          ) : null}
        </p>
      ) : null}
      {canManage && inReview ? (
        url ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <input
                readOnly
                value={url}
                aria-label={`Sign-off link for ${m.name}`}
                onFocus={(e) => e.currentTarget.select()}
                className="h-7.5 min-w-0 flex-1 basis-60 rounded-control border border-line-control bg-surface px-2 font-mono text-xs text-fg"
              />
              <Button size="sm" onClick={() => void copy()}>
                {copied ? 'Copied' : 'Copy'}
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void getLink(true)}>
                Replace link
              </Button>
            </div>
            <p className="text-xs text-fg-muted">
              Send this to the client. It works while the milestone is in Client review. Replacing
              it stops the old link at once.
            </p>
          </div>
        ) : (
          <Button size="sm" disabled={busy} onClick={() => void getLink(false)}>
            Get sign-off link
          </Button>
        )
      ) : null}
      {error ? <p className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}
