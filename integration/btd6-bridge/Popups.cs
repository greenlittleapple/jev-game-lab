using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using Il2CppAssets.Scripts.Unity.Scenes;
using Il2CppAssets.Scripts.Unity.Menu;
using Il2CppAssets.Scripts.Unity.UI_New.GameOver;
using Il2CppAssets.Scripts.Unity.UI_New.InGame;
using Il2CppAssets.Scripts.Unity.UI_New.LevelUp;
using Il2CppAssets.Scripts.Unity.UI_New.Main.DailyRewards;
using Il2CppAssets.Scripts.Unity.UI_New.Main.HeroSelect;
using Il2CppAssets.Scripts.Unity.UI_New.Main.UpdateScreen;
using Il2CppAssets.Scripts.Unity.UI_New.Popups;
using JevBtd6Bridge.Protocol;
using UnityEngine;
using UnityEngine.UI;

namespace JevBtd6Bridge;

// Screens that stop play or block the main menu. Over a match: rank-up notices, the free hero and
// tower unlock splashes (Protocol/UnlockSplashKinds.cs), the tower pick, and the victory and defeat screens. Over the main menu: the daily rewards screen, the update notice and store ads (store_ad, closed only).
// At startup (scope "startup"): the title screen (Start) and the game's Modded Client notice
// (ModdingPopup, Continue).
// The state reports whichever is open; dismiss_popup presses one allowlisted button through the
// screen's own handler. Anything else is reported as "unknown" and never dismissed.
// Never used: Continue or Retry Last Round for Monkey Money (DefeatScreen.ContinueClick,
// RetryForMMClicked, SummaryScreen.RetryLastRound), Freeplay (VictoryScreen.FreeplayClick), buying a
// tower (TowerGiftBoxScreen.OnGetNowButton), anything on a store ad but its CloseButton (Try, Purchase), claiming daily rewards, Insta Monkeys or powers, and on the Modded Client notice
// closing the game or logging out (ModdingPopup.CloseGame, ShowLogoutPopup).
internal static class Popups
{
    // Kind -> the buttons dismiss_popup may press on it.
    public static readonly Dictionary<string, string[]> Allowed = new()
    {
        ["level_up"] = new[] { "continue" },
        ["xp_notice"] = new[] { "continue" },
        // The splash after a free hero or tower unlock at a rank-up (0.3.8): its one button, pressed only
        // once it is enabled (it animates in).
        ["hero_unlock_notice"] = new[] { "continue" },
        ["tower_unlock_notice"] = new[] { "continue" },
        ["tower_unlock_choice"] = new[] { "pick_first" },
        ["victory"] = new[] { "home" },
        ["defeat"] = new[] { "home", "restart" },
        // Closes the screen without opening the chest; the reward stays unclaimed.
        ["daily_rewards"] = new[] { "back" },
        ["update_notice"] = new[] { "ok" },
        // Startup: Start on the title screen (TitleScreen.OnPlayButtonClicked), and Continue on the
        // Modded Client notice (ModdingPopup.Continue), which keeps mods on and the account signed in.
        ["title_screen"] = new[] { "start" },
        ["modded_client_notice"] = new[] { "continue" },
        // The rules dialog a mode opens at the start of a match (CHIMPS: "The true test of a BTD
        // master..."): a plain Popup with one OK button, pressed through the button's own listeners.
        ["mode_rules_notice"] = new[] { "ok" },
        // A one-time tip over a match with a known title (Protocol/DialogKinds.cs; 0.3.5, bloon intros 0.3.6), closed the
        // same way.
        ["tutorial_notice"] = new[] { "ok" },
        // A store or DLC ad over the main menu (Protocol/DialogKinds.cs; 0.3.10): only its CloseButton,
        // never Try or Purchase.
        ["store_ad"] = new[] { "close" },
    };

    private static bool InMatch()
    {
        var inGame = InGame.instance;
        return inGame && !inGame.quitting;
    }

