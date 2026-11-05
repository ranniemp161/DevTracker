import { Injectable } from '@nestjs/common';
import { hash, parseOptions, verify, type Algorithm, type Options } from '@node-rs/argon2';

/**
 * Argon2id with OWASP's recommended minimum parameters (m=19 MiB, t=2, p=1).
 * `Algorithm` is an ambient const enum, so its value is written literally (Argon2id = 2).
 */
const ARGON2ID = 2 as Algorithm;
export const PASSWORD_HASH_OPTIONS: Options = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

@Injectable()
export class PasswordService {
  private dummyHash?: Promise<string>;

  hash(password: string): Promise<string> {
    return hash(password, PASSWORD_HASH_OPTIONS);
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false; // malformed hash
    }
  }

  /**
   * Burns the same CPU/memory as a real check when no account matches, so response
   * timing does not reveal whether an email is registered.
   */
  async verifyDummy(password: string): Promise<void> {
    this.dummyHash ??= this.hash('devtrack-dummy-password-for-timing');
    await this.verify(await this.dummyHash, password);
  }

  /** True when a stored hash was produced with weaker/different parameters than today's. */
  needsRehash(passwordHash: string): boolean {
    try {
      const p = parseOptions(passwordHash);
      return (
        p.algorithm !== ARGON2ID ||
        p.memoryCost !== PASSWORD_HASH_OPTIONS.memoryCost ||
        p.timeCost !== PASSWORD_HASH_OPTIONS.timeCost ||
        p.parallelism !== PASSWORD_HASH_OPTIONS.parallelism
      );
    } catch {
      return true;
    }
  }
}
