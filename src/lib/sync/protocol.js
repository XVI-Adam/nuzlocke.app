// Wire format shared by the sync client and server. Pure module.
//
// The synced dataset is a set of items, each stored encrypted on the server
// under a plaintext id that only says what kind of thing it is:
//
//   run:<runId>               run-list entry + tracker + Unbound side data
//   attempt:<runId>           per-attempt notes and checklist progress
//   archive:<archiveId>       an archived attempt (immutable once written)
//   archmeta:<archiveId>      its editable title / status / summary
//   note:<section>:<entryId>  one knowledge entry (route, boss, objective, lesson)
//   meta:keycheck             proves a device holds the right encryption key
//
// Every write names the revision it was based on; the server rejects the
// whole batch if any item moved on since (optimistic concurrency). A deleted
// item stays on the server as a tombstone (`ct: null`) with its own revision.

export const ITEM_ID_RE =
  /^(?:(?:run|attempt|archive|archmeta):[A-Za-z0-9-]{1,64}|note:(?:routes|bosses|objectives|lessons):[A-Za-z0-9-]{1,64}|meta:keycheck)$/

/** Items the server never lets anyone overwrite once they exist (tombstoning is allowed) */
export const isImmutableId = (id) => id.startsWith('archive:') || id === 'meta:keycheck'

/** `v1.<base64url(iv | AES-GCM ciphertext)>` */
export const CT_RE = /^v1\.[A-Za-z0-9_-]{24,}$/

export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/ // 32 random bytes, base64url
export const PAIR_RE = /^[A-Za-z0-9_-]{24}$/ // 18 random bytes, base64url
export const REQUEST_ID_RE = /^[A-Za-z0-9_-]{16,64}$/
export const EPOCH_RE = /^[A-Za-z0-9_-]{16,64}$/

export const LIMITS = {
  /** One encrypted item (base64 chars). Archived attempts compress well below this. */
  itemChars: 1_500_000,
  /** One request body. Vercel functions accept at most 4.5 MB. */
  bodyBytes: 4_000_000,
  /** Items in one push */
  pushItems: 500,
  /** Ciphertext returned by one pull page (whole revisions are never split) */
  pullBytes: 3_000_000,
  /** Everything stored for this dataset */
  totalBytes: 50_000_000,
  /** Enrolled devices */
  devices: 20,
  deviceName: 40
}

/** Device names are shown in the device list; keep them short and plain */
export const cleanDeviceName = (name) =>
  typeof name === 'string'
    ? name
        .replace(/[^\p{L}\p{N} '._-]/gu, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, LIMITS.deviceName)
    : ''

export const kindOf = (id) => id.slice(0, id.indexOf(':'))

/** run:<id> / archive:<id> ... -> <id>; note:<section>:<id> -> <id> */
export const refOf = (id) => id.slice(id.lastIndexOf(':') + 1)
