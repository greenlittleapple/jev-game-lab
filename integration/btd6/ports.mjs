// Two game copies on one PC: each copy's bridge listens on its own port ([JevBtd6Bridge] port in that copy's
// MelonPreferences.cfg) and each runner names its files after that port, so two runners can share .private/btd6.
// The default port keeps the names from before (runner.lock, <time>-<policy>.jsonl), so existing scripts still work.
import {DEFAULT_PORT} from './bridge-client.mjs';

export {DEFAULT_PORT};

export const isDefaultPort = port => port == null || Number(port) === DEFAULT_PORT;
const isDefault = isDefaultPort;

// '' for the default port, -port<port> for any other: added to names two copies could otherwise share. Live match IDs
// are the bridge's start second and a per-process counter, so two copies can give the same ID; dry runs are all dry-1.
export const portSuffix = port => isDefault(port) ? '' : `-port${Number(port)}`;

// The bridge port from BTD6_BRIDGE_PORT, or the default; throws on a value that isn't a port number.
export function bridgePortFrom(env = {}) {
 if (env.BTD6_BRIDGE_PORT == null || env.BTD6_BRIDGE_PORT === '') return DEFAULT_PORT;
 const n = Number(env.BTD6_BRIDGE_PORT);
 if (!Number.isInteger(n) || n < 1 || n > 65535) throw Error('BTD6_BRIDGE_PORT must be a port number.');
 return n;
}

// The runner's operator lock: runner.lock for the default port, runner-<port>.lock for any other.
export const runnerLockName = port => isDefault(port) ? 'runner.lock' : `runner-${Number(port)}.lock`;

// A run log's file name: <stamp>-<policy>.jsonl for the default port, <stamp>-<policy>-port<port>.jsonl for any
// other, so two runners that start in the same millisecond can't share a file.
export const runLogName = (stamp, policy, port) => `${stamp}-${policy}${portSuffix(port)}.jsonl`;

// The bridge port a run log belongs to: session_start.bridge_port, else the file name's -port<port> suffix, else the
// default (logs from before the field).
export function logBridgePort(file, sessionStart = null) {
 if (sessionStart?.bridge_port != null) return Number(sessionStart.bridge_port);
 const m = /-port(\d+)\.jsonl$/.exec(file ?? '');
 return m ? Number(m[1]) : DEFAULT_PORT;
}
