using System.Collections.Generic;
using System.Globalization;
using BTD_Mod_Helper.Extensions;
using Il2CppAssets.Scripts.Models.Towers;
using Il2CppAssets.Scripts.Simulation.Towers.Behaviors.Attack;
using Il2CppAssets.Scripts.Simulation.Towers.Behaviors.Attack.Behaviors;
using Il2CppAssets.Scripts.Unity.Bridge;
using JevBtd6Bridge.Protocol;

namespace JevBtd6Bridge;

// Tower targeting (0.3.12; set_targeting changed in 0.3.14): the simulation's Tower.SetTargetType for the
// target type (see SetMode), and the call the tower panel makes for a point, UnityToSimulation
// ApplyTargetTypeData (the point a player taps for a Mortar's reticle, a Dartling's Locked target or a Heli's
// Lock In Place). The simulation reads the point from TargetSelectedPoint.targetPoint or
// LockInPlaceSetting.lockedPosition on the tower's attacks. Member names were checked against the game's
// generated assemblies (BTD6 56.3). set_target_point was checked live on 0.3.13; the
// 0.3.14 set_targeting is not yet checked live.
internal static class Targeting
{
    // The tower's current target type ID, read from the simulation Tower (TargetType on its CommonBehaviorProxy
    // base), or from TowerToSimulation when the tower isn't there.
    public static string? CurrentMode(TowerToSimulation tts) => tts.tower?.TargetType?.id ?? tts.TargetType?.id;

    public static List<string> Modes(TowerModel def)
    {
        var list = new List<string>();
        var types = def.targetTypes;
        if (types == null) return list;
        foreach (var t in types) if (t != null && !string.IsNullOrEmpty(t.id)) list.Add(t.id);
        return list;
    }

    // The point the tower's current target type aims at, or null.
    public static TargetPointDto? Point(TowerToSimulation tts)
    {
        var type = tts.TargetType;
        if (type == null || !type.isActionable) return null;
        var tower = tts.tower;
        if (tower == null) return null;
        foreach (var attack in tower.GetTowerBehaviors<Attack>())
        {
            var supplier = attack?.activeTargetSupplier;
            if (supplier == null) continue;
            var selected = supplier.TryCast<TargetSelectedPoint>();
            if (selected != null && selected.hasValidPoint) return new TargetPointDto { X = selected.targetPoint.x, Y = selected.targetPoint.y };
            var locked = supplier.TryCast<LockInPlaceSetting>();
            if (locked != null)
            {
                var position = locked.lockedPosition;
                if (position != null && position.HasValue) return new TargetPointDto { X = position.Value.x, Y = position.Value.y };
            }
        }
        return null;
    }

    // Sets the target type directly with the simulation's Tower.SetTargetType(TargetType) (0.3.14), passing the
    // TargetType object from the tower's own TowerModel.targetTypes, then reads the tower back in the same frame.
    // 0.3.12 and 0.3.13 stepped with UnityToSimulation.SetNextTowerTargetType, which the game applies on a later
    // simulation frame: the read right after it saw no change and the command answered not_applied while the
    // queued step still landed (live, 2026-09-30: First, asked for Strong, answered not_applied, then Last).
    public static CommandResultDto SetMode(BridgeCommand command, UnityToSimulation bridge, CommandLedger ledger)
    {
        var tts = bridge.GetTower(Il2CppAssets.Scripts.ObjectId.FromData(command.TowerId), true, false);
        if (tts == null || tts.destroyed) return Reject(command, ledger, "unknown_tower");
        var modes = Modes(tts.Def);
        if (!modes.Contains(command.TargetMode!)) return Reject(command, ledger, "mode_not_offered", string.Join(",", modes));
        if (tts.IsTargetTypeSwitchingLocked) return Reject(command, ledger, "targeting_locked");
        var tower = tts.tower;
        if (tower == null) return Reject(command, ledger, "unknown_tower");
        if (CurrentMode(tts) != command.TargetMode)
        {
            TargetType? wanted = null;
            foreach (var t in tts.Def.targetTypes) if (t != null && t.id == command.TargetMode) { wanted = t; break; }
            if (wanted == null) return Reject(command, ledger, "mode_not_offered", string.Join(",", modes));
            tower.SetTargetType(wanted);
        }
        tts = bridge.GetTower(tts.Id, true, false);
        if (tts == null) return Reject(command, ledger, "unknown_tower");
        // Executed only when the simulation tower shows the mode; otherwise the mode it shows now.
        var now = CurrentMode(tts);
        if (now != command.TargetMode) return Reject(command, ledger, "mode_not_reached", now);
        return ledger.Complete(command.CommandId, "executed", towerId: command.TowerId, towersHash: GameReader.CurrentTowersHash(bridge), detail: $"targeting {now}");
    }

    // Sets the point of the tower's current target type, which must take one.
    public static CommandResultDto SetPoint(BridgeCommand command, UnityToSimulation bridge, CommandLedger ledger)
    {
        int input = bridge.GetInputId();
        var tts = bridge.GetTower(Il2CppAssets.Scripts.ObjectId.FromData(command.TowerId), true, false);
        if (tts == null || tts.destroyed) return Reject(command, ledger, "unknown_tower");
        var type = tts.TargetType;
        if (type == null || !type.isActionable) return Reject(command, ledger, "mode_takes_no_point", type?.id);
        bridge.ApplyTargetTypeData(input, tts.Id, type, new Il2CppAssets.Scripts.Simulation.SMath.Vector2((float)command.X, (float)command.Y));
        var point = Point(tts);
        var detail = point == null ? $"targeting {type.id}; point not read back"
            : $"targeting {type.id}; point ({point.X.ToString("0.#", CultureInfo.InvariantCulture)}, {point.Y.ToString("0.#", CultureInfo.InvariantCulture)})";
        return ledger.Complete(command.CommandId, "executed", towerId: command.TowerId, towersHash: GameReader.CurrentTowersHash(bridge), detail: detail);
    }

    private static CommandResultDto Reject(BridgeCommand command, CommandLedger ledger, string reason, string? detail = null) =>
        ledger.Complete(command.CommandId, "rejected", reason, detail: detail);
}
