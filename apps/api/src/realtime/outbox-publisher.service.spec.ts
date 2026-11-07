import type { Database } from '@devtrack/database';
import { expect, it, vi } from 'vitest';
import { OutboxPublisher } from './outbox-publisher.service';

it('reports a missing publisher transport instead of silently pretending there is nothing to publish', async () => {
  const transaction = vi.fn();
  const publisher = new OutboxPublisher({ transaction } as unknown as Database);
  await expect(publisher.flush()).rejects.toThrow('transport has not been initialized');
  expect(transaction).not.toHaveBeenCalled();
});
