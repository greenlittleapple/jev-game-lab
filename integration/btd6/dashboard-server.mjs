// The live BTD6 dashboard: npm run btd6:dashboard, on 127.0.0.1 only (default port 4319; 4317 is the STS2
// page and 4318 the runner's status page). It is read-only and runs beside a series without touching it:
// it tails the newest run log and series.jsonl, and reads the bridge with GET /api/v1/state (about once a
// second), /api/v1/health and /api/v1/map (once per match). It sends no commands, takes no lock and writes
// no files. The model is in dashboard.mjs, the page in dashboard.html.
//   npm run btd6:dashboard                                  (.private/btd6/runs of this checkout, bridge 15527)
//   npm run btd6:dashboard -- --dry-run                     (.private/btd6/dry-run/runs, no bridge reads)
//   npm run btd6:dashboard -- --runs-dir <dir> [--series <file>] [--bridge-port <port> | --no-bridge] [--port <port>]
// --series defaults to series.jsonl beside the runs directory. BTD6_DASHBOARD_PORT and BTD6_BRIDGE_PORT set the
// ports too. The bridge port also picks the run followed: the newest run log of that port (session_start.bridge_port;
// logs without it count as 15527), so a second game copy has its own dashboard:
//   npm run btd6:dashboard -- --bridge-port 15528 --port 4321
// The run history and series list every run, from both copies, with each run's port.
import {createServer} from 'node:http';
import {readFile, readdir, stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname, join, resolve} from 'node:path';
import {bridgeClient, DEFAULT_PORT as BRIDGE_PORT} from './bridge-client.mjs';
import {mapPaths} from './spot-catalog.mjs';
import {buildView, historyScanner, liveTracker, logTail, readSeries, runModel} from './dashboard.mjs';

export const DEFAULT_PORT = 4319;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PAGE_FILE = new URL('./dashboard.html', import.meta.url);

// The playbook a v5 run names (session_start.playbook.id), from integration/btd6/playbooks.
async function playbookById(id) {
 if (!id) return null;
 const dir = join(root, 'integration/btd6/playbooks');
 for (const f of (await readdir(dir).catch(() => [])).filter(f => f.endsWith('.json'))) {
  const pb = JSON.parse(await readFile(join(dir, f), 'utf8').catch(() => 'null'));
  if (pb?.id === id) return pb;
 }
 return null;
}

// The data side: log tail, series, history and bridge reads, refreshed by tick(). bridge: a bridgeClient (only its
// health, state and map reads are used), or null for none.
export function dashboardSource({runsDir, seriesFile = join(runsDir, '..', 'series.jsonl'), bridge = null, bridgePort = null, now = Date.now, healthEveryMs = 10000, historyEveryMs = 10000}) {
 const tail = logTail(runsDir, {bridgePort}), scan = historyScanner(runsDir), tracker = liveTracker();
 const d = {run: null, history: [], series: [], seriesSize: -1, playbook: null, playbookId: null, paths: [], pathsFor: null,
  bridge: {enabled: Boolean(bridge), up: false, state: null, health: null, error: bridge ? null : 'bridge reads are off', at: null, since: null},
  lastHealth: -Infinity, lastHistory: -Infinity, lastLogState: null, busy: false};
 const readBridge = async () => {
  const t = now();
  try {
   if (t - d.lastHealth >= healthEveryMs || !d.bridge.up) { d.bridge.health = await bridge.health(); d.lastHealth = t; }
   const state = await bridge.state();
   if (!d.bridge.up) d.bridge.since = new Date(t).toISOString();
   Object.assign(d.bridge, {up: true, state, error: null, at: new Date(t).toISOString()});
   if (state.in_game) {
    tracker.observe(state);
    if (d.pathsFor !== state.match.id) {
     // Only once per match; a failure is tried again on the next read.
     d.paths = mapPaths(await bridge.map().catch(() => null));
     if (d.paths.length) d.pathsFor = state.match.id;
    }
   }
  } catch (error) {
   if (d.bridge.up) d.bridge.since = new Date(t).toISOString();
   Object.assign(d.bridge, {up: false, state: null, error: error.message, at: new Date(t).toISOString()});
  }
 };
 d.tick = async () => {
  if (d.busy) return;
  d.busy = true;
  try {
   for (const {file, records, fresh} of await tail.poll()) {
    if (fresh || !d.run || d.run.file !== file) d.run = runModel(file);
    for (const r of records) d.run.add(r);
   }
   // Without the bridge, the leak-pressure and lives trackers follow the states the log records.
   if (!d.bridge.up && d.run?.lastState?.in_game && d.run.lastStateTime !== d.lastLogState) { tracker.observe(d.run.lastState); d.lastLogState = d.run.lastStateTime; }
   const id = d.run?.session?.playbook?.id ?? null;
   if (id !== d.playbookId) { d.playbookId = id; d.playbook = await playbookById(id); }
   const size = (await stat(seriesFile).catch(() => null))?.size ?? 0;
   if (size !== d.seriesSize) { d.series = await readSeries(seriesFile); d.seriesSize = size; }
   if (now() - d.lastHistory >= historyEveryMs) { d.history = await scan(); d.lastHistory = now(); }
   if (bridge) await readBridge();
  } finally { d.busy = false; }
 };
 d.view = () => buildView({run: d.run, bridge: d.bridge, paths: d.paths, history: d.history, series: d.series, tracker, playbook: d.playbook, now: now(), runsDir: runsDir.split(/[\\/]/).slice(-2).join('/')});
 return d;
}

