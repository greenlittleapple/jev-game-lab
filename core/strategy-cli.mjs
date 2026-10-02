// Session-side tool for answering the runner's strategy requests.
//   wait            block until an unanswered request exists, then print its ID
//   show            print the pending request (instructions, schema, brief)
//   answer ID FILE  validate a plan JSON file (or - for stdin) and deliver it
// Adapted from integration/sts2/strategy-cli.mjs in jev-spire-strategist. The schema check is
// generic; checks against the request's own facts (option IDs, map spots) come from the game.
import {readFile} from 'node:fs/promises';
import {validatePlan} from './plan-schema.mjs';

const stdinText = () => new Promise((resolve, reject) => {
 let text = '';
 process.stdin.setEncoding('utf8');
 process.stdin.on('data', d => text += d).on('end', () => resolve(text)).on('error', reject);
});

// Returns the process exit code.
export async function strategyCli({argv, channel, schema, checkAnswer = () => [], describe = r => r.reason ?? '',
 readStdin = stdinText, print = console.log, fail = console.error, pollMs = 1000}) {
 const [command, ...args] = argv;
 if (command === 'wait') {
  for (;;) {
   const request = await channel.pending();
   if (request) { print(`Strategy request ${request.id} (${describe(request)})`); return 0; }
   await new Promise(r => setTimeout(r, pollMs));
  }
 }
 if (command === 'show') {
  const request = await channel.current();
  if (!request) { print('No strategy request is pending.'); return 0; }
  const {id, createdAt, reason, replaces, instructions, brief} = request;
  print(JSON.stringify({id, createdAt, reason, ...(replaces ? {replaces} : {}), instructions, schema: request.schema, brief}));
  return 0;
 }
 if (command === 'answer' && args.length === 2) {
  const [id, file] = args;
  let plan;
  try { plan = JSON.parse(file === '-' ? await readStdin() : await readFile(file, 'utf8')); }
  catch (error) { fail(`Could not read the plan: ${error.message}`); return 1; }
  // Only the pending request is checked and answered. An answer to any other ID is refused before
  // the schema check, so it never reports errors from a schema the plan was not written for.
  const request = await channel.current();
  if (!request) { fail(`Request ${id} is not pending: no strategy request is waiting. Run "wait", then "show".`); return 1; }
  if (request.id !== id) {
   const how = request.replaces === id ? 'was replaced by' : 'is not the pending request; the pending one is';
   fail(`Request ${id} ${how} ${request.id} (${describe(request)}). Run "show" and answer ${request.id}.`);
   return 1;
  }
  if ((await channel.pendingAnswer())?.id === id) { fail(`Request ${id} was already answered; the runner has not taken the answer yet. Run "wait" for the next request.`); return 1; }
  const errors = validatePlan(plan, request.schema ?? schema);
  if (!errors.length) errors.push(...checkAnswer(plan, request));
  if (errors.length) { fail(errors.join('\n')); return 1; }
  try { await channel.answer(id, plan); }
  catch (error) { fail(error.message); return 1; }
  print(`Delivered plan for ${id}.`);
  return 0;
 }
 fail('Usage: strategy-cli wait | show | answer <request-id> <plan.json|->');
 return 2;
}
