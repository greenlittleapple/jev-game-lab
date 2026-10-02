// HTTP client for the BTD6 bridge mod (integration/btd6-bridge), which serves only on loopback.
// Reads may be repeated; a command is sent once, and a lost response is resolved by looking up its
// command_id, never by sending it again.
// Errors are RequestErrors: source 'bridge_command' for POST /api/v1/command, 'bridge_read' for everything else
// (no game effect). A read that times out is retried after readBackoffMs, then twice that, and so on, up to
// readRetries times; onReadRetry({source, endpoint, timeout_ms, attempt, delay_ms}) is told about each retry.
import {setTimeout as delay} from 'node:timers/promises';
import {normalizeState} from './state.mjs';
import {RequestError, isTimeoutError} from '../../core/request-error.mjs';

export const DEFAULT_PORT = 15527;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
export const isPng = bytes => bytes.length > 8 && PNG_SIGNATURE.every((b, i) => bytes[i] === b);

export function bridgeClient({port = DEFAULT_PORT, baseUrl = `http://127.0.0.1:${port}`, fetch = globalThis.fetch, timeoutMs = 5000,
 readRetries = 2, readBackoffMs = 250, onReadRetry = () => {}, sleep = delay} = {}) {
 const noAnswer = (path, source, error, ms = timeoutMs) => new RequestError(
  `Bridge ${path}: no answer from ${baseUrl} (${error.cause?.code ?? error.message})`,
  {source, endpoint: path, timeoutMs: ms, timedOut: isTimeoutError(error), cause: error});
 // Reads only: a command is never sent twice.
 const retryRead = async (path, source, fn, ms = timeoutMs) => {
  for (let n = 1; ; n++) {
   try { return await fn(); }
   catch (error) {
    if (!(error instanceof RequestError && error.timedOut) || source !== 'bridge_read' || n > readRetries) throw error;
    const wait = readBackoffMs * 2 ** (n - 1);
    await (async () => onReadRetry({source, endpoint: path, timeout_ms: ms, attempt: n, delay_ms: wait}))().catch(() => {});
    await sleep(wait);
   }
  }
 };
 const once = async (path, {body, allowNotFound = false, source}) => {
  const response = await fetch(baseUrl + path, {
   method: body ? 'POST' : 'GET',
   headers: body ? {'Content-Type': 'application/json'} : {},
   body: body ? JSON.stringify(body) : undefined,
   signal: AbortSignal.timeout(timeoutMs),
  }).catch(error => { throw noAnswer(path, source, error); });
  // The timeout also covers the body; a body cut off by it is no answer, not an empty one.
  const data = await response.json().catch(error => { if (isTimeoutError(error)) throw noAnswer(path, source, error); return null; });
  if (allowNotFound && response.status === 404) return null;
  if (!response.ok) throw new RequestError(`Bridge ${path}: HTTP ${response.status}${data?.error ? ` (${data.error})` : ''}`, {source, endpoint: path, timeoutMs});
  return data;
 };
 const call = (path, options = {}) => {
  const source = path === '/api/v1/command' ? 'bridge_command' : 'bridge_read';
  return retryRead(path, source, () => once(path, {...options, source}));
 };
 return {
  // Answered without the game: whether its main thread is running frames.
  health: () => call('/api/v1/health'),
  state: async () => normalizeState(await call('/api/v1/state')),
  // {command_id, status: executed | queued | rejected, reason?, tower_id?}
  command: command => call('/api/v1/command', {body: command}),
  commandResult: id => call(`/api/v1/commands/${encodeURIComponent(id)}`, {allowNotFound: true}),
  map: () => call('/api/v1/map'),
  // The bridge checks at most 400 points per request (one game frame each); larger grids go in batches.
  placementCheck: async (tower, points) => {
   const results = [];
   for (let i = 0; i < points.length; i += 400)
    results.push(...((await call('/api/v1/placement-check', {body: {tower, points: points.slice(i, i + 400).map(p => [p.x, p.y])}})).results ?? []));
   return {tower, results};
  },
  catalog: () => call('/api/v1/catalog'),
  // The saved profile (bridge 0.3.2): unlocked towers and heroes, acquired upgrades, rank, XP (profile.mjs).
  profile: () => call('/api/v1/profile'),
  // A PNG of the game's current frame (bridge 0.3.12), as a Buffer; width 64 to 1920 (default 960). The bridge
  // allows one per second (HTTP 429) and answers 503 when the game isn't running frames.
  // Not retried: the shooter skips a missed frame.
  screenshot: async (width = 960) => {
   const path = `/api/v1/screenshot?width=${encodeURIComponent(width)}`;
   const response = await fetch(baseUrl + path, {method: 'GET', headers: {}, signal: AbortSignal.timeout(timeoutMs + 5000)})
    .catch(error => { throw noAnswer(path, 'bridge_read', error, timeoutMs + 5000); });
   if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw Error(`Bridge ${path}: HTTP ${response.status}${data?.error ? ` (${data.error})` : ''}`);
   }
   const bytes = Buffer.from(await response.arrayBuffer());
   if (!isPng(bytes)) throw Error(`Bridge ${path}: the answer is not a PNG`);
   return bytes;
  },
 };
}
