// Strategist side of the file channel for BTD6 (docs/ARCHITECTURE.md, "Strategist"; docs/BTD6-STRATEGIST.md).
//   npm run btd6:strategy -- wait | show | answer <request-id> <plan.json|->
import {fileURLToPath} from 'node:url';
import {resolve, dirname} from 'node:path';
import {fileChannel} from '../../core/strategy-channel.mjs';
import {strategyCli} from '../../core/strategy-cli.mjs';
import {PLAN_SCHEMA, checkAnswer} from './plan.mjs';
import {CLAUDE_POLICY_V1, checkAnswerV1} from './plan-v1.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const channel = fileChannel(process.env.STRATEGY_DIR ?? resolve(root, '.private/btd6/strategy'));
process.exitCode = await strategyCli({
 // Requests carry their policy: btd6-claude-v1 plans get that policy's checks (plan-v1.mjs), older ones v0's.
 argv: process.argv.slice(2), channel, schema: PLAN_SCHEMA, checkAnswer: (plan, request) => (request.policy === CLAUDE_POLICY_V1 ? checkAnswerV1 : checkAnswer)(plan, request),
 describe: r => `${r.reason}, round ${r.stamp?.round ?? '?'}${r.stamp?.needed_by_round ? `, needed by round ${r.stamp.needed_by_round}` : ''}`,
});
