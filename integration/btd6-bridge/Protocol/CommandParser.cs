using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace JevBtd6Bridge.Protocol;

public sealed class BridgeCommand
{
    public string CommandId { get; init; } = "";
    public string Action { get; init; } = "";
    // What the runner saw when it decided; checked on the game thread before acting. Null where the
    // action has no match: start_match, and a screen over the main menu.
    public string? ExpectMatchId { get; init; }
    public string? ExpectTowersHash { get; init; }
    // upgrade_tower (0.3.13, optional): the tower's tiers as the runner saw them (a hero's level is the first), so a
    // hero that levelled up since isn't upgraded at a different level and price. Refused with stale_tiers.
    public int[]? ExpectTiers { get; init; }
    public string? Tower { get; init; }
    public double X { get; init; }
    public double Y { get; init; }
    public uint TowerId { get; init; }
    // The game's 0-based upgrade path.
    public int Path { get; init; }
    // dismiss_popup: the kind of screen, the button to press, and the screen class the runner saw.
    public string? Popup { get; init; }
    public string? Button { get; init; }
    public string? ExpectPopupClass { get; init; }
    // start_match: the map ID (Monkey Meadow is "Tutorial"), difficulty, mode ID (CHIMPS is "Clicks")
    // and the hero the profile must have selected.
    public string? Map { get; init; }
    public string? Difficulty { get; init; }
    public string? Mode { get; init; }
    public string? Hero { get; init; }
    // start_match: replace the game's saved game on the map (off unless asked for).
    public bool ReplaceSaved { get; init; }
    // set_speed: fast-forward on or off, and the fast-forward time scale (null: the game's default, 3).
    public bool FastForward { get; init; }
    public double? Multiplier { get; init; }
    // set_auto_start (0.3.11): the match's auto-start setting, on or off.
    public bool Enabled { get; init; }
    // set_targeting (0.3.12): the target type ID to switch to, one of the tower's own (the state's
    // target_modes), e.g. First, Strong, Locked, Pursuit. set_target_point uses X and Y.
    public string? TargetMode { get; init; }
}

public static class CommandParser
{
    public static readonly string[] Actions = { "place_tower", "upgrade_tower", "start_round", "dismiss_popup", "start_match", "go_home", "set_speed", "set_auto_start", "set_targeting", "set_target_point" };
    // Screens over a match, and screens over the main menu (which need no match).
    public static readonly string[] MatchPopupKinds = { "level_up", "xp_notice", "tower_unlock_choice", "victory", "defeat", "mode_rules_notice", "tutorial_notice", "hero_unlock_notice", "tower_unlock_notice" };
    // Startup screens (title screen, Modded Client notice) are counted with them.
    public static readonly string[] MenuPopupKinds = { "daily_rewards", "update_notice", "title_screen", "modded_client_notice", "store_ad" };
    public static readonly string[] PopupKinds = MatchPopupKinds.Concat(MenuPopupKinds).ToArray();
    public static readonly string[] PopupButtons = { "continue", "pick_first", "home", "restart", "back", "ok", "start", "close" };
    // The single-player setups start_match loads, as (mode, difficulty). Co-op, races, boss events,
    // Odyssey, Contested Territory and daily challenges are other game types, which it never sets up.
    public static readonly (string Mode, string Difficulty)[] StartSetups =
        { ("Standard", "Easy"), ("Standard", "Medium"), ("Standard", "Hard"), ("Impoppable", "Hard"), ("Clicks", "Hard") };
    // The ruleset's hero (integration/btd6/rulesets.mjs).
    public const string DefaultHero = "Quincy";
    private static readonly Regex ClassPattern = new("^[A-Za-z0-9_]{1,80}$");
    private static readonly Regex CommandIdPattern = new("^[A-Za-z0-9-]{8,64}$");
    private static readonly Regex IdPattern = new("^[A-Za-z0-9]{1,40}$");
    private const double MaxCoordinate = 10000;
    // set_speed: the fast-forward time scale it may set. The game's own fast-forward is 3.
    public const double MinMultiplier = 1, MaxMultiplier = 10;