    public static PopupDto? Read()
    {
        var inMatch = InMatch();
        var scope = inMatch ? "match" : "menu";
        // Startup screens come before the menus exist. The Modded Client notice opens over the title
        // screen after Start, so it is checked first.
        if (!inMatch)
        {
            var modding = UnityEngine.Object.FindObjectOfType<ModdingPopup>();
            if (modding != null && modding.gameObject.activeInHierarchy)
                return WithText(Describe("popup", "modded_client_notice", "startup", modding), null, modding.mainMessageTxt?.text);
            var title = UnityEngine.Object.FindObjectOfType<TitleScreen>();
            // Its player ID and name are left out of the report.
            if (title != null && title.gameObject.activeInHierarchy && !title.playButtonClicked)
                return Describe("menu", "title_screen", "startup", title);
        }
        // A popup dialog sits on top of any menu, so it is reported first.
        var popups = PopupScreen.instance;
        if (popups != null && popups.IsPopupActive())
        {
            popups.TryGetActivePopup(out var popup);
            var dialog = popup == null ? null : popup.TryCast<Popup>();
            var described = WithText(Describe("popup", "unknown", scope, popup), dialog?.title?.text, dialog?.body?.text);
            described.Kind = DialogKinds.Classify(described) ?? described.Kind;
            return described;
        }
        var menus = MenuManager.instance;
        var menu = menus == null ? null : menus.GetCurrentMenu();
        if (menu == null) return null;
        var kind = Kind(menu, scope);
        if (kind != null) return Describe("menu", kind, scope, menu, menus!.GetCurrentMenuName());
        if (scope == "match" && (menu.TryCast<HeroPurchaseSplash>() != null || menu.TryCast<GiftboxUnlockSplash>() != null))
        {
            var splash = Describe("menu", "unknown", scope, menu, menus!.GetCurrentMenuName());
            splash.Kind = UnlockSplashKinds.Classify(splash, HeroIds(), TowerIds()) ?? splash.Kind;
            return splash;
        }
        // Another menu over a paused match (the pause menu, a notice this bridge doesn't know) is
        // reported so the runner stops for the operator.
        return InGameIsPaused() ? Describe("menu", "unknown", scope, menu, menus!.GetCurrentMenuName()) : null;
    }

    // Hero and tower IDs from the game model (heroSet, towerSet).
    private static HashSet<string> HeroIds() => DetailIds(Il2CppAssets.Scripts.Unity.Game.instance?.model?.heroSet);
    private static HashSet<string> TowerIds() => DetailIds(Il2CppAssets.Scripts.Unity.Game.instance?.model?.towerSet);

    private static HashSet<string> DetailIds(Il2CppInterop.Runtime.InteropTypes.Arrays.Il2CppReferenceArray<Il2CppAssets.Scripts.Models.TowerSets.TowerDetailsModel>? set)
    {
        var ids = new HashSet<string>(StringComparer.Ordinal);
        if (set != null)
            foreach (var details in set)
                if (details != null && !string.IsNullOrEmpty(details.towerId)) ids.Add(details.towerId);
        return ids;
    }

    private static bool InGameIsPaused() =>
        GameReader.CurrentBridge() != null && Il2CppAssets.Scripts.Simulation.TimeManager.gamePaused;

    private static string? Kind(GameMenu menu, string scope)
    {
        if (scope == "menu")
        {
            if (menu.TryCast<DailyRewardsScreen>() != null) return "daily_rewards";
            if (menu.TryCast<UpdateAnnouncementScreen>() != null) return "update_notice";
            return null;
        }
        if (menu.TryCast<LevelUpScreen>() != null) return "level_up";
        if (menu.TryCast<LevelUpKnowledgeScreen>() != null || menu.TryCast<LevelUpMonkeyMoneyScreen>() != null) return "xp_notice";
        if (menu.TryCast<TowerGiftBoxScreen>() != null) return "tower_unlock_choice";
        if (menu.TryCast<VictoryScreen>() != null) return "victory";
        if (menu.TryCast<DefeatScreen>() != null) return "defeat";
        return null;
    }

