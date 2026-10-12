// End-to-end encryption for synced items, using only the platform's Web
// Crypto API (browser, and Node 20+ for tests). No custom primitives.
//
// - One random 256-bit AES-GCM key per synced dataset, generated on the
//   first device. It never leaves a device except inside a pairing code or
//   the recovery key that the player copies themselves; the server never
//   receives it.
// - Each item is gzip-compressed, then encrypted with a fresh random 96-bit
//   IV. The additional authenticated data binds the ciphertext to the
//   dataset epoch and item id, so the server can't swap items around or
//   replay them into a reset dataset without decryption failing.
// - Losing every device and the recovery key makes the synced copy
//   unreadable. Backups (/backup) stay the independent way to recover.
import { gzipSync, gunzipSync, strToU8, strFromU8 } from 'fflate'

import { SyncError } from './items.js'

const subtle = () => globalThis.crypto.subtle
const random = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n))

export const b64url = (bytes) => {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export const fromB64url = (str) => {
  if (typeof str !== 'string' || !/^[A-Za-z0-9_-]*$/.test(str)) throw new SyncError('bad-encoding')
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4))
  return Uint8Array.from(s, (c) => c.charCodeAt(0))
}

export const randomId = (bytes = 18) => b64url(random(bytes))

export const generateKeyBytes = () => random(32)

export const importKey = (bytes) => subtle().importKey('raw', bytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])

const aad = (epoch, id) => strToU8(`nuzlocke-sync:v1:${epoch}:${id}`)

/** @returns {Promise<string>} `v1.<base64url(iv | ciphertext)>` */
export async function encryptItem(key, epoch, id, value) {
  const iv = random(12)
  const plain = gzipSync(strToU8(JSON.stringify(value)), { level: 6, mtime: 0 })
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: aad(epoch, id) }, key, plain))
  const out = new Uint8Array(12 + ct.length)
  out.set(iv)
  out.set(ct, 12)
  return `v1.${b64url(out)}`
}

/** Throws SyncError('decrypt-failed') for a wrong key or any tampering */
export async function decryptItem(key, epoch, id, ct) {
  let bytes
  try {
    if (typeof ct !== 'string' || !ct.startsWith('v1.')) throw new Error('format')
    bytes = fromB64url(ct.slice(3))
    if (bytes.length < 12 + 16) throw new Error('short')
  } catch (e) {
    throw new SyncError('decrypt-failed', 'Received data is not in the expected format.', e)
  }
  let plain
  try {
    plain = new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: aad(epoch, id) }, key, bytes.slice(12)))
  } catch (e) {
    throw new SyncError('decrypt-failed', 'Synced data could not be decrypted with this device’s key.', e)
  }
  try {
    return JSON.parse(strFromU8(gunzipSync(plain)))
  } catch (e) {
    throw new SyncError('decrypt-failed', 'Synced data could not be read.', e)
  }
}

// ---- Codes the player copies between devices
//
// Recovery key:  NZK1-<base64url(key 32 | check 2)>
// Pairing code:  NZP1-<base64url(pairing secret 18 | key 32 | check 2)>
// The 2-byte check (start of SHA-256) catches typos before anything is sent.

const checkBytes = async (bytes) => new Uint8Array(await subtle().digest('SHA-256', bytes)).slice(0, 2)

async function encodeCode(prefix, parts) {
  const body = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    body.set(p, o)
    o += p.length
  }
  const check = await checkBytes(body)
  const all = new Uint8Array(body.length + 2)
  all.set(body)
  all.set(check, body.length)
  return `${prefix}-${b64url(all)}`
}

async function decodeCode(prefix, code, length) {
  const clean = typeof code === 'string' ? code.replace(/\s+/g, '') : ''
  if (!clean.toUpperCase().startsWith(`${prefix}-`)) throw new SyncError('bad-code')
  let all
  try {
    all = fromB64url(clean.slice(prefix.length + 1))
  } catch (e) {
    throw new SyncError('bad-code')
  }
  if (all.length !== length + 2) throw new SyncError('bad-code')
  const body = all.slice(0, length)
  const check = await checkBytes(body)
  if (check[0] !== all[length] || check[1] !== all[length + 1]) throw new SyncError('bad-code')
  return body
}

export const encodeRecoveryKey = (keyBytes) => encodeCode('NZK1', [keyBytes])

export async function decodeRecoveryKey(code) {
  try {
    return await decodeCode('NZK1', code, 32)
  } catch (e) {
    throw new SyncError('bad-code', 'That recovery key isn’t valid. Check for typos.')
  }
}

export const encodePairingCode = (pairSecret, keyBytes) => encodeCode('NZP1', [fromB64url(pairSecret), keyBytes])

/** @returns {{ pair: string, keyBytes: Uint8Array }} */
export async function decodePairingCode(code) {
  let body
  try {
    body = await decodeCode('NZP1', code, 18 + 32)
  } catch (e) {
    throw new SyncError('bad-code', 'That pairing code isn’t valid. Check for typos, or create a new one.')
  }
  return { pair: b64url(body.slice(0, 18)), keyBytes: body.slice(18) }
}
