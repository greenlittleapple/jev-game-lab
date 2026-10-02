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
 const odd = jevClient({apiKey: 'k', fetch: async () => reply(500, {detail: {error_type: 'Has Spaces <b>'}})});
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
