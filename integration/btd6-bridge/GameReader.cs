using System;
using System.Collections.Generic;
using System.Linq;
using BTD_Mod_Helper.Extensions;
using Il2CppAssets.Scripts;
using Il2CppAssets.Scripts.Models;
using Il2CppAssets.Scripts.Models.Towers;
using Il2CppAssets.Scripts.Simulation;
using Il2CppAssets.Scripts.Simulation.Bloons;
using Il2CppAssets.Scripts.Unity;
using Il2CppAssets.Scripts.Unity.Bridge;
using Il2CppAssets.Scripts.Unity.Player;
using Il2CppAssets.Scripts.Unity.UI_New.InGame;
using Il2CppAssets.Scripts.Unity.UI_New.Main;
using JevBtd6Bridge.Protocol;

namespace JevBtd6Bridge;

// Reads the game on the main thread. Member names were checked against the installed game's
// generated assemblies (BTD6 56.3, MelonLoader 0.7.3, Mod Helper 3.6.8); what the values mean
// in play is checked in the live spikes (docs/BTD6-SPIKE-PLAN.md).
internal static class GameReader
{
    public static UnityToSimulation? CurrentBridge()
    {
        // `!inGame` is Unity's liveness check: a destroyed InGame is not C# null.
        var inGame = InGame.instance;
        if (!inGame || inGame.quitting) return null;
        var bridge = inGame.bridge;
        return bridge == null || bridge.Simulation == null ? null : bridge;
    }

    // What MatchTracker compares to tell a re-initialised match from a new one. The Simulation's native
    // address identifies the object (IL2CPP's collector doesn't move objects).
    public static MatchSetup CurrentSetup()
    {
        var bridge = CurrentBridge();
        var data = InGameData.CurrentGame;
        if (bridge == null) return new MatchSetup(0, data?.selectedMap, data?.selectedMode, data?.selectedDifficulty, null);
        return new MatchSetup(bridge.Simulation.Pointer.ToInt64(), data?.selectedMap ?? bridge.GetMapName(), data?.selectedMode,
            data?.selectedDifficulty ?? bridge.GetDifficultyName(), bridge.GetCurrentRound());
    }

    public static UnityToSimulation RequireMatch() => CurrentBridge() ?? throw new BridgeException(409, "Not in a match");

    // The match's own copy of the game model, with the mode's prices and rules (Hard and CHIMPS differ
    // from the base model's Medium prices). Tower and upgrade lookups in a match go through it.
    public static GameModel MatchModel(UnityToSimulation bridge) => bridge.Model ?? Game.instance.model;

    // The account's unlock, as the UI checks it: heroes and towers are separate checks.
    public static bool Unlocked(Btd6Player player, TowerModel tower, string id) =>
        tower.IsHero() ? player.HasUnlockedHero(id, false) : player.HasUnlockedTower(id);

