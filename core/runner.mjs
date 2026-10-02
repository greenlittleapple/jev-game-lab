// Runner safety checks shared by every game, taken from the STS2 runner in jev-spire-strategist
// (vendor/jev-the-spire/spire-demo/server.mjs) and separated from its dashboard:
// - one operator at a time: an exclusive lock file;
// - pause: a generation token; a decision that finishes after a pause is logged and dropped;
// - a fresh observation before every action: the decision's structural fingerprint must be
//   unchanged and the chosen action's preconditions must still hold;
// - a dispatch record synced to disk before each command is sent; if it can't be written, the
//   command isn't sent;
// - no automatic resend: a command whose result is unknown is looked up by its command ID, and
//   if it can't be resolved the runner pauses until the operator reconciles it;
// - limits on decisions, Jev requests and input tokens;
// - request timeouts that can't change the game don't pause: a Jev request that timed out (after the
//   client's own retry) counts as a decision with no Jev answer (jev_timeout, nothing sent), and a bridge
//   read that timed out (after the client's retries) is logged (bridge_read_timeout) and the next step reads again.
// error and runner_paused records name the source: jev, bridge_read, bridge_command, or runner/operator otherwise.
import {open, stat, unlink} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {randomUUID} from 'node:crypto';
import {RequestError, errorSource} from './request-error.mjs';

export async function acquireOperatorLock(file, {pid = process.pid} = {}) {
 const handle = await open(file, 'wx', 0o600).catch(error => {
  if (error.code === 'EEXIST') throw Error(`Operator lock ${file} exists. Check that no other runner is active before removing it.`);
  throw error;
 });
 await handle.writeFile(JSON.stringify({pid, startedAt: new Date().toISOString()}));
 await handle.close();
 return () => unlink(file).catch(() => {});
}

// A short lock around a read-modify-write of a shared file (two runners updating the same calibration file):
// <file>.lock is created exclusively, fn runs, and the lock is removed. A held lock is retried every waitMs for up to
// timeoutMs; a lock older than staleMs (left by a process that died inside fn) is removed and taken.
export async function withFileLock(file, fn, {waitMs = 50, timeoutMs = 10000, staleMs = 30000, now = Date.now} = {}) {
 const lock = `${file}.lock`, until = now() + timeoutMs;
 for (;;) {
  try { await (await open(lock, 'wx', 0o600)).close(); break; }
  catch (error) {
   if (error.code !== 'EEXIST') throw error;
   const age = await stat(lock).then(s => now() - s.mtimeMs, () => 0);
   if (age > staleMs) { await unlink(lock).catch(() => {}); continue; }
   if (now() >= until) throw Error(`Lock ${lock} is still held after ${timeoutMs} ms.`);
   await delay(waitMs);
  }
 }
 try { return await fn(); } finally { await unlink(lock).catch(() => {}); }
}

// Append-only JSONL run log. Appends are serialized; a dispatch record is synced to disk
// before append() resolves.
export function runLog(file) {
 let chain = Promise.resolve();
 const append = event => {
  const entry = {time: new Date().toISOString(), ...event};
  const write = chain.then(async () => {
   const handle = await open(file, 'a', 0o600);
   try {
    await handle.write(JSON.stringify(entry) + '\n');
    if (entry.kind === 'dispatch') await handle.sync();
   } finally { await handle.close(); }
  });
  chain = write.catch(() => {});
  return write.then(() => entry);
 };
 return {file, append};
}

