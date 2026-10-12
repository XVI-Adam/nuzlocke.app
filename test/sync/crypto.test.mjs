import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  encryptItem,
  decryptItem,
  importKey,
  generateKeyBytes,
  encodeRecoveryKey,
  decodeRecoveryKey,
  encodePairingCode,
  decodePairingCode,
  randomId,
  b64url
} from '../../src/lib/sync/crypto.js'
import { CT_RE } from '../../src/lib/sync/protocol.js'

const EPOCH = 'epoch-aaaaaaaaaaaaaaaa'
const value = { save: { name: 'Secret Run', nickname: 'Rocky' }, tracker: { 'Route 1': { pokemon: 'larvitar' } } }

test('items round-trip, and the ciphertext reveals nothing', async () => {
  const key = await importKey(generateKeyBytes())
  const ct = await encryptItem(key, EPOCH, 'run:abc', value)
  assert.match(ct, CT_RE)
  for (const s of ['Secret', 'Rocky', 'larvitar']) assert.ok(!ct.includes(s))
  assert.deepEqual(await decryptItem(key, EPOCH, 'run:abc', ct), value)
  // Fresh IV every time
  assert.notEqual(ct, await encryptItem(key, EPOCH, 'run:abc', value))
})

test('ciphertext is bound to its key, item id and dataset epoch', async () => {
  const key = await importKey(generateKeyBytes())
  const ct = await encryptItem(key, EPOCH, 'note:lessons:a', value)
  const other = await importKey(generateKeyBytes())
  await assert.rejects(decryptItem(other, EPOCH, 'note:lessons:a', ct), (e) => e.code === 'decrypt-failed')
  await assert.rejects(decryptItem(key, EPOCH, 'note:lessons:b', ct), (e) => e.code === 'decrypt-failed')
  await assert.rejects(decryptItem(key, 'epoch-bbbbbbbbbbbbbbbb', 'note:lessons:a', ct), (e) => e.code === 'decrypt-failed')
  // Any flipped character is detected
  const i = 20
  const tampered = ct.slice(0, i) + (ct[i] === 'A' ? 'B' : 'A') + ct.slice(i + 1)
  await assert.rejects(decryptItem(key, EPOCH, 'note:lessons:a', tampered), (e) => e.code === 'decrypt-failed')
  await assert.rejects(decryptItem(key, EPOCH, 'note:lessons:a', 'v1.short'), (e) => e.code === 'decrypt-failed')
})

test('recovery keys and pairing codes round-trip and catch typos', async () => {
  const bytes = generateKeyBytes()
  const rk = await encodeRecoveryKey(bytes)
  assert.match(rk, /^NZK1-/)
  assert.deepEqual(await decodeRecoveryKey(rk), bytes)
  assert.deepEqual(await decodeRecoveryKey(` ${rk.slice(0, 10)}\n${rk.slice(10)} `), bytes, 'whitespace from copy/paste is ignored')
  const typo = rk.slice(0, 12) + (rk[12] === 'x' ? 'y' : 'x') + rk.slice(13)
  await assert.rejects(decodeRecoveryKey(typo), (e) => e.code === 'bad-code')

  const pair = randomId(18)
  const pc = await encodePairingCode(pair, bytes)
  const decoded = await decodePairingCode(pc)
  assert.equal(decoded.pair, pair)
  assert.deepEqual(decoded.keyBytes, bytes)
  await assert.rejects(decodePairingCode(rk), (e) => e.code === 'bad-code')
  await assert.rejects(decodePairingCode('NZP1-' + b64url(new Uint8Array(52))), (e) => e.code === 'bad-code')
})
