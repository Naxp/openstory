/**
 * libsodium `crypto_box_seal` for GitHub Actions secrets.
 *
 * GitHub's "create or update a repository secret" API requires the value to be
 * encrypted with the repo's public key using libsodium's sealed box. The
 * Workers runtime has no libsodium and no X25519 in Web Crypto, so we
 * reconstruct the sealed-box construction from primitives:
 *
 *   ephemeral_pk, ephemeral_sk = box_keypair()
 *   nonce = blake2b(ephemeral_pk || recipient_pk, len = 24)
 *   c = box(message, nonce, recipient_pk, ephemeral_sk)
 *   sealed = ephemeral_pk || c
 *
 * tweetnacl (`box`) and blakejs (`blake2b`) are both pure JS, so this runs
 * unchanged in Workerd. See
 * https://docs.github.com/rest/actions/secrets#create-or-update-a-repository-secret
 */

import { blake2b } from 'blakejs';
import nacl from 'tweetnacl';

function base64ToUint8(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Seal `secretValue` for the GitHub repo whose Actions public key (base64) is
 * `publicKeyBase64`. Returns the base64 sealed box GitHub expects.
 */
export function sealGithubSecret(
  publicKeyBase64: string,
  secretValue: string
): string {
  const recipientPk = base64ToUint8(publicKeyBase64);
  const message = new TextEncoder().encode(secretValue);

  const ephemeral = nacl.box.keyPair();

  const nonceInput = new Uint8Array(
    ephemeral.publicKey.length + recipientPk.length
  );
  nonceInput.set(ephemeral.publicKey, 0);
  nonceInput.set(recipientPk, ephemeral.publicKey.length);
  const nonce = blake2b(nonceInput, undefined, nacl.box.nonceLength);

  const boxed = nacl.box(message, nonce, recipientPk, ephemeral.secretKey);

  const sealed = new Uint8Array(ephemeral.publicKey.length + boxed.length);
  sealed.set(ephemeral.publicKey, 0);
  sealed.set(boxed, ephemeral.publicKey.length);

  return uint8ToBase64(sealed);
}
