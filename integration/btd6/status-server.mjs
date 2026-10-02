// A small status page for a btd6:run session, on 127.0.0.1 only (default port 4318; the STS2
// dashboard uses 4317). It shows bridge health, the match, the runner, recent decisions and
// dispatches, and has pause, resume and reconcile. Requests for another host name are refused, and
// the buttons need the page's per-session token, so another web page can't press them.
import {createServer} from 'node:http';
import {randomBytes, timingSafeEqual} from 'node:crypto';

const compactState = s => {
 if (!s) return null;
 if (!s.in_game) return {in_game: false, main_menu: s.main_menu ?? null, loading: s.loading ?? null, popup: s.popup ? {kind: s.popup.kind, class: s.popup.class} : null};
 return {in_game: true, match: s.match.id, setup: `${s.match.map} ${s.match.difficulty} ${s.match.mode_name ?? s.match.mode}`, result: s.match.result ?? null,
  round: s.round.number, final_round: s.match.end_round ?? null, round_active: Boolean(s.round.active), cash: Math.floor(s.cash), lives: s.lives, starting_lives: s.starting_lives,
  ready: s.ready ?? null, paused: s.paused ?? null, fast_forward: s.fast_forward ?? null, auto_start: s.auto_start ?? null, unlock_all: s.unlock_all ?? null,
  popup: s.popup ? {kind: s.popup.kind, class: s.popup.class} : null,
  towers: s.towers.map(t => `#${t.id} ${t.base_id} ${t.tiers.join('-')}`)};
};

const decisionRow = e => ({time: e.time, round: e.state?.round?.number ?? null, source: e.decisionSource, chosen: e.chosen?.label ?? e.chosen?.id, outcome: e.outcome,
 options: e.options?.length ?? null, input_tokens: e.usage?.input_tokens ?? null, reason: e.result?.reason ?? null});
// A settled record names only the command ID; its action comes from the pending record.
const dispatchRow = actions => e => ({time: e.time, outcome: e.outcome, action: e.command?.action ?? actions.get(e.command_id) ?? null, command_id: e.command?.command_id ?? e.command_id ?? null,
 reason: e.result?.reason ?? e.message ?? null, detail: e.result?.detail ?? null});

export function statusSnapshot(session) {
 const r = session.runner?.status;
 const h = session.health;
 const actions = new Map(session.recent.dispatches.filter(e => e.command).map(e => [e.command.command_id, e.command.action]));
 return {
  phase: session.phase, message: session.message, policy: session.policy, setup: session.setup, started_at: session.startedAt, result: session.result,
  held: session.held,
  bridge: h ? {version: h.version ?? null, main_thread_pumping: h.main_thread_pumping ?? null, unlock_all: h.unlock_all ?? null,
   mod_helper: h.mod_helper ? `${h.mod_helper.version} (${String(h.mod_helper.sha256 ?? '').slice(0, 12)})` : null} : null,
  match: compactState(session.state),
  runner: r ? {mode: r.mode, message: r.message, decisions: r.decisions, actions: r.actions, uncertain: r.uncertain ? r.uncertain.command.action : null} : null,
  usage: {jev_requests: session.usage.requests, input_tokens: session.usage.inputTokens},
  limits: {max_decisions: session.limits.maxDecisions, max_input_tokens: session.limits.maxInputTokens},
  decisions: session.recent.decisions.map(decisionRow).reverse(),
  dispatches: session.recent.dispatches.map(dispatchRow(actions)).reverse(),
  events: session.recent.events.map(e => ({time: e.time, kind: e.kind, message: e.message ?? e.reason ?? e.result ?? null})).reverse(),
 };
}

