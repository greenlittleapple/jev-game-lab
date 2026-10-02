using System;
using System.Linq;
using BTD_Mod_Helper.Extensions;
using Il2CppAssets.Scripts;
using Il2CppAssets.Scripts.Models;
using Il2CppAssets.Scripts.Simulation;
using Il2CppAssets.Scripts.Unity;
using Il2CppAssets.Scripts.Unity.Bridge;
using Il2CppAssets.Scripts.Unity.UI_New.InGame;
using JevBtd6Bridge.Protocol;

namespace JevBtd6Bridge;

// Carries out one command on the main thread and records the outcome in the ledger there, so a late
// game callback can't be overwritten by an earlier record. Every check that can refuse a command runs
// before the game is asked to act; the game's own checks (cost, placement) still apply.
internal static class GameCommands
{
    public static CommandResultDto Execute(BridgeCommand command, CommandLedger ledger)
    {
        switch (command.Action)
        {
            case "dismiss_popup": return DismissPopup(command, ledger);
            case "start_match": return MatchFlow.Start(command, ledger);
            case "go_home": return MatchFlow.GoHome(command, ledger);
        }
        var bridge = GameReader.CurrentBridge();
        if (bridge == null) return Reject(command, ledger, "not_in_match");
        if (InGame.instance.IsCoop) return Reject(command, ledger, "coop_match");
        if (Game.instance.CanGetFlagged()) return Reject(command, ledger, "flag_risk_mode");
        var data = InGameData.CurrentGame;
        if (data == null || data.gameType != GameType.Standard) return Reject(command, ledger, "not_a_standard_game");
        // Auto-start may be restored after the result and while a screen pauses the game.
        if (command.Action == "set_auto_start")
            return command.ExpectMatchId != MatchTracker.Current() ? Reject(command, ledger, "stale_match") : GameSpeed.SetAutoStart(command, bridge, ledger);
        if (MatchTracker.Result != null) return Reject(command, ledger, "match_over");
        if (TimeManager.gamePaused) return Reject(command, ledger, "game_paused");
        if (command.ExpectMatchId != MatchTracker.Current()) return Reject(command, ledger, "stale_match");
        // Speed doesn't depend on the towers, so set_speed carries no towers hash.
        if (command.Action == "set_speed") return GameSpeed.Set(command, bridge, ledger);
        if (command.ExpectTowersHash != GameReader.CurrentTowersHash(bridge)) return Reject(command, ledger, "stale_towers");
        return command.Action switch
        {
            "place_tower" => Place(command, bridge, ledger),
            "upgrade_tower" => Upgrade(command, bridge, ledger),
            "start_round" => StartRound(command, bridge, ledger),
            "set_targeting" => Targeting.SetMode(command, bridge, ledger),
            "set_target_point" => Targeting.SetPoint(command, bridge, ledger),
            _ => Reject(command, ledger, "unknown_action"),
        };
    }

    // A screen over the match: the game is paused, or the match is over, so those checks don't apply.
    // A screen over the main menu has no match to check.
    private static CommandResultDto DismissPopup(BridgeCommand command, CommandLedger ledger)
    {
        var inGame = InGame.instance;
        var inMatch = inGame && !inGame.quitting;
        if (Array.IndexOf(CommandParser.MenuPopupKinds, command.Popup) >= 0)
            return inMatch ? Reject(command, ledger, "in_match") : Popups.Dismiss(command, ledger);
        if (!inMatch) return Reject(command, ledger, "not_in_match");
        if (inGame.IsCoop) return Reject(command, ledger, "coop_match");
        if (Game.instance.CanGetFlagged()) return Reject(command, ledger, "flag_risk_mode");
        if (command.ExpectMatchId != MatchTracker.Current()) return Reject(command, ledger, "stale_match");
        return Popups.Dismiss(command, ledger);
    }