    // Returns the command, or null with an error message.
    public static BridgeCommand? Parse(string body, out string? error)
    {
        error = null;
        try
        {
            using var doc = JsonDocument.Parse(body);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return Fail("The body must be a JSON object", out error);
            var id = Text(root, "command_id");
            if (id == null || !CommandIdPattern.IsMatch(id)) return Fail("command_id must be 8 to 64 letters, digits or hyphens", out error);
            var action = Text(root, "action");
            if (action == null || Array.IndexOf(Actions, action) < 0) return Fail("action must be one of " + string.Join(", ", Actions), out error);
            // Accepted only on the main menu, so there is no match to expect.
            if (action == "start_match") return StartMatch(root, id, out error);
            if (!root.TryGetProperty("expect", out var expect) || expect.ValueKind != JsonValueKind.Object) return Fail("expect is required", out error);
            var matchId = Text(expect, "match_id");

            if (action == "dismiss_popup")
            {
                var popup = Text(root, "popup");
                if (popup == null || Array.IndexOf(PopupKinds, popup) < 0) return Fail("popup must be one of " + string.Join(", ", PopupKinds), out error);
                var button = Text(root, "button");
                if (button == null || Array.IndexOf(PopupButtons, button) < 0) return Fail("button must be one of " + string.Join(", ", PopupButtons), out error);
                var popupClass = Text(expect, "popup_class");
                if (popupClass == null || !ClassPattern.IsMatch(popupClass)) return Fail("expect.popup_class must name the screen class the state reported", out error);
                var overMatch = Array.IndexOf(MatchPopupKinds, popup) >= 0;
                if (overMatch && string.IsNullOrEmpty(matchId)) return Fail("expect.match_id is required for a screen over a match", out error);
                return new BridgeCommand { CommandId = id, Action = action, ExpectMatchId = overMatch ? matchId : null, Popup = popup, Button = button, ExpectPopupClass = popupClass };
            }
            if (string.IsNullOrEmpty(matchId)) return Fail("expect.match_id is required", out error);
            if (action == "go_home") return new BridgeCommand { CommandId = id, Action = action, ExpectMatchId = matchId };
            // {"fast_forward": true, "multiplier": 5}; without a multiplier the time scale returns to the game's default.
            if (action == "set_speed")
            {
                if (!root.TryGetProperty("fast_forward", out var ff) || (ff.ValueKind != JsonValueKind.True && ff.ValueKind != JsonValueKind.False))
                    return Fail("fast_forward must be true or false", out error);
                double? multiplier = null;
                if (root.TryGetProperty("multiplier", out var m) && m.ValueKind != JsonValueKind.Null)
                {
                    if (m.ValueKind != JsonValueKind.Number || !m.TryGetDouble(out var value) || !double.IsFinite(value) || value < MinMultiplier || value > MaxMultiplier)
                        return Fail($"multiplier must be a number from {MinMultiplier} to {MaxMultiplier}", out error);
                    multiplier = value;
                }
                return new BridgeCommand { CommandId = id, Action = action, ExpectMatchId = matchId, FastForward = ff.GetBoolean(), Multiplier = multiplier };
            }

            // {"enabled": false}: the match's auto-start setting.
            if (action == "set_auto_start")
            {
                if (!root.TryGetProperty("enabled", out var on) || (on.ValueKind != JsonValueKind.True && on.ValueKind != JsonValueKind.False))
                    return Fail("enabled must be true or false", out error);
                return new BridgeCommand { CommandId = id, Action = action, ExpectMatchId = matchId, Enabled = on.GetBoolean() };
            }

            // place_tower, upgrade_tower and start_round act on the match's towers as the runner saw them.
            if (!expect.TryGetProperty("towers_hash", out var hash) || (hash.ValueKind != JsonValueKind.String && hash.ValueKind != JsonValueKind.Null))
                return Fail("expect.towers_hash must be a string or null", out error);
            var towersHash = hash.ValueKind == JsonValueKind.String ? hash.GetString() : null;
            switch (action)
            {
                case "place_tower":
                {
                    var tower = Text(root, "tower");
                    if (tower == null || !IdPattern.IsMatch(tower)) return Fail("tower must be a tower ID such as DartMonkey", out error);
                    if (!Coordinate(root, "x", out var x) || !Coordinate(root, "y", out var y)) return Fail("x and y must be numbers within ±10000", out error);
                    return new BridgeCommand { CommandId = id, Action = action, ExpectMatchId = matchId, ExpectTowersHash = towersHash, Tower = tower, X = x, Y = y };
                }
                case "upgrade_tower":
                {
                    if (!root.TryGetProperty("tower_id", out var t) || t.ValueKind != JsonValueKind.Number || !t.TryGetUInt32(out var towerId))
                        return Fail("tower_id must be a tower ID from the state", out error);
                    if (!root.TryGetProperty("path", out var p) || p.ValueKind != JsonValueKind.Number || !p.TryGetInt32(out var path) || path < 0 || path > 2)
                        return Fail("path must be 0, 1 or 2", out error);
                    int[]? tiers = null;
                    if (expect.TryGetProperty("tiers", out var tl) && tl.ValueKind != JsonValueKind.Null)
                    {
                        if (tl.ValueKind != JsonValueKind.Array || tl.GetArrayLength() != 3) return Fail("expect.tiers must be three integers", out error);
                        tiers = new int[3];
                        var n = 0;
                        foreach (var e in tl.EnumerateArray())
                        {
                            if (e.ValueKind != JsonValueKind.Number || !e.TryGetInt32(out var v) || v < 0 || v > 100) return Fail("expect.tiers must be three integers", out error);
                            tiers[n++] = v;
                        }
                    }
                    return new BridgeCommand { CommandId = id, Action = action, ExpectMatchId = matchId, ExpectTowersHash = towersHash, TowerId = towerId, Path = path, ExpectTiers = tiers };
                }
                // {"tower_id": 7, "mode": "Locked"}: the tower's target type, as the targeting buttons set it.
                case "set_targeting":
                {
                    if (!TowerIdOf(root, out var towerId)) return Fail("tower_id must be a tower ID from the state", out error);
                    var mode = Text(root, "mode");
                    if (mode == null || !IdPattern.IsMatch(mode)) return Fail("mode must be a target type ID such as First or Locked", out error);
                    return new BridgeCommand { CommandId = id, Action = action, ExpectMatchId = matchId, ExpectTowersHash = towersHash, TowerId = towerId, TargetMode = mode };
                }
                // {"tower_id": 7, "x": -20, "y": 14}: the point for the tower's current target type (a Mortar's
                // reticle, a Dartling's Locked point, a Heli's Lock In Place position), in map coordinates.
                case "set_target_point":
                {
                    if (!TowerIdOf(root, out var towerId)) return Fail("tower_id must be a tower ID from the state", out error);
                    if (!Coordinate(root, "x", out var x) || !Coordinate(root, "y", out var y)) return Fail("x and y must be numbers within ±10000", out error);
                    return new BridgeCommand { CommandId = id, Action = action, ExpectMatchId = matchId, ExpectTowersHash = towersHash, TowerId = towerId, X = x, Y = y };
                }
                default:
                    return new BridgeCommand { CommandId = id, Action = action, ExpectMatchId = matchId, ExpectTowersHash = towersHash };
            }
        }
        catch (JsonException) { return Fail("The body is not valid JSON", out error); }
    }

