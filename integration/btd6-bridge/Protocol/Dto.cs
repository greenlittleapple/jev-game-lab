using System;
using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace JevBtd6Bridge.Protocol;

// The JSON the bridge serves (api 1). integration/btd6/state.mjs reads the state shape.
// No game types here, so the protocol builds and is tested without the game.

public sealed class BridgeStateDto
{
    [JsonPropertyName("api")] public int Api { get; set; } = BridgeJson.ApiVersion;
    [JsonPropertyName("bridge_version")] public string BridgeVersion { get; set; } = "";
    [JsonPropertyName("game_version")] public string? GameVersion { get; set; }
    // "in_game" during a match, otherwise "menu".
    [JsonPropertyName("screen")] public string Screen { get; set; } = "menu";
    // The main menu is the current screen: the only place start_match is accepted.
    [JsonPropertyName("main_menu")] public bool MainMenu { get; set; }
    // A match is loading (UI.isLoadingGame).
    [JsonPropertyName("loading")] public bool Loading { get; set; }
    // True when a command can be acted on now: in a match, not paused, no queued game actions, no result yet.
    [JsonPropertyName("ready")] public bool Ready { get; set; }
    [JsonPropertyName("paused")] public bool? Paused { get; set; }
    [JsonPropertyName("fast_forward")] public bool? FastForward { get; set; }
    // The fast-forward time scale (bridge 0.3.4): 3 is the game's own; set_speed can change it.
    [JsonPropertyName("multiplier")] public double? Multiplier { get; set; }
    [JsonPropertyName("auto_start")] public bool? AutoStart { get; set; }
    [JsonPropertyName("pending_actions")] public int? PendingActions { get; set; }
    [JsonPropertyName("match")] public MatchDto? Match { get; set; }
    [JsonPropertyName("round")] public RoundDto? Round { get; set; }
    [JsonPropertyName("cash")] public double? Cash { get; set; }
    [JsonPropertyName("lives")] public double? Lives { get; set; }
    // The lives the match started with (UnityToSimulation.GetStartingHealth); percentages use this.
    [JsonPropertyName("starting_lives")] public double? StartingLives { get; set; }
    // The cap on lives (Mod Helper's GetMaxHealth), 5000 on Medium; not the starting lives.
    [JsonPropertyName("max_lives")] public double? MaxLives { get; set; }
    [JsonPropertyName("towers")] public List<TowerDto> Towers { get; set; } = new();
    // Bloons on the track, summarised (BloonSummary.cs); null outside a match.
    [JsonPropertyName("bloons")] public BloonsDto? Bloons { get; set; }
    [JsonPropertyName("towers_hash")] public string? TowersHash { get; set; }
    // How many towers other towers made (Engineer sentries, Comanches, phoenixes, hero summons). They are
    // left out of towers and towers_hash, so they never churn the hash or become command targets.
    [JsonPropertyName("sub_towers")] public int? SubTowers { get; set; }
    // Every tower, upgrade, hero, map and single-player mode is available regardless of the account's
    // own unlocks (Unlocks.cs). False when the account's own unlocks apply.
    [JsonPropertyName("unlock_all")] public bool UnlockAll { get; set; }
    // A screen open over the match (rank-up, tower pick, victory, defeat) or over the main menu (daily
    // rewards, update notice), an unknown one, or null.
    [JsonPropertyName("popup")] public PopupDto? Popup { get; set; }
    // MenuManager.GetCurrentMenuName(), for diagnosing screens the bridge doesn't know.
    [JsonPropertyName("menu")] public string? Menu { get; set; }
    // The active Unity scene, for diagnosing screens before the menus exist.
    [JsonPropertyName("scene")] public string? Scene { get; set; }
    [JsonPropertyName("observed_at")] public string ObservedAt { get; set; } = "";
}

