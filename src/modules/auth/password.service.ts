import argon2 from 'argon2';

// ─── PasswordService ──────────────────────────────────────────────────────────
//
// Wraps argon2id with project-wide defaults.
// Parameters are intentionally conservative for a shared-host environment;
// tune memoryCost / timeCost upward on dedicated hardware.

export class PasswordService {
  /** Hash a plaintext password. Returns the encoded hash string. */
  async hash(plaintext: string): Promise<string> {
    return argon2.hash(plaintext, {
      type: argon2.argon2id,
      memoryCost: 65_536, // 64 MiB
      timeCost: 3,
      parallelism: 1,
    });
  }

  /** Verify a plaintext password against a stored hash. */
  verify(hash: string, plaintext: string): Promise<boolean> {
    return argon2.verify(hash, plaintext);
  }
}

export const passwordService = new PasswordService();