export function startStatusServer(session, {port = 4318, host = '127.0.0.1'} = {}) {
 const token = randomBytes(18).toString('base64url');
 const tokenBuffer = Buffer.from(token);
 let actualPort = port;
 const send = (res, status, type, body) => {
  res.writeHead(status, {'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
   'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'"});
  res.end(body);
 };
 const sendJson = (res, status, data) => send(res, status, 'application/json; charset=utf-8', JSON.stringify(data));
 const server = createServer(async (req, res) => {
  const hosts = [`127.0.0.1:${actualPort}`, `localhost:${actualPort}`];
  if (!hosts.includes(req.headers.host)) return sendJson(res, 403, {error: 'wrong host'});
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
   if (req.method === 'GET' && url.pathname === '/') return send(res, 200, 'text/html; charset=utf-8', PAGE.replace('__TOKEN__', token));
   if (req.method === 'GET' && url.pathname === '/api/status') return sendJson(res, 200, statusSnapshot(session));
   if (req.method === 'POST' && ['/api/pause', '/api/resume', '/api/reconcile'].includes(url.pathname)) {
    const given = Buffer.from(String(req.headers['x-status-token'] ?? ''));
    const origin = req.headers.origin;
    if (given.length !== tokenBuffer.length || !timingSafeEqual(given, tokenBuffer) || (origin && !hosts.some(h => origin === `http://${h}`)))
     return sendJson(res, 403, {error: 'missing or wrong token'});
    if (url.pathname === '/api/pause') session.pause();
    else if (url.pathname === '/api/resume') session.resume();
    else return sendJson(res, 200, {reconcile: await session.reconcile()});
    return sendJson(res, 200, {ok: true});
   }
   return sendJson(res, 404, {error: 'not found'});
  } catch (error) { return sendJson(res, 409, {error: error.message}); }
 });
 return new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(port, host, () => {
   actualPort = server.address().port;
   resolve({server, token, port: actualPort, url: `http://127.0.0.1:${actualPort}/`, close: () => new Promise(r => server.close(() => r()))});
  });
 });
}

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>BTD6 runner</title>
<style>
:root { --bg: #f6f7f9; --panel: #fff; --text: #1d2330; --muted: #5f6b7a; --line: #dde2e8; --accent: #2f6fdb; --good: #1f8a4c; --bad: #c0392b; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root { --bg: #14171c; --panel: #1c2027; --text: #e4e8ee; --muted: #9aa5b3; --line: #2c323c; --accent: #6ea0ff; --good: #4cc27d; --bad: #ef6b5b; color-scheme: dark; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.45 system-ui, sans-serif; }
main { max-width: 1000px; margin: 0 auto; padding: 20px 16px 40px; }
h1 { font-size: 18px; margin: 0 0 4px; } h2 { font-size: 14px; margin: 0 0 8px; color: var(--muted); font-weight: 600; }
.bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 12px 0 16px; }
button { font: inherit; padding: 6px 14px; border-radius: 6px; border: 1px solid var(--line); background: var(--panel); color: var(--text); cursor: pointer; }
button:hover { border-color: var(--accent); }
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
section { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; min-width: 0; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 12px; margin: 0; } dt { color: var(--muted); } dd { margin: 0; overflow-wrap: anywhere; }
table { width: 100%; border-collapse: collapse; font-size: 13px; } th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid var(--line); vertical-align: top; }
th { color: var(--muted); font-weight: 600; } .wide { grid-column: 1 / -1; overflow-x: auto; }
.ok { color: var(--good); } .bad { color: var(--bad); } #msg { color: var(--muted); }
</style></head><body><main>
<h1>BTD6 runner</h1><div id="msg">Loading.</div>
<div class="bar"><button data-act="pause">Pause</button><button data-act="resume">Resume</button><button data-act="reconcile">Reconcile</button><span id="act"></span></div>
<div class="grid">
<section><h2>Session</h2><dl id="session"></dl></section>
<section><h2>Bridge</h2><dl id="bridge"></dl></section>
<section><h2>Match</h2><dl id="match"></dl></section>
<section class="wide"><h2>Decisions</h2><table id="decisions"></table></section>
<section class="wide"><h2>Dispatches</h2><table id="dispatches"></table></section>
<section class="wide"><h2>Events</h2><table id="events"></table></section>
</div></main>
<script>
const token = '__TOKEN__';
const esc = v => String(v ?? '-').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const dl = (id, rows) => { document.getElementById(id).innerHTML = rows.map(([k, v, cls]) => '<dt>' + esc(k) + '</dt><dd' + (cls ? ' class="' + cls + '"' : '') + '>' + esc(v) + '</dd>').join(''); };
const table = (id, cols, rows) => { document.getElementById(id).innerHTML = '<tr>' + cols.map(c => '<th>' + esc(c[0]) + '</th>').join('') + '</tr>'
 + (rows.length ? rows.map(r => '<tr>' + cols.map(c => '<td>' + esc(c[1](r)) + '</td>').join('') + '</tr>').join('') : '<tr><td colspan="' + cols.length + '">None yet.</td></tr>'); };