public sealed class MatchDto
{
    // Assigned by the bridge when a match starts or restarts.
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("map")] public string? Map { get; set; }
    [JsonPropertyName("mode")] public string? Mode { get; set; }
    [JsonPropertyName("difficulty")] public string? Difficulty { get; set; }
    [JsonPropertyName("game_type")] public string? GameType { get; set; }
    [JsonPropertyName("coop")] public bool Coop { get; set; }
    [JsonPropertyName("sandbox")] public bool Sandbox { get; set; }
    // Raw values from the game's model; the first spike checks how they map to displayed rounds.
    [JsonPropertyName("model_start_round")] public int? ModelStartRound { get; set; }
    [JsonPropertyName("model_end_round")] public int? ModelEndRound { get; set; }
    [JsonPropertyName("end_round_index")] public int? EndRoundIndex { get; set; }
    // null while playing, then "victory" or "defeat".
    [JsonPropertyName("result")] public string? Result { get; set; }
    [JsonPropertyName("double_cash_used")] public bool? DoubleCashUsed { get; set; }
    // Mod Helper's checks: the account is already flagged; the game is in a mode it lists as a flag risk
    // (race, public co-op, Odyssey). Commands are refused in a flag-risk mode.
    [JsonPropertyName("account_flagged")] public bool? AccountFlagged { get; set; }
    [JsonPropertyName("flag_risk_mode")] public bool? FlagRiskMode { get; set; }
}

public sealed class RoundDto
{
    // UnityToSimulation.GetCurrentRound(); the runner shows index + 1.
    [JsonPropertyName("index")] public int Index { get; set; }
    [JsonPropertyName("active")] public bool Active { get; set; }
    [JsonPropertyName("before_first_wave")] public bool BeforeFirstWave { get; set; }
    // Lives lost since this round started (RoundLives in BloonSummary.cs).
    [JsonPropertyName("lives_lost")] public double? LivesLost { get; set; }
}

public sealed class TowerDto
{
    // ObjectId.Raw; commands name towers by this value.
    [JsonPropertyName("id")] public uint Id { get; set; }
    [JsonPropertyName("base_id")] public string BaseId { get; set; } = "";
    [JsonPropertyName("name")] public string? Name { get; set; }
    [JsonPropertyName("tiers")] public int[] Tiers { get; set; } = new int[3];
    // Simulation coordinates, the same ones place_tower takes.
    [JsonPropertyName("x")] public double X { get; set; }
    [JsonPropertyName("y")] public double Y { get; set; }
    [JsonPropertyName("targeting")] public string? Targeting { get; set; }
    // 0.3.12: the target types the tower offers (TowerModel.targetTypes, in the game's cycling order), and the
    // point its current target type aims at (a Mortar's reticle, a Dartling's Locked point, a Heli's Lock In
    // Place position), or null when that type has no point or none is set.
    [JsonPropertyName("target_modes")] public List<string> TargetModes { get; set; } = new();
    [JsonPropertyName("target_point")] public TargetPointDto? TargetPoint { get; set; }
    [JsonPropertyName("is_hero")] public bool IsHero { get; set; }
    [JsonPropertyName("is_paragon")] public bool IsParagon { get; set; }
    [JsonPropertyName("created_on_round")] public int? CreatedOnRound { get; set; }
    [JsonPropertyName("worth")] public double? Worth { get; set; }
    // 0.3.13: the pop count the upgrade panel shows (TowerToSimulation.damageDealt, a long) and the cash the tower has
    // earned (TowerToSimulation.cashEarned, a float, rounded), both over the tower's life. Sub-towers aren't listed; those
    // with the game's CreditPopsToParentTower behavior likely add their pops to the parent's count (by the name; unverified).
    [JsonPropertyName("pops")] public long? Pops { get; set; }
    [JsonPropertyName("cash_earned")] public long? CashEarned { get; set; }
    [JsonPropertyName("next_upgrades")] public List<UpgradeDto> NextUpgrades { get; set; } = new();
}

public sealed class TargetPointDto
{
    [JsonPropertyName("x")] public double X { get; set; }
    [JsonPropertyName("y")] public double Y { get; set; }
}

