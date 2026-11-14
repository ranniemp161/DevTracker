import { describe, expect, it } from 'vitest';
import { MAX_TOASTS, pushToast, removeToast, type Toast } from './toast-queue';

const toast = (id: number): Toast => ({ id, message: `Message ${id}` });

describe('toast queue', () => {
  it('appends messages in order', () => {
    expect(pushToast([toast(1)], toast(2)).map((t) => t.id)).toEqual([1, 2]);
  });

  it('drops the oldest when the queue is full', () => {
    let list: Toast[] = [];
    for (let i = 1; i <= MAX_TOASTS + 1; i++) list = pushToast(list, toast(i));
    expect(list.map((t) => t.id)).toEqual([2, 3, 4]);
  });

  it('removes one message by id', () => {
    expect(removeToast([toast(1), toast(2)], 1).map((t) => t.id)).toEqual([2]);
    expect(removeToast([toast(1)], 9).map((t) => t.id)).toEqual([1]);
  });
});
