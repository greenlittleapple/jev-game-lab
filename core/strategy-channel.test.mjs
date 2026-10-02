import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileChannel} from './strategy-channel.mjs';

test('one outstanding request; an answer is taken once and only for its own request', async t => {
 const dir = await mkdtemp(join(tmpdir(), 'jev-channel-'));
 t.after(() => rm(dir, {recursive: true, force: true}));
 const channel = fileChannel(dir);
 assert.equal(await channel.pending(), null);
 const first = await channel.post({reason: 'match_start'});
 assert.equal((await channel.pending()).id, first.id);
 const second = await channel.post({reason: 'leak'});
 await assert.rejects(channel.answer(first.id, {}), /was replaced by/);
 await channel.answer(second.id, {summary: 'x'});
 assert.equal(await channel.pending(), null, 'an answered request is no longer pending');
 assert.equal(await channel.take(first.id), null, 'an answer for another request is not taken');
 await channel.answer(second.id, {summary: 'y'});
 assert.deepEqual((await channel.take(second.id)).plan, {summary: 'y'});
 assert.equal(await channel.current(), null, 'taking removes the request and the answer');
 await writeFile(channel.answerFile, JSON.stringify({id: 'stale', plan: {}}));
 await channel.post({reason: 'review'});
 assert.equal(await channel.take('other'), null);
 assert.equal(await channel.pendingAnswer(), null, 'a stale answer is removed');
});
