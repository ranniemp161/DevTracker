import type { Database } from '@devtrack/database';
import type { Server } from 'socket.io';
import { expect, it, vi } from 'vitest';
import { OutboxPublisher } from './outbox-publisher.service';

it('reports a missing publisher transport instead of silently pretending there is nothing to publish', async () => {
  const transaction = vi.fn();
  const publisher = new OutboxPublisher({ transaction } as unknown as Database);
  await expect(publisher.flush()).rejects.toThrow('transport has not been initialized');
  expect(transaction).not.toHaveBeenCalled();
});

it('leaves outbox rows queued while the transport is down, and resumes when it is back', async () => {
  const transaction = vi.fn().mockResolvedValue({ published: 2, skippedStale: 0 });
  const publisher = new OutboxPublisher({ transaction } as unknown as Database);
  let ready = false;
  publisher.attach({} as Server, undefined, () => ready);

  await expect(publisher.flush()).resolves.toEqual({ published: 0, skippedStale: 0, paused: true });
  expect(transaction).not.toHaveBeenCalled();

  ready = true;
  await expect(publisher.flush()).resolves.toEqual({ published: 2, skippedStale: 0 });
  expect(transaction).toHaveBeenCalledTimes(1);
});
