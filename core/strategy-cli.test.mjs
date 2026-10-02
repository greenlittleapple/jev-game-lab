import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileChannel} from './strategy-channel.mjs';
import {strategyCli} from './strategy-cli.mjs';

const schema = {type: 'object', required: ['summary'], properties: {summary: {type: 'string'}, spot: {type: 'string'}}};

async function setup(t) {
 const dir = await mkdtemp(join(tmpdir(), 'jev-cli-'));
 t.after(() => rm(dir, {recursive: true, force: true}));
 const out = [], err = [];
 const channel = fileChannel(dir);
 const run = (argv, extra = {}) => strategyCli({argv, channel, schema, print: s => out.push(s), fail: s => err.push(s), pollMs: 5, ...extra});
 return {dir, channel, run, out, err};
}

test('wait, show and answer work through the file channel', async t => {
 const {dir, channel, run, out} = await setup(t);
 const waiting = run(['wait'], {describe: r => r.reason});
 const request = await channel.post({reason: 'match_start', schema, instructions: 'Plan.', brief: {round: 3}, stamp: {spots: ['S01']}});
 assert.equal(await waiting, 0);
 assert.equal(out.at(-1), `Strategy request ${request.id} (match_start)`);
 assert.equal(await run(['show']), 0);
 assert.deepEqual(JSON.parse(out.at(-1)), {id: request.id, createdAt: request.createdAt, reason: 'match_start', instructions: 'Plan.', schema, brief: {round: 3}});
 const file = join(dir, 'plan.json');
 await writeFile(file, JSON.stringify({summary: 'Hold'}));
 assert.equal(await run(['answer', request.id, file]), 0);
 assert.deepEqual((await channel.take(request.id)).plan, {summary: 'Hold'});
});

test('answers are checked against the schema and the request before delivery', async t => {
 const {dir, channel, run, err} = await setup(t);
 const request = await channel.post({reason: 'leak', schema, stamp: {spots: ['S01']}});
 const file = join(dir, 'plan.json');
 await writeFile(file, JSON.stringify({summary: 3}));
 assert.equal(await run(['answer', request.id, file]), 1);
 assert.equal(err.at(-1), 'plan.summary must be a string');
 await writeFile(file, JSON.stringify({summary: 'Go', spot: 'S09'}));
 const checkAnswer = (plan, req) => req.stamp.spots.includes(plan.spot) ? [] : [`plan.spot ${plan.spot} is not in brief.spots`];
 assert.equal(await run(['answer', request.id, file], {checkAnswer}), 1);
 assert.equal(err.at(-1), 'plan.spot S09 is not in brief.spots');
 const newer = await channel.post({reason: 'review', schema, replaces: request.id, stamp: {spots: []}});
 await writeFile(file, JSON.stringify({summary: 'Go'}));
 assert.equal(await run(['answer', request.id, file]), 1);
 assert.match(err.at(-1), new RegExp(`replaced by ${newer.id}`));
 assert.equal(await channel.pendingAnswer(), null, 'nothing was delivered');
 assert.equal(await run(['answer', newer.id, join(dir, 'missing.json')]), 1);
 assert.match(err.at(-1), /^Could not read the plan/);
 assert.equal(await run(['bogus']), 2);
});

test('answers to a request that is not pending are refused before any schema check', async t => {
 const {dir, channel, run, err} = await setup(t);
 // The fallback schema rejects this plan; none of these refusals may report its errors.
 const fallback = {type: 'object', required: ['priorities'], additionalProperties: false, properties: {priorities: {type: 'array'}}};
 const describe = r => `${r.reason}, round ${r.stamp.round}`;
 const answer = id => run(['answer', id, file], {schema: fallback, describe});
 const file = join(dir, 'plan.json');
 await writeFile(file, JSON.stringify({summary: 'Go'}));

 assert.equal(await answer('00000000-old'), 1);
 assert.equal(err.at(-1), 'Request 00000000-old is not pending: no strategy request is waiting. Run "wait", then "show".');

 const first = await channel.post({reason: 'review', schema, stamp: {round: 16}});
 const newer = await channel.post({reason: 'leak', schema, replaces: first.id, stamp: {round: 17}});
 assert.equal(await answer(first.id), 1);
 assert.equal(err.at(-1), `Request ${first.id} was replaced by ${newer.id} (leak, round 17). Run "show" and answer ${newer.id}.`);

 assert.equal(await answer('00000000-unknown'), 1);
 assert.equal(err.at(-1), `Request 00000000-unknown is not the pending request; the pending one is ${newer.id} (leak, round 17). Run "show" and answer ${newer.id}.`);
 assert.equal(await channel.pendingAnswer(), null, 'nothing was delivered');

 assert.equal(await answer(newer.id), 0, 'the pending request is checked against its own schema');
 assert.equal(await answer(newer.id), 1);
 assert.equal(err.at(-1), `Request ${newer.id} was already answered; the runner has not taken the answer yet. Run "wait" for the next request.`);
 assert.ok(!err.some(e => /priorities|not allowed/.test(e)), 'no errors from the fallback schema');
 assert.deepEqual((await channel.take(newer.id)).plan, {summary: 'Go'});
});
