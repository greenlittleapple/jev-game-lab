using System;

namespace JevBtd6Bridge.Protocol;

// Plain dialogs (class Popup, one OKButton) that the bridge names from their English text, and store
// ads over the main menu named by class. A dialog that matches none of the lists below stays
// "unknown", so the runner stops for the operator: having a single OK button is never enough on its own.
public static class DialogKinds
{
    // mode_rules_notice: how the rules dialogs of known modes begin (body text, over a match).
    public static readonly string[] ModeRulesPrefixes = { "The true test of a BTD master" };

    // tutorial_notice: one-time tips over a match, matched by exact title. The titles are the English
    // values of the game's "ft_*title" text keys (Btd6ModHelper/btd6-game-data textTable.json, game 56);
    // the game shows each the first time its trigger happens on an account. Seen live: "Upgrade Your
    // Monkeys!" (ft_upgradesremindertitle, round 16 of Hard Standard, bridge 0.3.3) and "Regrow Bloons"
    // (ft_regrowbloonstitle, round 17 of Hard Standard, bridge 0.3.5). The others are from the text
    // table only. There is no separate tip for Zebra, Rainbow, MOAB, BFB or DDT: the MOAB class shares
    // one tip, and ZOMG and BAD have their own.
    public static readonly string[] TutorialNoticeTitles =
    {
        "Upgrade Your Monkeys!",
        // Bloon introductions
        "Regrow Bloons", "Camo Bloons", "Warning! Camo Bloons!", "Lead Bloons", "Ceramic Bloons", "Purple Bloons",
        "Black Bloons", "White Bloons", "Fortified Bloons", "M.O.A.B. Class Bloons", "Z.O.M.G.", "B.A.D.", "Golden Bloons",
        // Tips about the player's own towers and match features
        "Activated Abilities", "Banana Farm", "Ultimate Power", "Paragon Upgrade Enabled!", "Powers", "Track Removable", "Auto Start",
    };

    // Gameplay hints over a match (0.3.9), also tutorial_notice, matched by exact title. These don't use
    // the ft_* keys, so they are listed apart from the one-time tips above.
    // Seen live: "Change Targeting" (title key ChangeTargeting, body key TargetingOptionFirstTimePopup:
    // "Changing targeting options can sometimes help with tough rounds!"), round 52 of Hard Standard,
    // bridge 0.3.8.
    // From the text table only: "Don't Forget!" (keys "Xp Reminder Title" / "Xp Reminder Description", a
    // reminder to spend Monkey XP). When the game shows it is not known; it counts only over a match.
    // Not included: "Whoops!" ("Lose Tutorial Title", shown on running out of lives, where the runner
    // should stop), the "Hint N" round hints (banner text, not a dialog), and the Frontier and Rogue
    // Legends tips (modes the runner doesn't play).
    // Seen live (0.3.10): "Monkey Knowledge" ("You have unlocked the secrets of Monkey Knowledge! Each
    // Knowledge provides permanent benefits to your Monkeys."), mid-match at the rank-30 level-up (menu
    // LevelUpKnowledgeUnlockUI). OK only closes the notice; it doesn't open the knowledge menu or spend points.
    public static readonly string[] HintTitles =
    {
        "Change Targeting",
        "Don't Forget!",
        "Monkey Knowledge",
    };

    // store_ad (0.3.10): a store or DLC ad PopupScreen opens over the main menu, closed only with its
    // CloseButton. Seen live: StoreLegendsPopup (the Rogue Legends DLC ad, after returning to the menu
    // from a win; buttons ScrollFakeBtn, CloseButton, TryButton "Try", PurchaseButton "Get Now").
    // From the interop assembly only (unverified): StorePopup (StoreLegendsPopup's base class, a store
    // item offer) and RacePassStorePopup, which have the same closeBtn / CloseClicked pattern.
    // Left out: AccoladesStorePopup (opened from a creator's content page, not shown as an ad).
    // This is the one kind with a purchase button that isn't "unknown", and only because the bridge
    // presses nothing but CloseButton on it: never Try, Purchase / "Get Now" or anything opening the store.
    public static readonly string[] StoreAdClasses = { "StoreLegendsPopup", "StorePopup", "RacePassStorePopup" };
    public const string StoreAdCloseButton = "CloseButton";

    // A title that is exactly a bloon or bloon property name, optionally followed by " Bloons", is also
    // a bloon introduction. The names are those in integration/btd6/data/rounds.json, with the MOAB
    // class in the capitals and dotted forms the game's text uses. Exact and case-sensitive.
    public static readonly string[] BloonNames =
    {
        "Red", "Blue", "Green", "Yellow", "Pink", "Black", "White", "Purple", "Zebra", "Lead", "Rainbow", "Ceramic", "Golden",
        "Regrow", "Camo", "Fortified",
        "MOAB", "BFB", "ZOMG", "DDT", "BAD", "M.O.A.B.", "B.F.B.", "Z.O.M.G.", "D.D.T.", "B.A.D.",
    };

    // The kind of a PopupScreen dialog, or null when it isn't one of these.
    public static string? Classify(PopupDto dto)
    {
        if (IsStoreAd(dto)) return "store_ad";
        if (dto.Scope != "match" || dto.Class != "Popup" || dto.Buttons.Count != 1 || dto.Buttons[0].Name != "OKButton") return null;
        if (StartsWithAny(dto.Text, ModeRulesPrefixes)) return "mode_rules_notice";
        if (IsTutorialTitle(dto.Title)) return "tutorial_notice";
        return null;
    }

    // Over the main menu, a PopupScreen dialog of a listed class showing exactly one CloseButton. Whether
    // it is enabled is checked when it is pressed (button_unavailable while it animates in).
    public static bool IsStoreAd(PopupDto dto) =>
        dto.Scope == "menu" && dto.Source == "popup" && dto.Class != null && Array.IndexOf(StoreAdClasses, dto.Class) >= 0
        && dto.Buttons.FindAll(b => b.Name == StoreAdCloseButton).Count == 1;

    public static bool IsTutorialTitle(string? title)
    {
        if (title == null) return false;
        if (Array.IndexOf(TutorialNoticeTitles, title) >= 0 || Array.IndexOf(HintTitles, title) >= 0) return true;
        var name = title.EndsWith(" Bloons", StringComparison.Ordinal) ? title[..^" Bloons".Length] : title;
        return Array.IndexOf(BloonNames, name) >= 0;
    }

    private static bool StartsWithAny(string? text, string[] prefixes) =>
        text != null && Array.Exists(prefixes, p => text.StartsWith(p, StringComparison.Ordinal));
}
