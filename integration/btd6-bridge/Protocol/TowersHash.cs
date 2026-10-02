using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;

namespace JevBtd6Bridge.Protocol;

// A short fingerprint of the towers on the map (IDs, types and upgrade tiers). The state reports it,
// and a command must name the value it saw, so a decision made before a tower changed is refused.
// 0.3.13: a hero's level is left out. It rises with XP on its own, and each level-up made every command in
// flight stale (16 of 40 stale_towers refusals in the logs of 2026-09-30 came right after a wait). The one
// command that acts on the level, upgrade_tower on the hero, checks it with expect.tiers instead.
public static class TowersHash
{
    public static string Compute(IEnumerable<TowerDto> towers)
    {
        var text = new StringBuilder();
        foreach (var t in towers.OrderBy(t => t.Id))
            text.Append(t.Id.ToString(CultureInfo.InvariantCulture)).Append('|').Append(t.BaseId).Append('|')
                .Append(t.IsHero ? "hero" : string.Join("-", t.Tiers)).Append(';');
        // 64-bit FNV-1a over the UTF-8 text.
        ulong hash = 14695981039346656037UL;
        foreach (var b in Encoding.UTF8.GetBytes(text.ToString())) { hash ^= b; hash *= 1099511628211UL; }
        return hash.ToString("x16", CultureInfo.InvariantCulture);
    }
}
