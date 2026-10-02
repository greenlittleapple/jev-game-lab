using Il2CppAssets.Scripts.Data;
using Il2CppAssets.Scripts.Models;
using Il2CppAssets.Scripts.Models.Profile;
using Il2CppAssets.Scripts.Unity;
using Il2CppAssets.Scripts.Unity.Menu;
using Il2CppAssets.Scripts.Unity.UI_New.GameOver;
using Il2CppAssets.Scripts.Unity.UI_New.InGame;
using Il2CppAssets.Scripts.Unity.UI_New.Main;
using Il2CppAssets.Scripts.Unity.UI_New.Popups;
using JevBtd6Bridge.Protocol;

namespace JevBtd6Bridge;

// Entering and leaving matches through the game's own calls, on the main thread.
// start_match loads a single-player match the way the mode screen does: a fresh InGameData set up
// with the map, difficulty and mode, then UI.LoadGame. It runs only on the main menu with nothing open
// over it, for the setups CommandParser.StartSetups allows. It reads the profile (the selected hero and
// saved games) and never writes it: a different selected hero or a saved game on the map is refused
// for the operator to settle in the game, since starting over a save would overwrite it. With
// replace_saved, a saved game is replaced the way the mode screen does after its overwrite prompt:
// the new game is loaded with UI.LoadGame's wasSaveOverwritten flag set, and the old save's summary is
// logged and returned.
// go_home leaves a match through InGame.QuitToMainMenu, or presses Home on a victory or defeat screen
// (SummaryScreen.HomeClicked).
internal static class MatchFlow
{
    public static CommandResultDto Start(BridgeCommand command, CommandLedger ledger)
    {
        var inGame = InGame.instance;
        if (inGame && !inGame.quitting) return Reject(command, ledger, "in_match");
        var ui = Il2CppAssets.Scripts.Unity.UI_New.UI.instance;
        if (ui == null) return Reject(command, ledger, "ui_not_ready");
        if (ui.isLoadingGame) return Reject(command, ledger, "loading");
        var open = Popups.Read();
        if (open?.Scope == "startup") return Reject(command, ledger, "startup_screen", $"{open.Kind} ({open.Class}); step past it with dismiss_popup");
        var menus = MenuManager.instance;
        var menu = menus == null ? null : menus.GetCurrentMenu();
        if (menu == null || menu.TryCast<MainMenu>() == null) return Reject(command, ledger, "not_on_main_menu", menus == null ? null : menus.GetCurrentMenuName());
        var popups = PopupScreen.instance;
        if ((popups != null && popups.IsPopupActiveOrLoading()) || open != null)
            return Reject(command, ledger, "popup_open", open?.Class);

        var map = command.Map!;
        if (!GameData.Instance.mapSet.TryGetMapDetails(map, out var details) || details == null || details.isDebug || details.isBrowserOnly)
            return Reject(command, ledger, "unknown_map");
        var player = Game.Player;
        if (player == null) return Reject(command, ledger, "no_player");
        if (!player.IsMapUnlocked(map)) return Reject(command, ledger, "map_locked");
        if (!player.IsModeUnlocked(map, command.Difficulty, command.Mode, false)) return Reject(command, ledger, "mode_locked");
        var profile = player.Data;
        var selected = profile?.primaryHero;
        if (selected != command.Hero)
            return Reject(command, ledger, "hero_mismatch", $"the selected hero is {selected ?? "none"}; select {command.Hero} in the Heroes menu");
        if (!player.HasUnlockedHero(command.Hero, false)) return Reject(command, ledger, "hero_locked");
        var saved = SavedGame(profile, map);
        if (saved != null && !command.ReplaceSaved) return Reject(command, ledger, "saved_game_exists", saved + "; continue or replace it in the game, or start with replace_saved");

        InGameData.CreateNewInstance();
        var data = InGameData.Editable;
        data.SetupNormalGame(map);
        data.selectedMap = map;
        data.selectedDifficulty = command.Difficulty;
        data.selectedMode = command.Mode;
        data.selectedMapDifficulty = details.difficulty;
        data.selectedCoopMode = false;
        data.selectedCouchMode = false;
        if (data.gameType != GameType.Standard) return Reject(command, ledger, "not_a_standard_game");
        // Whatever the bridge saw before is over: the match this loads gets a new ID.
        MatchTracker.EndMatch();
        ui.LoadGame(null, null, null, false, saved != null);
        var what = $"loading {map} {command.Difficulty} {command.Mode} with {command.Hero}" + (saved != null ? $", replacing {saved}" : "");
        Log.Msg($"start_match {command.CommandId}: {what}");
        return ledger.Complete(command.CommandId, "executed", detail: what);
    }

    public static CommandResultDto GoHome(BridgeCommand command, CommandLedger ledger)
    {
        var inGame = InGame.instance;
        if (!inGame || inGame.quitting) return Reject(command, ledger, "not_in_match");
        if (inGame.IsCoop) return Reject(command, ledger, "coop_match");
        if (command.ExpectMatchId != MatchTracker.Current()) return Reject(command, ledger, "stale_match");
        var open = Popups.Read();
        if (open != null && (open.Kind == "victory" || open.Kind == "defeat"))
        {
            var summary = MenuManager.instance.GetCurrentMenu()?.TryCast<SummaryScreen>();
            if (summary == null) return Reject(command, ledger, "popup_kind_mismatch");
            summary.HomeClicked();
            Log.Msg($"go_home {command.CommandId}: Home on the {open.Kind} screen");
            return ledger.Complete(command.CommandId, "executed", detail: $"Home on the {open.Kind} screen");
        }
        if (open != null) return Reject(command, ledger, "popup_open", open.Class);
        if (inGame.disableHomeButton) return Reject(command, ledger, "home_disabled");
        inGame.QuitToMainMenu();
        Log.Msg($"go_home {command.CommandId}: quit to the main menu");
        return ledger.Complete(command.CommandId, "executed", detail: "quit to the main menu");
    }

    // A saved game on the map (the game keeps one per map), described for the operator, or null.
    private static string? SavedGame(ProfileModel? profile, string map)
    {
        var saves = profile?.savedMaps;
        if (saves == null) return null;
        foreach (var entry in saves)
        {
            var save = entry.Value;
            if (save != null && (save.mapName == map || entry.Key == map))
                return $"a saved game on {map} ({save.mapDifficulty} {save.modeName}, round index {save.round})";
        }
        return null;
    }

    private static CommandResultDto Reject(BridgeCommand command, CommandLedger ledger, string reason, string? detail = null) =>
        ledger.Complete(command.CommandId, "rejected", reason, detail: detail);
}