    // {"map": "Tutorial", "difficulty": "Hard", "mode": "Clicks", "hero": "Quincy"}; hero is optional.
    private static BridgeCommand? StartMatch(JsonElement root, string id, out string? error)
    {
        error = null;
        var map = Text(root, "map");
        if (map == null || !IdPattern.IsMatch(map)) return Fail("map must be a map ID such as Tutorial (Monkey Meadow)", out error);
        var difficulty = Text(root, "difficulty");
        var mode = Text(root, "mode");
        if (difficulty == null || mode == null || !StartSetups.Any(s => s.Mode == mode && s.Difficulty == difficulty))
            return Fail("mode and difficulty must be one of " + string.Join(", ", StartSetups.Select(s => $"{s.Mode} {s.Difficulty}")) + " (Clicks is CHIMPS)", out error);
        var hero = DefaultHero;
        if (root.TryGetProperty("hero", out var h) && h.ValueKind != JsonValueKind.Null)
        {
            var named = h.ValueKind == JsonValueKind.String ? h.GetString() : null;
            if (named == null || !IdPattern.IsMatch(named)) return Fail("hero must be a hero ID such as Quincy", out error);
            hero = named;
        }
        var replace = false;
        if (root.TryGetProperty("replace_saved", out var r))
        {
            if (r.ValueKind != JsonValueKind.True && r.ValueKind != JsonValueKind.False) return Fail("replace_saved must be true or false", out error);
            replace = r.GetBoolean();
        }
        return new BridgeCommand { CommandId = id, Action = "start_match", Map = map, Difficulty = difficulty, Mode = mode, Hero = hero, ReplaceSaved = replace };
    }