public sealed class UpgradeDto
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    // The game's 0-based path, and the tier (1-5) the upgrade reaches.
    [JsonPropertyName("path")] public int Path { get; set; }
    [JsonPropertyName("tier")] public int Tier { get; set; }
    // The price the upgrade button shows (TowerToSimulation.GetUpgradeCost).
    [JsonPropertyName("cost")] public int Cost { get; set; }
    [JsonPropertyName("unlocked")] public bool? Unlocked { get; set; }
}

public sealed class CommandResultDto
{
    [JsonPropertyName("command_id")] public string CommandId { get; set; } = "";
    [JsonPropertyName("action")] public string Action { get; set; } = "";
    // queued (received, not finished), executed, rejected (checked and refused, nothing changed) or failed.
    [JsonPropertyName("status")] public string Status { get; set; } = "queued";
    [JsonPropertyName("reason")] public string? Reason { get; set; }
    [JsonPropertyName("tower_id")] public uint? TowerId { get; set; }
    // What an executed command did beyond its action, such as the tower picked at a rank-up.
    [JsonPropertyName("detail")] public string? Detail { get; set; }
    [JsonPropertyName("towers_hash")] public string? TowersHash { get; set; }
    [JsonPropertyName("received_at")] public string ReceivedAt { get; set; } = "";
    [JsonPropertyName("finished_at")] public string? FinishedAt { get; set; }
}

public sealed class PopupDto
{
    // level_up, xp_notice, tower_unlock_choice, victory, defeat (over a match), daily_rewards,
    // update_notice, store_ad (over the main menu), mode_rules_notice, tutorial_notice, hero_unlock_notice, tower_unlock_notice (over a match), title_screen, modded_client_notice (startup) or unknown.
    [JsonPropertyName("kind")] public string Kind { get; set; } = "unknown";
    // "match" while a match is open, "startup" for the title screen and the Modded Client notice,
    // otherwise "menu".
    [JsonPropertyName("scope")] public string Scope { get; set; } = "match";
    // "menu" (a game menu) or "popup" (a dialog from PopupScreen).
    [JsonPropertyName("source")] public string Source { get; set; } = "menu";
    [JsonPropertyName("class")] public string? Class { get; set; }
    [JsonPropertyName("full_class")] public string? FullClass { get; set; }
    [JsonPropertyName("menu_name")] public string? MenuName { get; set; }
    // Visible title and body text, shortened, for identifying unknown screens (not read on the title
    // screen, which shows the player ID).
    [JsonPropertyName("title")] public string? Title { get; set; }
    [JsonPropertyName("text")] public string? Text { get; set; }
    [JsonPropertyName("buttons")] public List<PopupButtonDto> Buttons { get; set; } = new();
    // For a tower pick: the towers offered, in order.
    [JsonPropertyName("options")] public List<string> Options { get; set; } = new();
}

public sealed class PopupButtonDto
{
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("interactable")] public bool Interactable { get; set; }
    // The button's visible label, shortened.
    [JsonPropertyName("label")] public string? Label { get; set; }
}

public sealed class MapDto
{
    [JsonPropertyName("map")] public string? Map { get; set; }
    [JsonPropertyName("paths")] public List<PathDto> Paths { get; set; } = new();
}

public sealed class PathDto
{
    [JsonPropertyName("id")] public string? Id { get; set; }
    [JsonPropertyName("active")] public bool Active { get; set; }
    [JsonPropertyName("points")] public List<double[]> Points { get; set; } = new();
}

public sealed class PlacementDto
{
    [JsonPropertyName("tower")] public string Tower { get; set; } = "";
    [JsonPropertyName("results")] public List<PlacementResultDto> Results { get; set; } = new();
}

public sealed class PlacementResultDto
{
    [JsonPropertyName("x")] public double X { get; set; }
    [JsonPropertyName("y")] public double Y { get; set; }
    [JsonPropertyName("valid")] public bool Valid { get; set; }
}

public sealed class CatalogDto
{
    [JsonPropertyName("towers")] public List<CatalogTowerDto> Towers { get; set; } = new();
}

