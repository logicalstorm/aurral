import crypto from 'crypto';

const PREFIX = 'AURRAL_ENC:';
const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

function encryptWithKey(text: string | null | undefined, key: string): string {
  if (text == null || text === '') return text ?? '';
  if (!key || key.length !== 32) return text ?? '';
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv, {
    authTagLength: TAG_LEN,
  });
  const enc = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, enc]).toString('base64');
}

function decryptWithKey(text: string | null | undefined, key: string): string {
  if (text == null || text === '') return text ?? '';
  if (typeof text !== 'string' || !text.startsWith(PREFIX)) return text;
  if (!key || key.length !== 32) return text;
  try {
    const buf = Buffer.from(text.slice(PREFIX.length), 'base64');
    if (buf.length < IV_LEN + TAG_LEN) return text;
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const enc = buf.subarray(IV_LEN + TAG_LEN);
    const decipher = crypto.createDecipheriv(ALGO, key, iv, {
      authTagLength: TAG_LEN,
    });
    decipher.setAuthTag(tag);
    return decipher.update(enc) + decipher.final('utf8');
  } catch {
    return text;
  }
}

const SENSITIVE_PATHS = [
  ['navidrome', 'password'],
  ['plex', 'token'],
  ['general', 'authPassword'],
  ['lidarr', 'apiKey'],
  ['slskd', 'apiKey'],
  ['prowlarr', 'apiKey'],
  ['nzbget', 'password'],
  ['gotify', 'token'],
  ['lastfm', 'apiKey'],
] as const;

function getAt(obj: Record<string, unknown> | null | undefined, path: readonly string[]): unknown {
  let cur: unknown = obj;
  for (const p of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function setAt(obj: Record<string, unknown>, path: readonly string[], value: unknown) {
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const p = path[i];
    if (cur[p] == null) cur[p] = {} as Record<string, unknown>;
    cur = cur[p] as Record<string, unknown>;
  }
  if (cur != null) cur[path[path.length - 1]] = value;
}

export function decryptIntegrations(
  integrations: Record<string, unknown> | null | undefined,
  key: string,
) {
  if (!integrations || typeof integrations !== 'object') return integrations;
  const out = JSON.parse(JSON.stringify(integrations)) as Record<string, unknown>;
  for (const path of SENSITIVE_PATHS) {
    const v = getAt(out, path);
    if (v != null && typeof v === 'string') setAt(out, path, decryptWithKey(v, key));
  }
  return out;
}

export function encryptIntegrations(
  integrations: Record<string, unknown> | null | undefined,
  key: string,
) {
  if (!integrations || typeof integrations !== 'object') return integrations;
  const out = JSON.parse(JSON.stringify(integrations)) as Record<string, unknown>;
  for (const path of SENSITIVE_PATHS) {
    const v = getAt(out, path);
    if (v != null && typeof v === 'string') setAt(out, path, encryptWithKey(v, key));
  }
  return out;
}
