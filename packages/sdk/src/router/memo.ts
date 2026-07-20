// ---------------------------------------------------------------------------
// Peel memo encoding
//
// Binary layout (21–34 bytes):
//   PEEL    4 bytes  — magic prefix, 0x50454554 ("PEEL" ASCII)
//   version 1 byte   — encoding version, currently 0x01
//   intentId 16 bytes — UUID as raw bytes (dashes stripped)
//   userMemo 0–13 bytes — optional UTF-8 user note
//
// This fits:
//   Bitcoin OP_RETURN   (max 80 bytes) — added as a zero-value extra output
//   Stacks memo field   (max 34 bytes) — on STX native transfers
//   EVM data field      (unlimited)    — on native ETH/RBTC/cBTC transfers
// ---------------------------------------------------------------------------

import type { EncodedMemo } from "./types.js";

export const PEEL_MEMO_MAGIC = new Uint8Array([0x50, 0x45, 0x45, 0x4c]); // "PEEL"
export const PEEL_MEMO_VERSION = 0x01;

/** Max user memo bytes — constrained by the Stacks 34-byte memo field. */
const MAX_USER_MEMO_BYTES = 13;

/**
 * Encode a Peel memo for embedding in transactions.
 *
 * @param intentId  UUID v4 string (e.g. "550e8400-e29b-41d4-a716-446655440000").
 * @param userMemo  Optional human-readable note. Truncated to 13 bytes UTF-8.
 */
export function encodePeelMemo(intentId: string, userMemo?: string): EncodedMemo {
  const intentBytes = uuidToBytes(intentId);

  let memoBytes = new Uint8Array(0);
  if (userMemo) {
    const encoded = new TextEncoder().encode(userMemo);
    memoBytes = encoded.slice(0, MAX_USER_MEMO_BYTES);
  }

  const total = 4 + 1 + 16 + memoBytes.length;
  const buf = new Uint8Array(total);

  let offset = 0;
  buf.set(PEEL_MEMO_MAGIC, offset);     offset += 4;
  buf[offset] = PEEL_MEMO_VERSION;      offset += 1;
  buf.set(intentBytes, offset);         offset += 16;
  if (memoBytes.length > 0) {
    buf.set(memoBytes, offset);
  }

  return {
    bytes: buf,
    hex: Array.from(buf).map(b => b.toString(16).padStart(2, "0")).join(""),
    intentId,
  };
}

/**
 * Convert a UUID string to 16 raw bytes (strips dashes).
 * "550e8400-e29b-41d4-a716-446655440000" → Uint8Array(16)
 */
function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, "");
  if (hex.length !== 32) throw new Error(`invalid UUID: ${uuid}`);
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Generate a new random UUID for an intent. */
export function newIntentId(): string {
  return crypto.randomUUID();
}
