using System;
using System.Collections.Generic;
using System.Linq;
using Il2CppAssets.Scripts.Models.Profile;
using Il2CppAssets.Scripts.Unity;
using Il2CppAssets.Scripts.Utils;
using JevBtd6Bridge.Protocol;

namespace JevBtd6Bridge;

// GET /api/v1/profile: the account's persisted profile (Game.Player.Data, a ProfileModel), read on the
// main thread. It reads the saved fields directly, not the Btd6Player unlock checks, so the runner can
// tell whether anything was written into the saved unlocks during a run.
// Read only: the collections are enumerated and the KonFuze values read through their Value getter
// (as Mod Helper reads Monkey Money); nothing is added, removed or assigned. Member names were checked
// against the installed game's generated assemblies (BTD6 56.3).
// This is the only bridge file allowed to name the profile's unlock fields (checks/bridge-scope.test.mjs).
internal static class ProfileReader
{
    public static ProfileDto Read()
    {
        var dto = new ProfileDto
        {
            BridgeVersion = ModHelperData.Version,
            ObservedAt = DateTime.UtcNow.ToString("o"),
            UnlockAll = Unlocks.All, Extra = Unlocks.Details(),
        };
        var player = Game.Player;
        var profile = player == null ? null : player.Data;
        if (profile == null) throw new BridgeException(409, "No player profile is loaded");
        dto.UnlockedTowers = Sorted(profile.unlockedTowers);
        dto.UnlockedHeroes = Sorted(profile.unlockedHeroes);
        dto.AcquiredUpgrades = Sorted(profile.acquiredUpgrades);
        dto.AcquiredKnowledge = Sorted(profile.acquiredKnowledge);
        dto.Rank = Whole(profile.rank);
        dto.Xp = Number(profile.xp);
        dto.VeteranRank = Whole(profile.veteranRank);
        dto.VeteranXp = Number(profile.veteranXp);
        dto.KnowledgePoints = Whole(profile.knowledgePoints);
        var towerXp = profile.towerXp;
        if (towerXp != null)
            foreach (var entry in towerXp)
                if (entry.Key != null) dto.TowerXp[entry.Key] = Number(entry.Value);
        return dto;
    }

    private static List<string> Sorted(Il2CppSystem.Collections.Generic.HashSet<string>? set)
    {
        var list = new List<string>();
        if (set == null) return list;
        foreach (var id in set) if (id != null) list.Add(id);
        return list.OrderBy(id => id, StringComparer.Ordinal).ToList();
    }

    private static double? Number(KonFuze? value) => value == null ? null : value.Value;

    private static long? Whole(KonFuze? value) => value == null ? null : (long)Math.Round(value.Value);
}
