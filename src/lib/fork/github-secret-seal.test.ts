import { blake2b } from 'blakejs';
import nacl from 'tweetnacl';
import { describe, expect, it } from 'vitest';
import { sealGithubSecret } from './github-secret-seal';

function base64ToUint8(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** Reference `crypto_box_seal_open` to verify the seal round-trips. */
function openSealed(
  sealedBase64: string,
  recipientPk: Uint8Array,
  recipientSk: Uint8Array
): string | null {
  const sealed = base64ToUint8(sealedBase64);
  const epk = sealed.slice(0, nacl.box.publicKeyLength);
  const cipher = sealed.slice(nacl.box.publicKeyLength);
  const nonceInput = new Uint8Array(epk.length + recipientPk.length);
  nonceInput.set(epk, 0);
  nonceInput.set(recipientPk, epk.length);
  const nonce = blake2b(nonceInput, undefined, nacl.box.nonceLength);
  const opened = nacl.box.open(cipher, nonce, epk, recipientSk);
  return opened ? new TextDecoder().decode(opened) : null;
}

describe('sealGithubSecret', () => {
  it('produces a sealed box the recipient can open', () => {
    const recipient = nacl.box.keyPair();
    const secret = 'super-secret-cloudflare-token-1234567890';

    const sealed = sealGithubSecret(uint8ToBase64(recipient.publicKey), secret);

    expect(openSealed(sealed, recipient.publicKey, recipient.secretKey)).toBe(
      secret
    );
  });

  it('is non-deterministic (fresh ephemeral key each call)', () => {
    const recipient = nacl.box.keyPair();
    const pk = uint8ToBase64(recipient.publicKey);
    expect(sealGithubSecret(pk, 'value')).not.toBe(
      sealGithubSecret(pk, 'value')
    );
  });

  it('cannot be opened with the wrong key', () => {
    const recipient = nacl.box.keyPair();
    const attacker = nacl.box.keyPair();
    const sealed = sealGithubSecret(uint8ToBase64(recipient.publicKey), 'x');
    expect(
      openSealed(sealed, recipient.publicKey, attacker.secretKey)
    ).toBeNull();
  });
});
