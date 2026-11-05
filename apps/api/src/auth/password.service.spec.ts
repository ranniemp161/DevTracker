import { hash } from '@node-rs/argon2';
import { describe, expect, it } from 'vitest';
import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('hashes with Argon2id at OWASP parameters (m=19456, t=2, p=1)', async () => {
    const h = await service.hash('correct horse battery staple');
    expect(h).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  });

  it('uses a unique salt per hash', async () => {
    expect(await service.hash('same password')).not.toBe(await service.hash('same password'));
  });

  it('verifies correct and rejects incorrect passwords', async () => {
    const h = await service.hash('correct horse battery staple');
    expect(await service.verify(h, 'correct horse battery staple')).toBe(true);
    expect(await service.verify(h, 'Correct horse battery staple')).toBe(false);
  });

  it('treats a malformed hash as a failed verification', async () => {
    expect(await service.verify('not-a-hash', 'anything')).toBe(false);
  });

  it('flags hashes made with other parameters for rehashing', async () => {
    const current = await service.hash('pw-123456');
    const weaker = await hash('pw-123456', { memoryCost: 8192, timeCost: 1, parallelism: 1 });
    expect(service.needsRehash(current)).toBe(false);
    expect(service.needsRehash(weaker)).toBe(true);
  });
});