// The server: GET / (the page) and GET /api/view, on host only; any other method is refused, and a request for
// another host name gets 403 (as status-server.mjs).
export async function startDashboard({source, port = DEFAULT_PORT, host = '127.0.0.1', intervalMs = 1000}) {
 const page = await readFile(PAGE_FILE, 'utf8');
 let actualPort = port;
 const send = (res, status, type, body) => {
  res.writeHead(status, {'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
   'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; frame-ancestors 'none'"});
  res.end(body);
 };
 const sendJson = (res, status, data) => send(res, status, 'application/json; charset=utf-8', JSON.stringify(data));
 const server = createServer((req, res) => {
  const hosts = [`127.0.0.1:${actualPort}`, `localhost:${actualPort}`];
  if (!hosts.includes(req.headers.host)) return sendJson(res, 403, {error: 'wrong host'});
  if (req.method !== 'GET') return sendJson(res, 405, {error: 'read-only'});
  const path = new URL(req.url, `http://${req.headers.host}`).pathname;
  try {
   if (path === '/') return send(res, 200, 'text/html; charset=utf-8', page);
   if (path === '/api/view') return sendJson(res, 200, source.view());
   return sendJson(res, 404, {error: 'not found'});
  } catch (error) { return sendJson(res, 500, {error: error.message}); }
 });
 await source.tick().catch(() => {});
 const timer = setInterval(() => source.tick().catch(() => {}), intervalMs);
 return new Promise((resolve, reject) => {
  server.once('error', error => { clearInterval(timer); reject(error); });
  server.listen(port, host, () => {
   actualPort = server.address().port;
   resolve({server, port: actualPort, url: `http://127.0.0.1:${actualPort}/`, close: () => { clearInterval(timer); return new Promise(r => server.close(() => r())); }});
  });
 });
}

export function dashboardConfig(argv, env = {}) {
 const flag = name => { const i = argv.indexOf(name); if (i < 0) return null; const v = argv[i + 1]; if (v == null || v.startsWith('--')) throw Error(`${name} needs a value.`); return v; };
 const portOf = (v, name) => { const n = Number(v); if (!Number.isInteger(n) || n < 1 || n > 65535) throw Error(`${name} must be a port number.`); return n; };
 const known = ['--dry-run', '--no-bridge', '--runs-dir', '--series', '--bridge-port', '--port'];
 for (const a of argv) if (a.startsWith('--') && !known.includes(a)) throw Error(`Unknown option ${a}.`);
 const dryRun = argv.includes('--dry-run');
 const runsDir = resolve(flag('--runs-dir') ?? join(root, dryRun ? '.private/btd6/dry-run/runs' : '.private/btd6/runs'));
 return {runsDir, seriesFile: resolve(flag('--series') ?? join(runsDir, '..', 'series.jsonl')),
  bridge: !(dryRun || argv.includes('--no-bridge')),
  bridgePort: flag('--bridge-port') != null ? portOf(flag('--bridge-port'), '--bridge-port') : env.BTD6_BRIDGE_PORT ? portOf(env.BTD6_BRIDGE_PORT, 'BTD6_BRIDGE_PORT') : BRIDGE_PORT,
  port: flag('--port') != null ? portOf(flag('--port'), '--port') : env.BTD6_DASHBOARD_PORT ? portOf(env.BTD6_DASHBOARD_PORT, 'BTD6_DASHBOARD_PORT') : DEFAULT_PORT};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 let config;
 try { config = dashboardConfig(process.argv.slice(2), process.env); }
 catch (error) {
  console.error(error.message);
  console.error('Usage: npm run btd6:dashboard -- [--dry-run] [--runs-dir <dir>] [--series <file>] [--bridge-port <port> | --no-bridge] [--port <port>]');
  process.exit(2);
 }
 const bridge = config.bridge ? bridgeClient({port: config.bridgePort, timeoutMs: 1500}) : null;
 const source = dashboardSource({runsDir: config.runsDir, seriesFile: config.seriesFile, bridge, bridgePort: config.bridgePort});
 const dash = await startDashboard({source, port: config.port}).catch(error => { console.error(`Can't listen on port ${config.port}: ${error.message}`); process.exit(1); });
 console.log(`BTD6 dashboard: ${dash.url} (runs: ${config.runsDir}, following bridge port ${config.bridgePort}; bridge ${config.bridge ? `reads on port ${config.bridgePort}` : 'off'}). Ctrl+C stops it.`);
 process.on('SIGINT', async () => { await dash.close(); process.exit(0); });
}
