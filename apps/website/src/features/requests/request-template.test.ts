import { describe, expect, it } from 'vitest';
import { detailsForKind, detailsToSend, REQUEST_TEMPLATES } from './request-template';

describe('request details template', () => {
  it('swaps an empty or untouched template when the type changes', () => {
    expect(detailsForKind('', 'bug')).toBe(REQUEST_TEMPLATES.bug);
    expect(detailsForKind(REQUEST_TEMPLATES.bug, 'request')).toBe(REQUEST_TEMPLATES.request);
  });

  it('keeps what the sender wrote', () => {
    const written = `${REQUEST_TEMPLATES.bug}Clicked Pay, nothing happened.`;
    expect(detailsForKind(written, 'request')).toBe(written);
  });

  it('sends nothing for an untouched template', () => {
    expect(detailsToSend(REQUEST_TEMPLATES.request)).toBe('');
    expect(detailsToSend(`${REQUEST_TEMPLATES.request}Dark mode`)).toContain('Dark mode');
  });
});
