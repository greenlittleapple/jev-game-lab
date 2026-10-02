// Request errors that say where they came from, so a run log can tell a Jev timeout from a bridge one.
// source: 'jev' (the TypeSafe/Jev call), 'bridge_read' (a bridge request with no game effect) or
// 'bridge_command' (POST /api/v1/command). endpoint is the URL or bridge path; timeout_ms the request's limit.

// AbortSignal.timeout() rejects with a DOMException named TimeoutError.
export const isTimeoutError = error => error?.name === 'TimeoutError' || error?.cause?.name === 'TimeoutError';

export class RequestError extends Error {
 constructor(message, {source, endpoint, timeoutMs = null, timedOut = false, cause} = {}) {
  super(message, cause ? {cause} : undefined);
  Object.assign(this, {source, endpoint, timeoutMs, timedOut});
 }
}

// The fields every error and runner_paused record carries. Errors that aren't requests are 'runner'.
export const errorSource = error => error instanceof RequestError
 ? {source: error.source, endpoint: error.endpoint, timeout_ms: error.timeoutMs, timed_out: error.timedOut}
 : {source: 'runner', endpoint: null, timeout_ms: null, timed_out: false};
