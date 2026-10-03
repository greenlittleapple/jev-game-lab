import {test} from 'node:test';
import assert from 'node:assert/strict';
import {jevClient, JEV_MODEL} from './jev.mjs';

const reply = (status, body) => ({ok: status < 400, status, json: async () => body});

test('the pinned model wins over a model named in the payload, and usage is counted', async () => {
 const sent = [];
 const usage = {requests: 0, inputTokens: 0};
 const ask = jevClient({apiKey: 'test-key', usage, fetch: async (url, init) => { sent.push({url, init}); return reply(200, {model: JEV_MODEL, answers: {move: {type: 'choice', choice: 'a'}}, usage: {input_tokens: 120}}); }});
 await ask({model: 'jev-latest', state: {}, questions: {}});
 const body = JSON.parse(sent[0].init.body);
 assert.equal(body.model, JEV_MODEL);
 assert.equal(sent[0].init.headers.Authorization, 'Bearer test-key');
 assert.deepEqual(usage, {requests: 1, inputTokens: 120});
});

test('errors report a bounded code, never the provider body; limits stop requests before sending', async () => {
 const ask = jevClient({apiKey: 'k', fetch: async () => reply(422, {detail: {error_type: 'invalid_request', echo: 'secret state'}})});
 await assert.rejects(ask({}), /^Error: TypeSafe HTTP 422 \(invalid_request\); paused\.$/);
 const odd = jevClient({apiKey: 'k', serverErrorDelayMs: 0, fetch: async () => reply(500, {detail: {error_type: 'Has Spaces <b>'}})});
 await assert.rejects(odd({}), /^Error: TypeSafe HTTP 500; paused\.$/);
 let calls = 0;
 const capped = jevClient({apiKey: 'k', usage: {requests: 5, inputTokens: 0}, limits: {maxRequests: 5}, fetch: async () => { calls++; return reply(200, {}); }});
 await assert.rejects(capped({}), /Session limit reached/);
 await assert.rejects(jevClient({apiKey: ''})({}), /Missing TYPESAFE_API_KEY/);
 assert.equal(calls, 0);
});

const timeout = () => Promise.reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));

test('a timed-out request is sent once more; a second timeout is a jev RequestError marked timedOut', async () => {
 let sends = 0;
 const usage = {requests: 0, inputTokens: 0};
 const once = jevClient({apiKey: 'k', usage, timeoutMs: 1000, fetch: () => ++sends === 1 ? timeout() : Promise.resolve(reply(200, {usage: {input_tokens: 5}}))});
 await once({});
 assert.equal(sends, 2);
 assert.deepEqual(usage, {requests: 1, inputTokens: 5});
 sends = 0;
 const never = jevClient({apiKey: 'k', timeoutMs: 1000, url: 'https://example.test/jev', fetch: () => { sends++; return timeout(); }});
 const error = await never({}).catch(e => e);
 assert.equal(sends, 2);
 assert.equal(error.source, 'jev');
 assert.equal(error.timedOut, true);
 assert.equal(error.timeoutMs, 1000);
 assert.equal(error.endpoint, 'https://example.test/jev');
 assert.match(error.message, /timed out after 1000 ms \(2 attempts\)/);
 const refused = await jevClient({apiKey: 'k', fetch: () => { sends++; return Promise.reject(Error('fetch failed')); }})({}).catch(e => e);
 assert.equal(refused.timedOut, false);
 assert.equal(refused.source, 'jev');
});

test('a transient HTTP 5xx is sent once more after a delay and the retry is reported with its status', async () => {
 let sends = 0;
 const retries = [], waits = [];
 const usage = {requests: 0, inputTokens: 0};
 const ask = jevClient({apiKey: 'k', usage, url: 'https://example.test/jev', onRetry: r => retries.push(r), sleep: async ms => { waits.push(ms); },
  fetch: async () => ++sends === 1 ? reply(520, {}) : reply(200, {usage: {input_tokens: 7}})});
 await ask({});
 assert.equal(sends, 2);
 assert.deepEqual(waits, [1500]);
 assert.deepEqual(retries, [{source: 'jev', endpoint: 'https://example.test/jev', attempt: 1, delay_ms: 1500, timeout_ms: 30000, status: 520}]);
 assert.deepEqual(usage, {requests: 1, inputTokens: 7});
});

test('a second transient 5xx is the usual HTTP error (the runner pauses); a 4xx is not retried', async () => {
 let sends = 0;
 const twice = jevClient({apiKey: 'k', sleep: async () => {}, fetch: async () => { sends++; return reply(520, {}); }});
 const error = await twice({}).catch(e => e);
 assert.equal(sends, 2);
 assert.match(error.message, /^TypeSafe HTTP 520; paused\.$/);
 assert.equal(error.source, 'jev');
 assert.equal(error.timedOut, false);
 assert.equal(error.status, 520);
 sends = 0;
 const retries = [];
 const bad = jevClient({apiKey: 'k', onRetry: r => retries.push(r), sleep: async () => {}, fetch: async () => { sends++; return reply(400, {}); }});
 await assert.rejects(bad({}), /^Error: TypeSafe HTTP 400; paused\.$/);
 assert.equal(sends, 1);
 assert.deepEqual(retries, []);
});

test('a timeout retry is reported too, and a timeout then a 5xx gets the 5xx retry as well', async () => {
 let sends = 0;
 const retries = [];
 const ask = jevClient({apiKey: 'k', timeoutMs: 1000, onRetry: r => retries.push(r), sleep: async () => {},
  fetch: () => { sends++; return sends === 1 ? timeout() : Promise.resolve(sends === 2 ? reply(503, {}) : reply(200, {})); }});
 await ask({});
 assert.equal(sends, 3);
 assert.deepEqual(retries.map(r => [r.attempt, r.timed_out ?? null, r.status ?? null]), [[1, true, null], [2, null, 503]]);
});