    public static BridgeStateDto ReadState()
    {
        var state = new BridgeStateDto
        {
            BridgeVersion = ModHelperData.Version,
            GameVersion = Game.Version?.ToString(),
            ObservedAt = DateTime.UtcNow.ToString("o"),
            UnlockAll = Unlocks.All,
        };
        var menus = Il2CppAssets.Scripts.Unity.Menu.MenuManager.instance;
        var menu = menus == null ? null : menus.GetCurrentMenu();
        state.Menu = menus == null ? null : menus.GetCurrentMenuName();
        state.MainMenu = menu != null && menu.TryCast<MainMenu>() != null;
        var ui = Il2CppAssets.Scripts.Unity.UI_New.UI.instance;
        state.Loading = ui != null && ui.isLoadingGame;
        state.Scene = UnityEngine.SceneManagement.SceneManager.GetActiveScene().name;
        state.Popup = Popups.Read();
        var bridge = CurrentBridge();
        if (bridge == null) return state;
        var inGame = InGame.instance;
        var data = InGameData.CurrentGame;
        var simulation = bridge.Simulation;
        bridge.GetRoundDisplayInfo(out var beforeFirstWave, out var roundsActive, out var gameLost);
        // Mod Helper's victory and defeat hooks set the result; the simulation's flags back them up.
        var result = MatchTracker.Result ?? (gameLost || simulation.gameLost ? "defeat" : simulation.gameWon ? "victory" : null);

        state.Screen = "in_game";
        state.Match = new MatchDto
        {
            Id = MatchTracker.Current(),
            Map = data?.selectedMap ?? bridge.GetMapName(),
            Mode = data?.selectedMode,
            Difficulty = data?.selectedDifficulty ?? bridge.GetDifficultyName(),
            GameType = data?.gameType.ToString(),
            Coop = inGame.IsCoop,
            Sandbox = bridge.IsSandboxMode(),
            ModelStartRound = bridge.Model?.startRound,
            ModelEndRound = bridge.Model?.endRound,
            EndRoundIndex = bridge.GetEndRound(),
            Result = result,
            DoubleCashUsed = bridge.WasDoubleCashUsed,
            AccountFlagged = Game.instance.IsAccountFlagged(),
            FlagRiskMode = Game.instance.CanGetFlagged(),
        };
        var roundIndex = bridge.GetCurrentRound();
        var lives = bridge.GetHealth();
        state.Round = new RoundDto { Index = roundIndex, Active = roundsActive, BeforeFirstWave = beforeFirstWave,
            LivesLost = MatchTracker.RoundLives.LivesLost(state.Match.Id, roundIndex, lives) };
        state.Cash = bridge.GetCash(bridge.GetInputId());
        state.Lives = lives;
        state.StartingLives = bridge.GetStartingHealth();
        state.MaxLives = inGame.GetMaxHealth();
        state.Paused = TimeManager.gamePaused;
        state.FastForward = TimeManager.FastForwardActive;
        state.Multiplier = GameSpeed.Multiplier();
        state.AutoStart = simulation.autoPlay;
        state.PendingActions = bridge.actions?.Count ?? 0;
        state.Towers = ReadTowers(bridge, out var subTowers);
        state.SubTowers = subTowers;
        state.TowersHash = TowersHash.Compute(state.Towers);
        state.Bloons = BloonSummary.Build(ReadBloons(simulation));
        state.Ready = state.Paused == false && state.PendingActions == 0 && state.Match.Result == null && state.Popup == null;
        return state;
    }

    // Bloons on the track. FactoryFactory.GetUncast<Bloon>() skips destroyed (pooled) bloons; IsDestroyed is
    // checked again in case. Progress is Bloon.PercThroughMap(), which doombubbles' UnFastForwardOnDanger
    // compares with a 0-1 threshold.
    private static List<BloonSample> ReadBloons(Simulation simulation)
    {
        var samples = new List<BloonSample>();
        var bloons = simulation.factory.GetUncast<Bloon>().GetEnumerator();
        try
        {
            while (bloons.MoveNext())
            {
                var bloon = bloons.Current;
                if (bloon == null || bloon.IsDestroyed) continue;
                var model = bloon.bloonModel;
                if (model == null) continue;
                samples.Add(new BloonSample(model.id, model.isCamo, model.isGrow, model.isFortified, model.isMoab, bloon.PercThroughMap(), bloon.health, model.maxHealth));
            }
        }
        finally { bloons.Dispose(); }
        return samples;
    }

    public static string CurrentTowersHash(UnityToSimulation bridge) => TowersHash.Compute(ReadTowers(bridge, out _));

    public static HashSet<uint> TowerIds(UnityToSimulation bridge) => ReadTowers(bridge, out _).Select(t => t.Id).ToHashSet();

