// credential-cipher.ts — AES-256-GCM encrypt/decrypt for ChannelConnection credentials.
// WHY: ChannelConnection.credentials stores a provider API key in Postgres. It must
//      never be stored in plaintext. This is the only place that key is encrypted or
//      decrypted — channels.service.ts calls encrypt() before saving and decrypt()
//      right before it hands a key to an adapter.

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // recommended IV size for GCM

/** Reads and validates the master key from env. Called once per encrypt/decrypt. */
function getKey(): Buffer {
  const raw = process.env.CHANNEL_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'CHANNEL_ENCRYPTION_KEY is not set — cannot store or read channel credentials.',
    );
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error('CHANNEL_ENCRYPTION_KEY must decode to exactly 32 bytes (AES-256).');
  }
  return key;
}

/** Encrypts a plaintext secret (e.g. a SendGrid API key) into one "iv:tag:ciphertext" string. */
export function encryptCredential(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(':');
}

/** Decrypts a blob produced by encryptCredential() back into the plaintext secret. */
export function decryptCredential(blob: string): string {
  const [ivB64, tagB64, dataB64] = blob.split(':');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Malformed credential blob — expected "iv:tag:ciphertext".');
  }
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}