    // {"tower": "DartMonkey", "points": [[x, y], ...]} with at most BridgeJson.MaxPlacementPoints points.
    public static (string Tower, List<(double X, double Y)> Points)? ParsePlacement(string body, out string? error)
    {
        error = null;
        try
        {
            using var doc = JsonDocument.Parse(body);
            var root = doc.RootElement;
            var tower = root.ValueKind == JsonValueKind.Object ? Text(root, "tower") : null;
            if (tower == null || !IdPattern.IsMatch(tower)) { error = "tower must be a tower ID such as DartMonkey"; return null; }
            if (!root.TryGetProperty("points", out var points) || points.ValueKind != JsonValueKind.Array || points.GetArrayLength() > BridgeJson.MaxPlacementPoints)
            { error = $"points must be an array of at most {BridgeJson.MaxPlacementPoints} [x, y] pairs"; return null; }
            var list = new List<(double, double)>();
            foreach (var point in points.EnumerateArray())
            {
                if (point.ValueKind != JsonValueKind.Array || point.GetArrayLength() != 2
                    || !point[0].TryGetDouble(out var x) || !point[1].TryGetDouble(out var y)
                    || !double.IsFinite(x) || !double.IsFinite(y) || Math.Abs(x) > MaxCoordinate || Math.Abs(y) > MaxCoordinate)
                { error = "each point must be [x, y] with numbers within ±10000"; return null; }
                list.Add((x, y));
            }
            return (tower, list);
        }
        catch (JsonException) { error = "The body is not valid JSON"; return null; }
    }

    private static bool TowerIdOf(JsonElement root, out uint towerId)
    {
        towerId = 0;
        return root.TryGetProperty("tower_id", out var t) && t.ValueKind == JsonValueKind.Number && t.TryGetUInt32(out towerId);
    }

    // GET /api/v1/screenshot?width=N (0.3.12): the PNG's width, DefaultShotWidth without one; null with an
    // error when it isn't a whole number from MinShotWidth to MaxShotWidth.
    public const int DefaultShotWidth = 960, MinShotWidth = 64, MaxShotWidth = 1920;
    public static int? ParseShotWidth(string? query, out string? error)
    {
        error = null;
        string? raw = null;
        foreach (var part in (query ?? "").TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var eq = part.IndexOf('=');
            var key = eq < 0 ? part : part.Substring(0, eq);
            if (key == "width") raw = eq < 0 ? "" : Uri.UnescapeDataString(part.Substring(eq + 1));
        }
        if (raw == null) return DefaultShotWidth;
        if (!int.TryParse(raw, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out var width) || width < MinShotWidth || width > MaxShotWidth)
        { error = $"width must be a whole number from {MinShotWidth} to {MaxShotWidth}"; return null; }
        return width;
    }

    private static string? Text(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static bool Coordinate(JsonElement obj, string name, out double value)
    {
        value = 0;
        return obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetDouble(out value)
            && double.IsFinite(value) && Math.Abs(value) <= MaxCoordinate;
    }

    private static BridgeCommand? Fail(string message, out string? error) { error = message; return null; }
}