    // The towers commands can act on. Towers that other towers create (TowerModel.isSubTower: Engineer
    // sentries, Comanches, phoenixes, hero summons) come and go on their own, so they are only counted.
    private static List<TowerDto> ReadTowers(UnityToSimulation bridge, out int subTowers)
    {
        var towers = new List<TowerDto>();
        subTowers = 0;
        var model = MatchModel(bridge);
        foreach (var tts in bridge.GetAllTowers().ToList())
        {
            if (tts == null || tts.destroyed) continue;
            var def = tts.Def;
            if (def.isSubTower) { subTowers++; continue; }
            var tiers = def.tiers;
            var position = tts.simPosition;
            towers.Add(new TowerDto
            {
                Id = tts.Id.Raw,
                BaseId = def.baseId,
                Name = def.name,
                Tiers = tiers != null && tiers.Length >= 3 ? new[] { tiers[0], tiers[1], tiers[2] } : new int[3],
                X = position.x,
                Y = position.y,
                // Towers that don't target (Banana Farm, Monkey Village) have no target type.
                Targeting = Targeting.CurrentMode(tts),
                TargetModes = Targeting.Modes(def),
                TargetPoint = Targeting.Point(tts),
                IsHero = def.IsHero(),
                IsParagon = tts.IsParagon,
                CreatedOnRound = tts.createdOnRound,
                Worth = tts.worth,
                Pops = tts.damageDealt,
                CashEarned = (long)Math.Round(tts.cashEarned),
                NextUpgrades = ReadUpgrades(tts, def, model),
            });
        }
        return towers;
    }

    // The next upgrade on each path the tower model allows. UpgradeModel.tier is 0-based; the price is
    // the upgrade button's, for the 1-based tier it reaches. Account unlocks are the UI's check, not
    // the simulation's, so they are reported here and enforced by the runner and GameCommands.
    private static List<UpgradeDto> ReadUpgrades(TowerToSimulation tts, TowerModel def, GameModel model)
    {
        var upgrades = new List<UpgradeDto>();
        if (def.upgrades == null) return upgrades;
        var player = Game.Player;
        foreach (var next in def.upgrades)
        {
            if (next == null) continue;
            var upgrade = model.GetUpgrade(next.upgrade);
            if (upgrade == null) continue;
            upgrades.Add(new UpgradeDto
            {
                Id = next.upgrade,
                Path = upgrade.path,
                Tier = upgrade.tier + 1,
                Cost = (int)Math.Round(tts.GetUpgradeCost(upgrade.path, upgrade.tier + 1, -1, false)),
                Unlocked = player?.HasUpgrade(next.upgrade),
            });
        }
        return upgrades;
    }

    public static MapDto ReadMap()
    {
        var mapModel = RequireMatch().Simulation.map.mapModel;
        var map = new MapDto { Map = mapModel.mapName };
        foreach (var path in mapModel.paths)
        {
            if (path == null) continue;
            var dto = new PathDto { Id = path.pathId, Active = path.isActive };
            foreach (var info in path.points) dto.Points.Add(new double[] { info.point.x, info.point.y });
            map.Paths.Add(dto);
        }
        return map;
    }

    public static PlacementDto CheckPlacement(string towerId, List<(double X, double Y)> points)
    {
        var bridge = RequireMatch();
        var model = MatchModel(bridge).GetTowerFromId(towerId) ?? throw new BridgeException(400, $"Unknown tower {towerId}");
        int input = bridge.GetInputId();
        var result = new PlacementDto { Tower = towerId };
        foreach (var (x, y) in points)
            result.Results.Add(new PlacementResultDto { X = x, Y = y, Valid = bridge.CanPlaceTowerAt(new UnityEngine.Vector2((float)x, (float)y), model, input, ObjectId.Invalid) });
        return result;
    }

    // The towers in the in-game shop, with what they would cost now.
    public static CatalogDto ReadCatalog()
    {
        var bridge = RequireMatch();
        int input = bridge.GetInputId();
        var model = MatchModel(bridge);
        var player = Game.Player;
        var catalog = new CatalogDto();
        foreach (var id in bridge.RetrieveTowerDisplayOrder(input).ToList())
        {
            var tower = model.GetTowerFromId(id);
            if (tower == null) continue;
            catalog.Towers.Add(new CatalogTowerDto
            {
                Id = id, Name = id, BaseCost = tower.cost, Cost = bridge.GetTowerCost(tower, input), Range = tower.range,
                IsHero = tower.IsHero(), Unlocked = player == null ? null : Unlocked(player, tower, id), InInventory = bridge.HasTowerInventory(tower, input),
            });
        }
        return catalog;
    }
}