// Game hooks:
//   observe()                          current state (throws when the game can't be read)
//   candidates(state)                  legal options; [] when the game isn't ready for one
//   due(state, options, memory)        false (or a promise of false) to skip deciding this tick
//   decide(state, options, {cancelled})  a decision from core/hierarchical.mjs decide()
//   fingerprint(state)                 the structure a decision depends on
//   stillValid(state, choice)          the chosen action's preconditions on a fresh observation
//   send(command)                      {status: executed | rejected | queued, ...}; throws when the result is unknown
//   lookup(commandId)                  the bridge's record of a command, or null if it has none
//   onExecuted(decision, result)       optional bookkeeping after a command executed
//   describe(state)                    optional compact state for the decision log
// usage/limits: {requests, inputTokens} counted by the Jev client, {maxRequests, maxInputTokens, maxDecisions}.
// maxDecisions counts decisions that aren't forced screen dismissals, with or without a Jev call.
export function createRunner({observe, candidates, due = () => true, decide, fingerprint, stillValid = () => true, send,
 lookup = null, onExecuted = () => {}, log, usage = {requests: 0, inputTokens: 0}, limits = {}, describe = s => s, policy = null,
 unresolvedMs = 30000, now = () => Date.now()}) {
 const status = {mode: 'paused', generation: 0, busy: false, uncertain: null, actions: 0, decisions: 0, message: 'Paused.', cause: null};
 const memory = {lastFingerprint: null, lastOptions: null, holdUntil: 0, lastDecisionAt: 0};

 // cause: errorSource() fields for the record that reports this pause.
 const pause = (message, cause = errorSource(null)) => { status.generation++; status.mode = 'paused'; status.message = message; status.cause = cause; };
 const commandCause = error => error instanceof RequestError ? errorSource(error)
  : {source: 'bridge_command', endpoint: null, timeout_ms: null, timed_out: false};
 const resume = () => {
  if (status.uncertain) throw Error('A command has an unknown result. Reconcile it before resuming.');
  status.generation++; status.mode = 'running'; status.message = 'Running.'; status.cause = null;
 };
 const overBudget = () => usage.requests >= (limits.maxRequests ?? Infinity) || usage.inputTokens >= (limits.maxInputTokens ?? Infinity)
  || status.decisions >= (limits.maxDecisions ?? Infinity);

 // A command the bridge accepted but hadn't finished, or whose response was lost.
 const settleUncertain = async () => {
  const pending = status.uncertain;
  const known = lookup ? await lookup(pending.command.command_id).catch(() => null) : null;
  if (known && known.status !== 'queued') {
   status.uncertain = null;
   if (known.status === 'executed') { status.actions++; if (pending.decision) await onExecuted(pending.decision, known); }
   await log.append({kind: 'dispatch', outcome: known.status === 'executed' ? 'executed' : 'game_rejected', command_id: pending.command.command_id, result: known});
   return true;
  }
  if (now() - pending.since > unresolvedMs) {
   pause(`The result of ${pending.command.action} is still unknown. Check the game, then reconcile.`, commandCause(null));
   await log.append({kind: 'dispatch', outcome: 'unresolved', command_id: pending.command.command_id});
  }
  return false;
 };

 async function step() {
  if (status.busy) return 'busy';
  status.busy = true;
  const token = status.generation, live = () => token === status.generation;
  try {
   if (status.uncertain && !await settleUncertain()) return 'uncertain';
   const state = await observe();
   if (!live()) return 'cancelled';
   const options = candidates(state);
   if (!options.length) return 'idle';
   if (!await due(state, options, memory)) return 'not_due';
   if (overBudget()) { pause('Session limit reached. Totals persist; raise the limits deliberately before resuming.', {...errorSource(null), source: 'limit'}); return 'budget'; }
   const decision = await decide(state, options, {cancelled: () => !live()});
   if (decision.decisionSource !== 'forced') status.decisions++;
   memory.lastFingerprint = fingerprint(state);
   memory.lastOptions = options.map(o => o.id);
   memory.lastDecisionAt = now();
   for (const event of decision.strategyEvents ?? []) await log.append(event);
   const {choice} = decision;
   const record = {kind: 'decision', policy, decisionSource: decision.decisionSource, model: decision.model ?? null,
    usage: decision.usage ?? null, answer: decision.answers?.move ?? null, constraint: decision.constraint ?? null,
    ...(decision.planInForce !== undefined ? {plan: decision.planInForce} : {}),
    ...(decision.tieBreaks?.length ? {tie_break: decision.tieBreaks} : {}),
    ...(decision.answers?.group ? {group_answer: decision.answers.group} : {}), ...(decision.narrowed ? {narrowed: decision.narrowed} : {}),
    chosen: {id: choice.id, label: choice.label, command: choice.command ?? null}, options: options.map(o => o.id), state: describe(state)};
   if (!live()) { await log.append({...record, outcome: 'cancelled'}); return 'cancelled'; }
   if (!choice.command) {
    memory.holdUntil = now() + (choice.hold_ms ?? 0);
    await log.append({...record, outcome: 'held'});
    return 'held';
   }
   const fresh = await observe();
   if (!live()) { await log.append({...record, outcome: 'cancelled'}); return 'cancelled'; }
   if (fingerprint(fresh) !== fingerprint(state) || !stillValid(fresh, choice)) {
    await log.append({...record, outcome: 'stale_rejected'});
    return 'stale';
   }
   const command = {...choice.command, command_id: randomUUID()};
   record.command_id = command.command_id;
   status.uncertain = {command, since: now(), decision};
   try { await log.append({kind: 'dispatch', outcome: 'pending', command}); }
   catch (error) { status.uncertain = null; throw Error(`The dispatch record could not be written, so the command was not sent: ${error.message}`); }
   if (!live()) {
    status.uncertain = null;
    await log.append({kind: 'dispatch', outcome: 'cancelled_before_send', command_id: command.command_id});
    return 'cancelled';
   }
   let result;
   try { result = await send(command); }
   catch (error) {
    // Never resend: the command may have executed. Ask the bridge what happened to this ID.
    result = lookup ? await lookup(command.command_id).catch(() => null) : null;
    if (!result) {
     pause(`The result of ${command.action} is unknown (${error.message}). Check the game, then reconcile.`, commandCause(error));
     await log.append({kind: 'dispatch', outcome: 'uncertain', command_id: command.command_id, message: error.message, ...commandCause(error)});
     return 'uncertain';
    }
   }
   if (result.status === 'queued') {
    await log.append({...record, outcome: 'queued', result});
    return 'queued';
   }
   status.uncertain = null;
   if (result.status === 'executed') { status.actions++; await onExecuted(decision, result); }
   await log.append({...record, outcome: result.status === 'executed' ? 'executed' : 'game_rejected', result});
   return result.status === 'executed' ? 'executed' : 'rejected';
  } catch (error) {
   const cause = errorSource(error);
   if (cause.timed_out && cause.source === 'jev') {
    // No answer is not an action: nothing is sent, and the next due step decides again.
    status.decisions++;
    Object.assign(memory, {lastFingerprint: null, lastOptions: null, lastDecisionAt: now(), holdUntil: now()});
    await log.append({kind: 'jev_timeout', message: error.message, ...cause}).catch(() => {});
    return 'jev_timeout';
   }
   if (cause.timed_out && cause.source === 'bridge_read') {
    await log.append({kind: 'bridge_read_timeout', message: error.message, ...cause}).catch(() => {});
    return 'read_timeout';
   }
   pause(error.message, cause);
   await log.append({kind: 'error', message: error.message, ...cause}).catch(() => {});
   return 'error';
  } finally { status.busy = false; }
 }

 // Operator acknowledgement of an unknown result: resolved from the bridge when it can be,
 // otherwise cleared only with force after the operator has checked the game.
 async function reconcile({force = false} = {}) {
  if (!status.uncertain) return 'clear';
  if (status.busy) throw Error('Wait for the current step to finish.');
  const pending = status.uncertain;
  const known = lookup ? await lookup(pending.command.command_id).catch(() => null) : null;
  if ((known && known.status !== 'queued') || force) {
   status.uncertain = null;
   await log.append({kind: 'reconciled_by_operator', command_id: pending.command.command_id, result: known ?? null, forced: !known});
   pause('Reconciled. Observe the game before resuming.', {...errorSource(null), source: 'operator'});
   return known ? known.status : 'forced';
  }
  return 'unresolved';
 }

 return {status, memory, step, pause, resume, reconcile};
}