const time = t => t ? new Date(t).toLocaleTimeString() : '-';
async function refresh() {
 try {
  const s = await (await fetch('/api/status', {cache: 'no-store'})).json();
  document.getElementById('msg').textContent = s.phase + ': ' + (s.runner?.message ?? s.message ?? '');
  dl('session', [['Policy', s.policy], ['Setup', s.setup ? [s.setup.map, s.setup.difficulty, s.setup.mode].join(' ') : '-'], ['Runner', s.runner ? s.runner.mode : '-', s.runner?.mode === 'running' ? 'ok' : 'bad'],
   ['Decisions', (s.runner?.decisions ?? 0) + ' of ' + s.limits.max_decisions], ['Jev requests', s.usage.jev_requests], ['Input tokens', s.usage.input_tokens + ' of ' + s.limits.max_input_tokens],
   ['Unknown result', s.runner?.uncertain ?? 'none', s.runner?.uncertain ? 'bad' : ''], ['Result', s.result ?? '-']]);
  const b = s.bridge;
  dl('bridge', b ? [['Version', b.version], ['Frames running', b.main_thread_pumping, b.main_thread_pumping ? 'ok' : 'bad'], ['All unlocks', b.unlock_all], ['Mod Helper', b.mod_helper]] : [['Status', 'not read yet']]);
  const m = s.match;
  dl('match', !m ? [['State', 'not read yet']] : !m.in_game ? [['Screen', m.main_menu ? 'main menu' : m.loading ? 'loading' : 'other'], ['Popup', m.popup ? m.popup.kind + ' (' + m.popup.class + ')' : 'none']]
   : [['Match', m.match], ['Setup', m.setup], ['Round', m.round + ' of ' + m.final_round + (m.round_active ? ', running' : '')], ['Cash', '$' + m.cash], ['Lives', m.lives + ' of ' + m.starting_lives],
      ['Popup', m.popup ? m.popup.kind + ' (' + m.popup.class + ')' : 'none'], ['Result', m.result ?? '-'], ['Towers', m.towers.join(', ') || 'none']]);
  table('decisions', [['Time', r => time(r.time)], ['Round', r => r.round], ['Source', r => r.source], ['Chosen', r => r.chosen], ['Outcome', r => r.outcome + (r.reason ? ' (' + r.reason + ')' : '')], ['Options', r => r.options], ['Tokens', r => r.input_tokens]], s.decisions);
  table('dispatches', [['Time', r => time(r.time)], ['Action', r => r.action], ['Outcome', r => r.outcome], ['Reason or detail', r => r.reason ?? r.detail], ['Command', r => (r.command_id ?? '').slice(0, 8)]], s.dispatches);
  table('events', [['Time', r => time(r.time)], ['Kind', r => r.kind], ['Message', r => typeof r.message === 'object' ? JSON.stringify(r.message) : r.message]], s.events);
 } catch { document.getElementById('msg').textContent = 'The runner is not answering; it may have stopped.'; }
}
document.querySelectorAll('button[data-act]').forEach(b => b.addEventListener('click', async () => {
 const r = await fetch('/api/' + b.dataset.act, {method: 'POST', headers: {'X-Status-Token': token}});
 const body = await r.json().catch(() => ({}));
 document.getElementById('act').textContent = r.ok ? b.dataset.act + ': ' + (body.reconcile ?? 'done') : (body.error ?? 'refused');
 refresh();
}));
refresh(); setInterval(refresh, 1000);
</script></body></html>`;