public sealed class CatalogTowerDto
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("name")] public string? Name { get; set; }
    [JsonPropertyName("base_cost")] public double BaseCost { get; set; }
    // What the game would charge now, from UnityToSimulation.GetTowerCost.
    [JsonPropertyName("cost")] public double Cost { get; set; }
    [JsonPropertyName("range")] public double Range { get; set; }
    [JsonPropertyName("is_hero")] public bool IsHero { get; set; }
    [JsonPropertyName("unlocked")] public bool? Unlocked { get; set; }
    // The mode allows placing it (UnityToSimulation.HasTowerInventory); CHIMPS, for one, locks the Banana Farm.
    [JsonPropertyName("in_inventory")] public bool? InInventory { get; set; }
}

public sealed class ErrorDto
{
    [JsonPropertyName("error")] public string Error { get; set; } = "";
}

// GET / and GET /api/v1/health, answered without touching the game.
public sealed class HealthDto
{
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("version")] public string Version { get; set; } = "";
    [JsonPropertyName("api")] public int Api { get; set; } = BridgeJson.ApiVersion;
    // False when no frame ran for 2 s (an unfocused game that doesn't run in the background, or a
    // loading screen); game requests then time out.
    [JsonPropertyName("main_thread_pumping")] public bool MainThreadPumping { get; set; }
    [JsonPropertyName("ms_since_frame")] public long MsSinceFrame { get; set; }
    [JsonPropertyName("frames")] public long Frames { get; set; }
    [JsonPropertyName("run_in_background")] public bool RunInBackground { get; set; }
    // As in /state (Unlocks.cs).
    [JsonPropertyName("unlock_all")] public bool UnlockAll { get; set; }
    // Optional fields from Unlocks.Details(), written at the top level; null when there are none.
    [JsonExtensionData] public Dictionary<string, object>? Extra { get; set; }
    // The Mod Helper that is loaded; the runner compares it with its pin (integration/btd6/pins.mjs).
    [JsonPropertyName("mod_helper")] public ModHelperDto? ModHelper { get; set; }
}

public sealed class ModHelperDto
{
    [JsonPropertyName("name")] public string? Name { get; set; }
    [JsonPropertyName("version")] public string? Version { get; set; }
    // SHA-256 of the loaded DLL file, lowercase hex, and the file's name (no folder).
    [JsonPropertyName("sha256")] public string? Sha256 { get; set; }
    [JsonPropertyName("file")] public string? File { get; set; }
    [JsonPropertyName("error")] public string? Error { get; set; }
}

// GET /api/v1/profile: the account's saved profile fields, read directly (not through the game's unlock
// checks). IDs are sorted; XP values are the game's own numbers.
public sealed class ProfileDto
{
    [JsonPropertyName("api")] public int Api { get; set; } = BridgeJson.ApiVersion;
    [JsonPropertyName("bridge_version")] public string BridgeVersion { get; set; } = "";
    [JsonPropertyName("observed_at")] public string ObservedAt { get; set; } = "";
    [JsonPropertyName("unlock_all")] public bool UnlockAll { get; set; }
    // Optional fields from Unlocks.Details(), as in /health.
    [JsonExtensionData] public Dictionary<string, object>? Extra { get; set; }
    [JsonPropertyName("unlocked_towers")] public List<string> UnlockedTowers { get; set; } = new();
    [JsonPropertyName("unlocked_heroes")] public List<string> UnlockedHeroes { get; set; } = new();
    [JsonPropertyName("acquired_upgrades")] public List<string> AcquiredUpgrades { get; set; } = new();
    [JsonPropertyName("acquired_knowledge")] public List<string> AcquiredKnowledge { get; set; } = new();
    // Unspent Monkey Knowledge points.
    [JsonPropertyName("knowledge_points")] public long? KnowledgePoints { get; set; }
    [JsonPropertyName("rank")] public long? Rank { get; set; }
    [JsonPropertyName("xp")] public double? Xp { get; set; }
    [JsonPropertyName("veteran_rank")] public long? VeteranRank { get; set; }
    [JsonPropertyName("veteran_xp")] public double? VeteranXp { get; set; }
    [JsonPropertyName("tower_xp")] public SortedDictionary<string, double?> TowerXp { get; set; } = new(StringComparer.Ordinal);
}
