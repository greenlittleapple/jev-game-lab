// TypeSafe System One client for Jev Choice requests (https://docs.typesafe.ai/api).
// The model is pinned so a new provider default can't change it in the middle of a comparison.
// The pin is applied after the payload, so a payload that names its own model can't override it.
import {setTimeout as delay} from 'node:timers/promises';
import {RequestError, isTimeoutError} from './request-error.mjs';

export const JEV_MODEL = 'jev-1.13.0';
export const TYPESAFE_URL = 'https://api.typesafe.ai/v1/systemone';

// usage is shared with the runner, which stops at its limits: {requests, inputTokens}.
// Errors are RequestErrors with source 'jev'. A request that times out has no game effect, so it is sent
// once more (timeoutRetries); if that times out too the error is marked timedOut and the runner treats the
// decision as having no Jev answer instead of pausing.
// A transient server error (HTTP 500, 502, 503, 504, or Cloudflare's 520 to 524) is also sent once more, after
// serverErrorDelayMs; if that fails too the error is the usual HTTP error and the runner pauses. 4xx is not retried.
// onRetry({source, endpoint, attempt, delay_ms, timeout_ms} plus timed_out or status) is told about each retry.
export const TRANSIENT_STATUSES = new Set([500, 502, 503, 504, 520, 521, 522, 523, 524]);
export function jevClient({apiKey, model = JEV_MODEL, fetch = globalThis.fetch, url = TYPESAFE_URL, timeoutMs = 30000,
 timeoutRetries = 1, serverErrorRetries = 1, serverErrorDelayMs = 1500, onRetry = () => {}, sleep = delay,
 usage = {requests: 0, inputTokens: 0}, limits = {}}) {
 const fail = (message, extra = {}) => new RequestError(message, {source: 'jev', endpoint: url, timeoutMs, ...extra});
 const send = async payload => {
  const response = await fetch(url, {
   method: 'POST',
   headers: {'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`},
   body: JSON.stringify({...payload, model}),
   signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
   // Report a bounded error code only, never a provider echo of request data.
   const body = await response.json().catch(() => null);
   const code = body?.detail?.error_type;
   throw fail(`TypeSafe HTTP ${response.status}${typeof code === 'string' && /^[a-z_]{1,80}$/.test(code) ? ` (${code})` : ''}; paused.`,
    {status: response.status});
  }
  return response.json();
 };
 return async function ask(payload) {
  if (!apiKey) throw fail('Missing TYPESAFE_API_KEY.');
  if (usage.requests >= (limits.maxRequests ?? Infinity) || usage.inputTokens >= (limits.maxInputTokens ?? Infinity))
   throw Error('Session limit reached.');
  let result;
  let timeouts = 0, serverErrors = 0;
  const retry = async (attempt, wait, detail) => {
   await (async () => onRetry({source: 'jev', endpoint: url, attempt, delay_ms: wait, timeout_ms: timeoutMs, ...detail}))().catch(() => {});
   if (wait > 0) await sleep(wait);
  };
  for (let attempt = 1; ; attempt++) {
   try { result = await send(payload); break; }
   catch (error) {
    if (error instanceof RequestError) {
     if (!TRANSIENT_STATUSES.has(error.status) || ++serverErrors > serverErrorRetries) throw error;
     await retry(attempt, serverErrorDelayMs, {status: error.status});
     continue;
    }
    if (!isTimeoutError(error)) throw fail(`TypeSafe request failed (${error.cause?.code ?? error.message}).`, {cause: error});
    if (++timeouts > timeoutRetries)
     throw fail(`TypeSafe request timed out after ${timeoutMs} ms (${attempt} attempts).`, {timedOut: true, cause: error});
    await retry(attempt, 0, {timed_out: true});
   }
  }
  usage.requests++;
  usage.inputTokens += result.usage?.input_tokens ?? 0;
  return result;
 };
}