    private static CommandResultDto Place(BridgeCommand command, UnityToSimulation bridge, CommandLedger ledger)
    {
        int input = bridge.GetInputId();
        if (!bridge.RetrieveTowerDisplayOrder(input).ToList().Contains(command.Tower!)) return Reject(command, ledger, "tower_not_in_shop");
        var model = GameReader.MatchModel(bridge).GetTowerFromId(command.Tower);
        if (model == null) return Reject(command, ledger, "unknown_tower");
        // The simulation checks cash and the mode's inventory but not the account's unlocks; the UI does.
        var player = Game.Player;
        if (player != null && !GameReader.Unlocked(player, model, command.Tower!)) return Reject(command, ledger, "tower_locked");
        var at = new UnityEngine.Vector2((float)command.X, (float)command.Y);
        if (!bridge.CanPlaceTowerAt(at, model, input, ObjectId.Invalid)) return Reject(command, ledger, "invalid_position");
        if (bridge.GetCash(input) < bridge.GetTowerCost(model, input)) return Reject(command, ledger, "insufficient_cash");

        var before = GameReader.TowerIds(bridge);
        bool? accepted = null;
        var finished = false;
        // Normal placement: inventory and placement checks on, the game's own cost deducted.
        bridge.CreateTowerAt(input, at, model, ObjectId.Invalid, false, new Action<bool>(ok =>
        {
            accepted = ok;
            if (finished) Settle(command, bridge, ledger, ok, before);
        }), ignoreInventoryChecks: false, ignorePlacementChecks: false);
        finished = true;
        if (accepted == false) return Reject(command, ledger, "game_refused");
        var created = GameReader.TowerIds(bridge).Except(before).Cast<uint?>().FirstOrDefault();
        if (created != null) return ledger.Complete(command.CommandId, "executed", towerId: created, towersHash: GameReader.CurrentTowersHash(bridge));
        // The game queued the action; its callback settles the record.
        return ledger.Complete(command.CommandId, "queued", "the game queued the placement");
    }

    private static CommandResultDto Upgrade(BridgeCommand command, UnityToSimulation bridge, CommandLedger ledger)
    {
        int input = bridge.GetInputId();
        var tower = bridge.GetTower(ObjectId.FromData(command.TowerId), true, false);
        if (tower == null || tower.destroyed) return Reject(command, ledger, "unknown_tower");
        if (command.ExpectTiers != null)
        {
            var now = tower.Def.tiers;
            if (now == null || now.Length < 3 || now[0] != command.ExpectTiers[0] || now[1] != command.ExpectTiers[1] || now[2] != command.ExpectTiers[2])
                return Reject(command, ledger, "stale_tiers");
        }
        string? upgradeId = null;
        int tier = 0;
        var paths = tower.Def.upgrades;
        if (paths != null)
            foreach (var next in paths)
            {
                var upgrade = next == null ? null : GameReader.MatchModel(bridge).GetUpgrade(next.upgrade);
                if (upgrade != null && upgrade.path == command.Path) { upgradeId = next!.upgrade; tier = upgrade.tier; break; }
            }
        if (upgradeId == null) return Reject(command, ledger, "no_upgrade_on_path");
        if (Game.Player != null && !Game.Player.HasUpgrade(upgradeId)) return Reject(command, ledger, "upgrade_locked");
        // The upgrade button's price for the 1-based tier it reaches, as the state reports it.
        if (bridge.GetCash(input) < tower.GetUpgradeCost(command.Path, tier + 1, -1, false)) return Reject(command, ledger, "insufficient_cash");

        bool? accepted = null;
        var finished = false;
        bridge.UpgradeTower(input, tower.Id, command.Path, 0, new Action<bool>(ok =>
        {
            accepted = ok;
            if (finished) Settle(command, bridge, ledger, ok, null);
        }));
        finished = true;
        if (accepted == true) return ledger.Complete(command.CommandId, "executed", towerId: command.TowerId, towersHash: GameReader.CurrentTowersHash(bridge));
        if (accepted == false) return Reject(command, ledger, "game_refused");
        return ledger.Complete(command.CommandId, "queued", "the game queued the upgrade");
    }

    private static CommandResultDto StartRound(BridgeCommand command, UnityToSimulation bridge, CommandLedger ledger)
    {
        if (bridge.AreRoundsActive()) return Reject(command, ledger, "round_active");
        bridge.StartRound();
        return ledger.Complete(command.CommandId, "executed", towersHash: GameReader.CurrentTowersHash(bridge));
    }

    // A game callback that arrives after Execute returned "queued".
    private static void Settle(BridgeCommand command, UnityToSimulation bridge, CommandLedger ledger, bool ok, System.Collections.Generic.HashSet<uint>? before)
    {
        if (ledger.Get(command.CommandId)?.Status != "queued") return;
        uint? towerId = ok && before != null ? GameReader.TowerIds(bridge).Except(before).Cast<uint?>().FirstOrDefault() : ok ? command.TowerId : null;
        ledger.Complete(command.CommandId, ok ? "executed" : "rejected", ok ? null : "game_refused", towerId, GameReader.CurrentTowersHash(bridge));
    }

    private static CommandResultDto Reject(BridgeCommand command, CommandLedger ledger, string reason) =>
        ledger.Complete(command.CommandId, "rejected", reason);
}
