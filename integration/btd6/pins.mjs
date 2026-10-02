// The BTD6 Mod Helper build the bridge was built and checked against: 3.6.8 (commit b3dae712), the
// SHA-256 of its Btd6ModHelper.dll. Mod Helper's UpdaterPlugin can replace it when the game starts, so
// the bridge reports the loaded version and hash in /api/v1/health (0.3.0 and later) and the runner
// stops when they differ from this pin. After checking a new Mod Helper release, update the pin.
export const MOD_HELPER_PIN = {version: '3.6.8', sha256: '1556c8143f2d6b5d277d817bbdf50f5bab8227ff7662f89dbbbc64a0aab8df5e'};

// Why the loaded Mod Helper doesn't match the pin, or null. A null pin turns the check off.
export function modHelperProblem(health, pin = MOD_HELPER_PIN) {
 if (!pin) return null;
 const loaded = health?.mod_helper;
 if (!loaded?.version || !loaded?.sha256)
  return `The bridge (${health?.version ?? 'unknown version'}) doesn't report which Mod Helper is loaded${loaded?.error ? ` (${loaded.error})` : ''}; bridge 0.3.0 and later do.`;
 if (loaded.version === pin.version && loaded.sha256 === pin.sha256) return null;
 return `Mod Helper ${loaded.version} (SHA-256 ${loaded.sha256.slice(0, 12)}...) is loaded, not the pinned ${pin.version} (${pin.sha256.slice(0, 12)}...). `
  + 'Its updater may have replaced it when the game started. Check the new build, then update integration/btd6/pins.mjs.';
}