    private static PopupDto Describe(string source, string kind, string scope, MonoBehaviour? screen, string? menuName = null)
    {
        var dto = new PopupDto { Kind = kind, Source = source, Scope = scope, MenuName = menuName };
        if (screen == null) return dto;
        var type = screen.GetIl2CppType().FullName ?? "";
        dto.Class = type.Substring(type.LastIndexOf('.') + 1);
        dto.FullClass = type;
        foreach (var button in screen.GetComponentsInChildren<Button>(false))
            if (button != null && button.gameObject.activeInHierarchy)
                dto.Buttons.Add(new PopupButtonDto { Name = button.gameObject.name, Interactable = button.interactable,
                    Label = Shorten(button.GetComponentInChildren<Il2CppTMPro.TMP_Text>()?.text, 40) });
        var giftBox = screen.TryCast<TowerGiftBoxScreen>();
        if (giftBox != null && giftBox.panels != null)
            foreach (var panel in giftBox.panels)
                if (panel != null) dto.Options.Add(panel.towerId);
        return dto;
    }

    private static PopupDto WithText(PopupDto dto, string? title, string? text)
    {
        dto.Title = Shorten(title, 80);
        dto.Text = Shorten(text, 400);
        return dto;
    }

    // Visible text for diagnosing unknown screens: rich-text tags removed, whitespace collapsed, cut short.
    public static string? Shorten(string? text, int max)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        var plain = Regex.Replace(Regex.Replace(text, "<[^>]*>", ""), @"\s+", " ").Trim();
        return plain.Length <= max ? plain : plain.Substring(0, max - 3) + "...";
    }

    // Runs on the main thread. The caller has checked the match (or that there is none, for a screen
    // over the main menu), co-op and flag-risk conditions.
    public static CommandResultDto Dismiss(BridgeCommand command, CommandLedger ledger)
    {
        var open = Read();
        if (open == null) return Reject(command, ledger, "no_popup");
        if (open.Class != command.ExpectPopupClass) return Reject(command, ledger, "stale_popup");
        if (open.Kind != command.Popup) return Reject(command, ledger, "popup_kind_mismatch");
        if (!Allowed.TryGetValue(open.Kind, out var buttons) || Array.IndexOf(buttons, command.Button) < 0)
            return Reject(command, ledger, "button_not_allowed");
        if (open.Scope == "startup") return PressStartup(command, ledger, open);
        if (open.Kind == "mode_rules_notice" || open.Kind == "tutorial_notice") return PressDialogOk(command, ledger, open);
        if (open.Kind == "store_ad") return PressStoreAdClose(command, ledger, open);
        var menu = MenuManager.instance.GetCurrentMenu();
        string? detail = null;
        switch (command.Button)
        {
            case "continue" when open.Kind == "hero_unlock_notice" || open.Kind == "tower_unlock_notice":
                return PressUnlockSplash(command, ledger, open, menu);
            case "continue":
                var levelUp = menu.TryCast<LevelUpScreen>();
                var knowledge = menu.TryCast<LevelUpKnowledgeScreen>();
                var monkeyMoney = menu.TryCast<LevelUpMonkeyMoneyScreen>();
                if (levelUp != null) levelUp.OpenNextUnlockScreen();
                else if (knowledge != null) knowledge.OnClick();
                else if (monkeyMoney != null) monkeyMoney.OnClick();
                else return Reject(command, ledger, "popup_kind_mismatch");
                break;
            case "pick_first":
                var giftBox = menu.TryCast<TowerGiftBoxScreen>();
                if (giftBox == null || giftBox.panels == null || giftBox.panels.Count == 0) return Reject(command, ledger, "no_options");
                var first = giftBox.panels[0];
                giftBox.OnPanelClicked(first);
                giftBox.OnSelectButton();
                detail = $"picked {first.towerId}";
                break;
            case "home":
                var summary = menu.TryCast<SummaryScreen>();
                if (summary == null) return Reject(command, ledger, "popup_kind_mismatch");
                summary.HomeClicked();
                break;
            case "restart":
                var defeat = menu.TryCast<DefeatScreen>();
                if (defeat == null) return Reject(command, ledger, "popup_kind_mismatch");
                defeat.RestartClick();
                break;
            case "back":
                var rewards = menu.TryCast<DailyRewardsScreen>();
                if (rewards == null) return Reject(command, ledger, "popup_kind_mismatch");
                rewards.BackClicked();
                detail = "closed without claiming";
                break;
            case "ok":
                var notice = menu.TryCast<UpdateAnnouncementScreen>();
                if (notice == null) return Reject(command, ledger, "popup_kind_mismatch");
                var ok = notice.okBtn;
                if (ok == null || !ok.interactable || !ok.gameObject.activeInHierarchy) return Reject(command, ledger, "button_unavailable");
                // The OK button's own listeners, as a click would run them.
                ok.onClick.Invoke();
                break;
            default:
                return Reject(command, ledger, "button_not_allowed");
        }
        Log.Msg($"dismiss_popup {command.CommandId}: {open.Class} {command.Button}{(detail == null ? "" : $" ({detail})")}");
        return ledger.Complete(command.CommandId, "executed", detail: detail);
    }

    // Continue on a free unlock splash. The hero splash's handler is HeroPurchaseSplash.MenuClicked (its
    // only public click method); the tower splash has none (GiftboxUnlockSplash wires its clickArea in
    // Open), so its button's own listeners run, as a click would. Either way the one button must be
    // showing and enabled; while it animates in, the command is refused as button_unavailable. The
    // result's detail names the button's persistent listeners, to confirm the handler live.
    private static CommandResultDto PressUnlockSplash(BridgeCommand command, CommandLedger ledger, PopupDto open, GameMenu menu)
    {
        Button? only = null;
        var count = 0;
        foreach (var button in menu.GetComponentsInChildren<Button>(false))
            if (button != null && button.gameObject.activeInHierarchy) { only = button; count++; }
        if (count != 1 || only == null) return Reject(command, ledger, "popup_kind_mismatch");
        if (!only.interactable) return Reject(command, ledger, "button_unavailable");
        var listeners = new List<string>();
        for (var i = 0; i < only.onClick.GetPersistentEventCount(); i++) listeners.Add(only.onClick.GetPersistentMethodName(i));
        var hero = menu.TryCast<HeroPurchaseSplash>();
        var tower = menu.TryCast<GiftboxUnlockSplash>();
        if (open.Kind == "hero_unlock_notice" && hero != null && only.gameObject.name == UnlockSplashKinds.HeroSplashButton) hero.MenuClicked();
        else if (open.Kind == "tower_unlock_notice" && tower != null && tower.clickArea != null && tower.clickArea.Pointer == only.Pointer) only.onClick.Invoke();
        else return Reject(command, ledger, "popup_kind_mismatch");
        var detail = $"{open.MenuName}; persistent listeners: {(listeners.Count == 0 ? "none" : string.Join(", ", listeners))}";
        Log.Msg($"dismiss_popup {command.CommandId}: {open.Class} continue ({detail})");
        return ledger.Complete(command.CommandId, "executed", detail: detail);
    }

    // OK on a plain dialog from PopupScreen: the button's own listeners, as a click would run them.
    private static CommandResultDto PressDialogOk(BridgeCommand command, CommandLedger ledger, PopupDto open)
    {
        if (command.Button != "ok") return Reject(command, ledger, "button_not_allowed");
        var popups = PopupScreen.instance;
        if (popups == null || !popups.IsPopupActive()) return Reject(command, ledger, "no_popup");
        popups.TryGetActivePopup(out var popup);
        if (popup == null) return Reject(command, ledger, "no_popup");
        Button? ok = null;
        foreach (var button in popup.GetComponentsInChildren<Button>(false))
            if (button != null && button.gameObject.activeInHierarchy && button.gameObject.name == "OKButton") ok = button;
        if (ok == null || !ok.interactable) return Reject(command, ledger, "button_unavailable");
        ok.onClick.Invoke();
        Log.Msg($"dismiss_popup {command.CommandId}: {open.Class} ({open.Kind}) ok");
        return ledger.Complete(command.CommandId, "executed");
    }

    // Close on a store ad over the main menu. The button pressed is the one named CloseButton, and only
    // when it is the popup's own close button field (StorePopup.closeBtn, which StoreLegendsPopup
    // inherits, StoreLegendsPopup.exitButton, or RacePassStorePopup.closeBtn); its own listeners run,
    // as a click would. It must be showing and enabled, or the press is refused as button_unavailable.
    // Nothing else on the ad (Try, Purchase / "Get Now", the scroll area) is ever pressed. The result's
    // detail names the button's persistent listeners, to confirm the handler live.
    private static CommandResultDto PressStoreAdClose(BridgeCommand command, CommandLedger ledger, PopupDto open)
    {
        if (command.Button != "close") return Reject(command, ledger, "button_not_allowed");
        var popups = PopupScreen.instance;
        if (popups == null || !popups.IsPopupActive()) return Reject(command, ledger, "no_popup");
        popups.TryGetActivePopup(out var popup);
        if (popup == null) return Reject(command, ledger, "no_popup");
        var store = popup.TryCast<StorePopup>();
        var legends = popup.TryCast<StoreLegendsPopup>();
        var racePass = popup.TryCast<RacePassStorePopup>();
        var fields = new List<IntPtr>();
        if (store != null && store.closeBtn != null) fields.Add(store.closeBtn.Pointer);
        if (legends != null && legends.exitButton != null) fields.Add(legends.exitButton.Pointer);
        if (racePass != null && racePass.closeBtn != null) fields.Add(racePass.closeBtn.Pointer);
        Button? close = null;
        var named = 0;
        foreach (var button in popup.GetComponentsInChildren<Button>(false))
            if (button != null && button.gameObject.activeInHierarchy && button.gameObject.name == DialogKinds.StoreAdCloseButton) { close = button; named++; }
        if (named != 1 || close == null || !fields.Contains(close.Pointer)) return Reject(command, ledger, "popup_kind_mismatch");
        if (!close.interactable) return Reject(command, ledger, "button_unavailable");
        var listeners = new List<string>();
        for (var i = 0; i < close.onClick.GetPersistentEventCount(); i++) listeners.Add(close.onClick.GetPersistentMethodName(i));
        close.onClick.Invoke();
        var detail = $"persistent listeners: {(listeners.Count == 0 ? "none" : string.Join(", ", listeners))}";
        Log.Msg($"dismiss_popup {command.CommandId}: {open.Class} close ({detail})");
        return ledger.Complete(command.CommandId, "executed", detail: detail);
    }

    // Title screen Start, or Continue on the Modded Client notice, each through its own handler and only
    // while its button is showing and enabled.
    private static CommandResultDto PressStartup(BridgeCommand command, CommandLedger ledger, PopupDto open)
    {
        if (command.Popup == "title_screen" && command.Button == "start")
        {
            var title = UnityEngine.Object.FindObjectOfType<TitleScreen>();
            if (title == null || title.playButtonClicked) return Reject(command, ledger, "popup_kind_mismatch");
            var start = title.startButton;
            if (start == null || !start.interactable || !start.gameObject.activeInHierarchy) return Reject(command, ledger, "button_unavailable");
            title.OnPlayButtonClicked();
        }
        else if (command.Popup == "modded_client_notice" && command.Button == "continue")
        {
            var modding = UnityEngine.Object.FindObjectOfType<ModdingPopup>();
            if (modding == null) return Reject(command, ledger, "popup_kind_mismatch");
            var cont = modding.continueBtn;
            if (cont == null || !cont.interactable || !cont.gameObject.activeInHierarchy) return Reject(command, ledger, "button_unavailable");
            modding.Continue();
        }
        else return Reject(command, ledger, "button_not_allowed");
        Log.Msg($"dismiss_popup {command.CommandId}: {open.Class} {command.Button}");
        return ledger.Complete(command.CommandId, "executed");
    }

    private static CommandResultDto Reject(BridgeCommand command, CommandLedger ledger, string reason) =>
        ledger.Complete(command.CommandId, "rejected", reason);
}
