/*
 * protocol.js — constants and input sanitizers shared by the Worker entry
 * point (index.js) and the Room Durable Object (room.js).
 */

/** Room codes: 4 characters from this alphabet (no 0/O/1/I to avoid confusion). */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/;

export const MAX_PLAYERS = 3;
/** Player colours, by join slot. */
export const COLORS = ['#1f9fae', '#e07b39', '#8e5bd6'];
export const MAX_NAME_CHARS = 14;
export const DEFAULT_NAME = 'Player';

/** Gameplay inputs forwarded to game.input(). */
export const INPUT_TYPES = new Set(['tap', 'buy', 'mk', 'go', 'upauto', 'upstore']);
/** Permanent upgrade keys the leader may pass in {t:'start', up}. */
export const UPGRADE_KEYS = ['well', 'store', 'auto', 'ws'];
export const UPGRADE_MAX = 3;

/** Normalise a room code; returns null when invalid. Lower case is accepted. */
export function parseCode(raw) {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase();
  return CODE_RE.test(code) ? code : null;
}

/** Trim, strip control characters, cap at 14 characters (code points). */
export function sanitizeName(raw) {
  const clean = String(raw ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim();
  const capped = Array.from(clean).slice(0, MAX_NAME_CHARS).join('').trim();
  return capped || DEFAULT_NAME;
}

/** A stable client id: short and URL-safe. Anything else gets a fresh random id. */
export function sanitizePid(raw) {
  if (typeof raw === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(raw)) return raw;
  return 'anon-' + crypto.randomUUID();
}

/** Clamp the leader's permanent upgrades to integers 0..3. */
export function sanitizeUpgrades(raw) {
  const up = {};
  for (const k of UPGRADE_KEYS) {
    const v = raw && typeof raw === 'object' ? Number(raw[k]) : 0;
    up[k] = Number.isFinite(v) ? Math.max(0, Math.min(UPGRADE_MAX, Math.floor(v))) : 0;
  }
  return up;
}

/** Build an error frame: {t:'error', code, msg}. */
export function errorFrame(code, msg) {
  return JSON.stringify({ t: 'error', code, msg });
}
