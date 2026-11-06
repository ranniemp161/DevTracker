import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResendMailer } from './resend.mailer';

const message = {
  to: 'ada@example.com',
  subject: 'Hi',
  text: 'Link: https://x/#token=secret',
  html: '<p>Hi</p>',
};

describe('ResendMailer', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts the email to Resend with the API key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"id":"e1"}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await new ResendMailer('re_key', 'DevTrack <no-reply@devtrack.dev>').send(message);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.headers.Authorization).toBe('Bearer re_key');
    expect(JSON.parse(init.body)).toEqual({
      from: 'DevTrack <no-reply@devtrack.dev>',
      to: ['ada@example.com'],
      subject: 'Hi',
      text: message.text,
      html: '<p>Hi</p>',
    });
  });

  it('throws a description of the rejection that does not include the message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('{"name":"validation_error","message":"Domain is not verified"}', {
          status: 403,
        }),
      ),
    );
    const error = await new ResendMailer('re_key', 'a@b.c').send(message).catch((e: Error) => e);
    expect(String(error)).toMatch(/403 validation_error.*Domain is not verified/);
    expect(String(error)).not.toContain('secret');
  });
});
