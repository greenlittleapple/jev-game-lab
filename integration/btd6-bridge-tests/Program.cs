using System;
using System.Collections.Generic;
using System.Text.Json;
using JevBtd6Bridge.Protocol;

// A small assertion harness (no test framework to restore): each check prints its result and the
// process exits with 1 if any failed.
var failures = 0;
void Check(string name, bool ok, string detail = "")
{
    Console.WriteLine($"{(ok ? "pass" : "FAIL")}  {name}{(ok || detail == "" ? "" : " - " + detail)}");
    if (!ok) failures++;
}

const string Expect = "\"expect\":{\"match_id\":\"20260929T200000Z-1\",\"towers_hash\":\"0123456789abcdef\"}";

// Commands
var place = CommandParser.Parse("{\"command_id\":\"1f0c2a7e-aaaa\",\"action\":\"place_tower\",\"tower\":\"DartMonkey\",\"x\":-80.5,\"y\":30," + Expect + "}", out var error);
Check("place_tower parses", place != null && place.Tower == "DartMonkey" && place.X == -80.5 && place.Y == 30
    && place.ExpectMatchId == "20260929T200000Z-1" && place.ExpectTowersHash == "0123456789abcdef", error ?? "");
var upgrade = CommandParser.Parse("{\"command_id\":\"1f0c2a7e-bbbb\",\"action\":\"upgrade_tower\",\"tower_id\":7,\"path\":2,\"expect\":{\"match_id\":\"m-1\",\"towers_hash\":null}}", out error);
Check("upgrade_tower parses with a null towers_hash", upgrade != null && upgrade.TowerId == 7 && upgrade.Path == 2 && upgrade.ExpectTowersHash == null, error ?? "");
Check("upgrade_tower without expect.tiers checks no tiers", upgrade != null && upgrade.ExpectTiers == null);
var heroUpgrade = CommandParser.Parse("{\"command_id\":\"1f0c2a7e-bbbc\",\"action\":\"upgrade_tower\",\"tower_id\":9,\"path\":0,\"expect\":{\"match_id\":\"m-1\",\"towers_hash\":\"ab\",\"tiers\":[7,0,0]}}", out error);
Check("upgrade_tower carries expect.tiers", heroUpgrade?.ExpectTiers is { Length: 3 } t3 && t3[0] == 7 && t3[1] == 0 && t3[2] == 0, error ?? "");
Check("expect.tiers must be three integers", CommandParser.Parse("{\"command_id\":\"1f0c2a7e-bbbd\",\"action\":\"upgrade_tower\",\"tower_id\":9,\"path\":0,\"expect\":{\"match_id\":\"m-1\",\"towers_hash\":\"ab\",\"tiers\":[7,0]}}", out error) == null && error!.Contains("expect.tiers"));
var start = CommandParser.Parse("{\"command_id\":\"1f0c2a7e-cccc\",\"action\":\"start_round\"," + Expect + "}", out error);
Check("start_round parses", start != null && start.Action == "start_round", error ?? "");

var dismiss = CommandParser.Parse("{\"command_id\":\"1f0c2a7e-eeee\",\"action\":\"dismiss_popup\",\"popup\":\"level_up\",\"button\":\"continue\",\"expect\":{\"match_id\":\"m-1\",\"towers_hash\":null,\"popup_class\":\"LevelUpScreen\"}}", out error);
Check("dismiss_popup parses", dismiss != null && dismiss.Popup == "level_up" && dismiss.Button == "continue" && dismiss.ExpectPopupClass == "LevelUpScreen", error ?? "");
foreach (var (what, body) in new Dictionary<string, string>
{
    ["an unknown popup kind"] = "{\"command_id\":\"1f0c2a7e-ffff\",\"action\":\"dismiss_popup\",\"popup\":\"store\",\"button\":\"continue\",\"expect\":{\"match_id\":\"m\",\"towers_hash\":null,\"popup_class\":\"X\"}}",
    ["continue for Monkey Money"] = "{\"command_id\":\"1f0c2a7e-ffff\",\"action\":\"dismiss_popup\",\"popup\":\"defeat\",\"button\":\"continue_for_mm\",\"expect\":{\"match_id\":\"m\",\"towers_hash\":null,\"popup_class\":\"DefeatScreen\"}}",
    ["freeplay"] = "{\"command_id\":\"1f0c2a7e-ffff\",\"action\":\"dismiss_popup\",\"popup\":\"victory\",\"button\":\"freeplay\",\"expect\":{\"match_id\":\"m\",\"towers_hash\":null,\"popup_class\":\"VictoryScreen\"}}",
    ["a dismissal without the screen class it expects"] = "{\"command_id\":\"1f0c2a7e-ffff\",\"action\":\"dismiss_popup\",\"popup\":\"level_up\",\"button\":\"continue\",\"expect\":{\"match_id\":\"m\",\"towers_hash\":null}}",
})
    Check($"refuses {what}", CommandParser.Parse(body, out var why) == null && !string.IsNullOrEmpty(why));

// Screens over the main menu carry no match; screens over a match must name it.
var rewards = CommandParser.Parse("""{"command_id":"1f0c2a7e-a001","action":"dismiss_popup","popup":"daily_rewards","button":"back","expect":{"popup_class":"DailyRewardsScreen"}}""", out error);
Check("a main-menu screen is dismissed without a match", rewards != null && rewards.Popup == "daily_rewards" && rewards.Button == "back" && rewards.ExpectMatchId == null, error ?? "");
Check("a screen over a match needs its match ID",
    CommandParser.Parse("""{"command_id":"1f0c2a7e-a002","action":"dismiss_popup","popup":"level_up","button":"continue","expect":{"popup_class":"LevelUpScreen"}}""", out var noMatch) == null && noMatch != null);

// Startup screens need no match; Start is allowed only as a button name the bridge knows.
var title = CommandParser.Parse("""{"command_id":"1f0c2a7e-a008","action":"dismiss_popup","popup":"title_screen","button":"start","expect":{"popup_class":"TitleScreen"}}""", out error);
Check("the title screen's Start parses without a match", title != null && title.Popup == "title_screen" && title.Button == "start" && title.ExpectMatchId == null, error ?? "");
var modded = CommandParser.Parse("""{"command_id":"1f0c2a7e-a009","action":"dismiss_popup","popup":"modded_client_notice","button":"continue","expect":{"popup_class":"ModdingPopup"}}""", out error);
Check("the Modded Client notice's Continue parses without a match", modded != null && modded.ExpectMatchId == null, error ?? "");
Check("refuses a close-game button", CommandParser.Parse("""{"command_id":"1f0c2a7e-a010","action":"dismiss_popup","popup":"modded_client_notice","button":"close_game","expect":{"popup_class":"ModdingPopup"}}""", out _) == null);

// Starting and leaving matches
var replace = CommandParser.Parse("""{"command_id":"1f0c2a7e-a011","action":"start_match","map":"Tutorial","difficulty":"Hard","mode":"Clicks","replace_saved":true}""", out error);
Check("start_match takes replace_saved, off by default", replace != null && replace.ReplaceSaved
    && CommandParser.Parse("""{"command_id":"1f0c2a7e-a012","action":"start_match","map":"Tutorial","difficulty":"Hard","mode":"Clicks"}""", out _)?.ReplaceSaved == false, error ?? "");
Check("refuses a replace_saved that isn't a boolean",
    CommandParser.Parse("""{"command_id":"1f0c2a7e-a013","action":"start_match","map":"Tutorial","difficulty":"Hard","mode":"Clicks","replace_saved":"yes"}""", out _) == null);
var rules = CommandParser.Parse("""{"command_id":"1f0c2a7e-a014","action":"dismiss_popup","popup":"mode_rules_notice","button":"ok","expect":{"match_id":"m-1","popup_class":"Popup"}}""", out error);
Check("the mode rules dialog's OK parses with its match", rules != null && rules.ExpectMatchId == "m-1", error ?? "");

// One-time tips (0.3.5, exact titles since 0.3.6): a known title with one OK button is tutorial_notice; anything else stays unknown.
var tipOk = CommandParser.Parse("""{"command_id":"1f0c2a7e-a015","action":"dismiss_popup","popup":"tutorial_notice","button":"ok","expect":{"match_id":"m-1","popup_class":"Popup"}}""", out error);
Check("a tip's OK parses with its match", tipOk != null && tipOk.Popup == "tutorial_notice" && tipOk.ExpectMatchId == "m-1", error ?? "");
Check("a tip's OK needs its match", CommandParser.Parse("""{"command_id":"1f0c2a7e-a016","action":"dismiss_popup","popup":"tutorial_notice","button":"ok","expect":{"popup_class":"Popup"}}""", out _) == null);
PopupDto Dialog(string? title, string? text, string scope = "match", string cls = "Popup", params string[] buttons)
{
    var dto = new PopupDto { Kind = "unknown", Source = "popup", Scope = scope, Class = cls, Title = title, Text = text };
    foreach (var name in buttons.Length == 0 ? new[] { "OKButton" } : buttons) dto.Buttons.Add(new PopupButtonDto { Name = name, Label = "OK", Interactable = true });
    return dto;
}
const string tipBody = "You have permanently unlocked Monkey Upgrades but still need to apply them to your Monkeys each game. Click a Monkey now to apply upgrades.";
Check("the Upgrade Your Monkeys! tip is a tutorial_notice", DialogKinds.Classify(Dialog("Upgrade Your Monkeys!", tipBody)) == "tutorial_notice");
// Bloon introductions and other one-time tips (0.3.6): exact titles from the game's text table, or a
// bloon or property name optionally followed by " Bloons".
const string regrowBody = "Regrow Bloons! These cute heart-shaped Bloons will regrow back lost layers every couple of seconds.";
foreach (var tipTitle in new[] { "Regrow Bloons", "Camo Bloons", "Warning! Camo Bloons!", "Lead Bloons", "Ceramic Bloons", "Purple Bloons", "Black Bloons",
    "White Bloons", "Fortified Bloons", "M.O.A.B. Class Bloons", "Z.O.M.G.", "B.A.D.", "Golden Bloons", "Activated Abilities", "Banana Farm",
    "Zebra Bloons", "Rainbow", "MOAB", "BFB Bloons", "D.D.T.", "ZOMG" })
    Check($"the {tipTitle} tip is a tutorial_notice", DialogKinds.Classify(Dialog(tipTitle, regrowBody)) == "tutorial_notice");
foreach (var (what, dto) in new (string, PopupDto)[]
{
    ("a bloon name in lower case", Dialog("regrow bloons", regrowBody)),
    ("a bloon name with a trailing space", Dialog("Regrow Bloons ", regrowBody)),
    ("a bloon name with the singular", Dialog("Regrow Bloon", regrowBody)),
    ("a bloon name with extra words", Dialog("New Regrow Bloons", regrowBody)),
    ("a bloon name followed by other text", Dialog("Regrow Bloons!", regrowBody)),
    ("\" Bloons\" alone", Dialog(" Bloons", regrowBody)),
    ("\"Bloons\" alone", Dialog("Bloons", regrowBody)),
    ("a bloon ID the game doesn't show as a title", Dialog("Moab", regrowBody)),
    ("a bloon title over the main menu", Dialog("Regrow Bloons", regrowBody, "menu")),
    ("a bloon title in another class", Dialog("Regrow Bloons", regrowBody, "match", "ModdingPopup")),
    ("a bloon title with two buttons", Dialog("Regrow Bloons", regrowBody, "match", "Popup", "OKButton", "CancelButton")),
    ("a bloon title whose button isn't OKButton", Dialog("Regrow Bloons", regrowBody, "match", "Popup", "ContinueButton")),
    ("a menu-only tip title", Dialog("Log in!", regrowBody)),
    ("the regrow text in the body only", Dialog(null, regrowBody)),
})
    Check($"{what} stays unknown", DialogKinds.Classify(dto) == null);
Check("the CHIMPS rules dialog is still a mode_rules_notice", DialogKinds.Classify(Dialog("C.H.I.M.P.S.", "The true test of a BTD master...")) == "mode_rules_notice");
foreach (var (what, dto) in new (string, PopupDto)[]
{
    ("an unknown title with one OK button", Dialog("Some New Tip", tipBody)),
    ("a dialog with no title", Dialog(null, tipBody)),
    ("the tip title not at the start", Dialog("Tip: Upgrade Your Monkeys!", tipBody)),
    ("the tip title in another case", Dialog("upgrade your monkeys!", tipBody)),
    ("the tip title in the body only", Dialog(null, "Upgrade Your Monkeys! " + tipBody)),
    ("the tip over the main menu", Dialog("Upgrade Your Monkeys!", tipBody, "menu")),
    ("the tip in another class", Dialog("Upgrade Your Monkeys!", tipBody, "match", "ModdingPopup")),
    ("the tip with two buttons", Dialog("Upgrade Your Monkeys!", tipBody, "match", "Popup", "OKButton", "CancelButton")),
    ("the tip whose button isn't OKButton", Dialog("Upgrade Your Monkeys!", tipBody, "match", "Popup", "ContinueButton")),
})
    Check($"{what} stays unknown", DialogKinds.Classify(dto) == null);
// Gameplay hints (0.3.9): "Change Targeting" (seen live) and "Don't Forget!" (text table) are tutorial_notice.
const string targetingBody = "Changing targeting options can sometimes help with tough rounds!";
Check("the Change Targeting hint is a tutorial_notice", DialogKinds.Classify(Dialog("Change Targeting", targetingBody)) == "tutorial_notice");
Check("the Don't Forget! hint is a tutorial_notice", DialogKinds.Classify(Dialog("Don't Forget!", "Remember to spend your Monkey XP points to unlock more upgrades for your Monkeys.")) == "tutorial_notice");
foreach (var (what, dto) in new (string, PopupDto)[]
{
    ("the targeting button label", Dialog("Reverse Change Targeting", targetingBody)),
    ("the hint title in another case", Dialog("Change targeting", targetingBody)),
    ("the hint title with extra text", Dialog("Change Targeting!", targetingBody)),
    ("the hint body with no title", Dialog(null, targetingBody)),
    ("the hint over the main menu", Dialog("Change Targeting", targetingBody, "menu")),
    ("the hint in another class", Dialog("Change Targeting", targetingBody, "match", "ModdingPopup")),
    ("the hint with two buttons", Dialog("Change Targeting", targetingBody, "match", "Popup", "OKButton", "CancelButton")),
    ("the hint whose button isn't OKButton", Dialog("Change Targeting", targetingBody, "match", "Popup", "ContinueButton")),
    ("the defeat tip left out on purpose", Dialog("Whoops!", "You ran out of lives! Try again.")),
    ("a single-OK dialog with a hint-like title", Dialog("Hint", targetingBody)),
})
    Check($"{what} stays unknown", DialogKinds.Classify(dto) == null);

// Monkey Knowledge (0.3.10, seen live mid-match at rank 30): tutorial_notice, closed with OK.
const string knowledgeBody = "You have unlocked the secrets of Monkey Knowledge! Each Knowledge provides permanent benefits to your Monkeys.";
Check("the Monkey Knowledge notice is a tutorial_notice", DialogKinds.Classify(Dialog("Monkey Knowledge", knowledgeBody)) == "tutorial_notice");
foreach (var (what, dto) in new (string, PopupDto)[]
{
    ("the Monkey Knowledge notice over the main menu", Dialog("Monkey Knowledge", knowledgeBody, "menu")),
    ("the Monkey Knowledge notice with a second button", Dialog("Monkey Knowledge", knowledgeBody, "match", "Popup", "OKButton", "KnowledgeButton")),
    ("the Monkey Knowledge notice whose button isn't OKButton", Dialog("Monkey Knowledge", knowledgeBody, "match", "Popup", "KnowledgeButton")),
    ("a Monkey Knowledge title in another case", Dialog("Monkey knowledge", knowledgeBody)),
})
    Check($"{what} stays unknown", DialogKinds.Classify(dto) == null);

// Store ads over the main menu (0.3.10): StoreLegendsPopup (seen live) and the unverified StorePopup and
// RacePassStorePopup with one CloseButton are store_ad; the bridge allows only "close" on them.
PopupDto StoreAd(string cls = "StoreLegendsPopup", string scope = "menu", string source = "popup", params string[] buttons)
{
    var dto = new PopupDto { Kind = "unknown", Source = source, Scope = scope, Class = cls };
    foreach (var name in buttons.Length == 0 ? new[] { "ScrollFakeBtn", "CloseButton", "TryButton", "PurchaseButton" } : buttons)
        dto.Buttons.Add(new PopupButtonDto { Name = name, Interactable = true,
            Label = name == "TryButton" ? "Try" : name == "PurchaseButton" ? "Get Now" : null });
    return dto;
}
Check("the Rogue Legends ad is a store_ad", DialogKinds.Classify(StoreAd()) == "store_ad");
Check("a StorePopup offer with a CloseButton is a store_ad (unverified)", DialogKinds.Classify(StoreAd("StorePopup", buttons: new[] { "CloseButton", "PurchaseButton" })) == "store_ad");
Check("a race pass ad with a CloseButton is a store_ad (unverified)", DialogKinds.Classify(StoreAd("RacePassStorePopup", buttons: new[] { "CloseButton", "PurchaseButton" })) == "store_ad");
var disabledClose = StoreAd();
disabledClose.Buttons.Find(b => b.Name == "CloseButton")!.Interactable = false;
Check("an ad whose CloseButton is still disabled is a store_ad (the press is refused as button_unavailable)", DialogKinds.Classify(disabledClose) == "store_ad");
foreach (var (what, dto) in new (string, PopupDto)[]
{
    ("the ad with no CloseButton", StoreAd(buttons: new[] { "ScrollFakeBtn", "TryButton", "PurchaseButton" })),
    ("the ad with only Try and Purchase", StoreAd(buttons: new[] { "TryButton", "PurchaseButton" })),
    ("the ad with two CloseButtons", StoreAd(buttons: new[] { "CloseButton", "CloseButton", "PurchaseButton" })),
    ("the ad over a match", StoreAd(scope: "match")),
    ("the ad at startup", StoreAd(scope: "startup")),
    ("the ad class reported as a menu", StoreAd(source: "menu")),
    ("a different class with the same buttons", StoreAd("AccoladesStorePopup")),
    ("a plain Popup with the same buttons", StoreAd("Popup")),
    ("a class whose name only contains StorePopup", StoreAd("StorePopupExtra")),
    ("the ad class in another case", StoreAd("storelegendspopup")),
})
    Check($"{what} stays unknown", DialogKinds.Classify(dto) == null);
var closeAd = CommandParser.Parse("{\"command_id\":\"1f0c2a7e-ad01\",\"action\":\"dismiss_popup\",\"popup\":\"store_ad\",\"button\":\"close\",\"expect\":{\"popup_class\":\"StoreLegendsPopup\"}}", out error);
Check("dismiss_popup store_ad close parses without a match", closeAd != null && closeAd.Popup == "store_ad" && closeAd.Button == "close" && closeAd.ExpectMatchId == null, error ?? "");
foreach (var button in new[] { "try", "purchase", "get_now", "buy" })
    Check($"dismiss_popup store_ad {button} is refused by the parser",
        CommandParser.Parse("{\"command_id\":\"1f0c2a7e-ad02\",\"action\":\"dismiss_popup\",\"popup\":\"store_ad\",\"button\":\"" + button + "\",\"expect\":{\"popup_class\":\"StoreLegendsPopup\"}}", out _) == null);
Check("store_ad is a menu-scope kind", Array.IndexOf(CommandParser.MenuPopupKinds, "store_ad") >= 0 && Array.IndexOf(CommandParser.MatchPopupKinds, "store_ad") < 0);

// Free unlock splashes (0.3.8): HeroPurchaseSplash as "<heroId>UnlockUI" with one Click button is hero_unlock_notice;
// GiftboxUnlockSplash as "<towerId>UnlockUI" with one button is tower_unlock_notice. Anything else stays unknown.
var heroIds = new HashSet<string> { "Quincy", "Gwendolin", "StrikerJones", "ObynGreenfoot" };
var towerIds = new HashSet<string> { "DartMonkey", "DartlingGunner", "Mermonkey", "Quincy", "Gwendolin" };
PopupDto Splash(string menuName, string cls = "HeroPurchaseSplash", string scope = "match", string source = "menu", params (string Name, string? Label)[] buttons)
{
    var dto = new PopupDto { Kind = "unknown", Source = source, Scope = scope, Class = cls, MenuName = menuName,
        FullClass = "Assets.Scripts.Unity.UI_New.Main.HeroSelect." + cls };
    foreach (var (name, label) in buttons.Length == 0 ? new (string, string?)[] { ("Click", null) } : buttons)
        dto.Buttons.Add(new PopupButtonDto { Name = name, Label = label, Interactable = false });
    return dto;
}
Check("the live Gwendolin splash (button not yet enabled) is hero_unlock_notice",
    UnlockSplashKinds.Classify(Splash("GwendolinUnlockUI"), heroIds, towerIds) == "hero_unlock_notice");
Check("the Striker Jones splash is hero_unlock_notice", UnlockSplashKinds.Classify(Splash("StrikerJonesUnlockUI"), heroIds, towerIds) == "hero_unlock_notice");
Check("the Obyn splash (menu from the addressables catalog) is hero_unlock_notice",
    UnlockSplashKinds.Classify(Splash("ObynGreenfootUnlockUI"), heroIds, towerIds) == "hero_unlock_notice");
Check("a gift box tower splash is tower_unlock_notice",
    UnlockSplashKinds.Classify(Splash("DartlingGunnerUnlockUI", "GiftboxUnlockSplash", buttons: ("ClickArea", null)), heroIds, towerIds) == "tower_unlock_notice");
foreach (var (what, dto) in new (string, PopupDto)[]
{
    ("a hero splash with a purchase button", Splash("GwendolinUnlockUI", buttons: new[] { ("Click", (string?)null), ("BuyButton", "$1.99") })),
    ("a hero splash with a Monkey Money button", Splash("GwendolinUnlockUI", buttons: new[] { ("Click", (string?)null), ("MonkeyMoneyButton", "1,500") })),
    ("a hero splash with its skip button showing", Splash("GwendolinUnlockUI", buttons: new[] { ("Click", (string?)null), ("SkipButton", "Skip") })),
    ("a hero splash with no button", new PopupDto { Kind = "unknown", Source = "menu", Scope = "match", Class = "HeroPurchaseSplash", MenuName = "GwendolinUnlockUI" }),
    ("a hero splash whose one button isn't Click", Splash("GwendolinUnlockUI", buttons: ("BuyButton", "Buy"))),
    ("a hero splash for an unknown hero", Splash("NewHeroUnlockUI")),
    ("a hero skin splash", Splash("ObynSkeletorUnlockUI")),
    ("a hero splash for a tower", Splash("DartMonkeyUnlockUI")),
    ("a hero splash with a lower-case menu name", Splash("gwendolinUnlockUI")),
    ("a hero splash with another menu name", Splash("GwendolinPurchaseUI")),
    ("a hero splash named only UnlockUI", Splash("UnlockUI")),
    ("a hero splash over the main menu", Splash("GwendolinUnlockUI", scope: "menu")),
    ("a hero splash reported as a dialog", Splash("GwendolinUnlockUI", source: "popup")),
    ("a hero menu name on another class", Splash("GwendolinUnlockUI", "HeroSkinPurchaseSplash")),
    ("a tower splash for a hero", Splash("GwendolinUnlockUI", "GiftboxUnlockSplash", buttons: ("ClickArea", null))),
    ("a tower splash for an unknown tower", Splash("NewTowerUnlockUI", "GiftboxUnlockSplash", buttons: ("ClickArea", null))),
    ("a tower splash with two buttons", Splash("DartlingGunnerUnlockUI", "GiftboxUnlockSplash", buttons: new[] { ("ClickArea", (string?)null), ("GetNowButton", "Get Now") })),
    ("the tower pick's menu name", Splash("TowerGiftBoxUI", "GiftboxUnlockSplash", buttons: ("ClickArea", null))),
})
    Check($"{what} stays unknown", UnlockSplashKinds.Classify(dto, heroIds, towerIds) == null);
var heroContinue = CommandParser.Parse("""{"command_id":"1f0c2a7e-a017","action":"dismiss_popup","popup":"hero_unlock_notice","button":"continue","expect":{"match_id":"m-1","popup_class":"HeroPurchaseSplash"}}""", out error);
Check("a hero splash's Continue parses with its match", heroContinue != null && heroContinue.Popup == "hero_unlock_notice" && heroContinue.ExpectMatchId == "m-1", error ?? "");
Check("a hero splash's Continue needs its match", CommandParser.Parse("""{"command_id":"1f0c2a7e-a018","action":"dismiss_popup","popup":"hero_unlock_notice","button":"continue","expect":{"popup_class":"HeroPurchaseSplash"}}""", out _) == null);

var chimps = CommandParser.Parse("""{"command_id":"1f0c2a7e-a003","action":"start_match","map":"Tutorial","difficulty":"Hard","mode":"Clicks"}""", out error);
Check("start_match parses a CHIMPS setup with the ruleset's hero", chimps != null && chimps.Map == "Tutorial" && chimps.Difficulty == "Hard" && chimps.Mode == "Clicks"
    && chimps.Hero == "Quincy" && chimps.ExpectMatchId == null, error ?? "");
var medium = CommandParser.Parse("""{"command_id":"1f0c2a7e-a004","action":"start_match","map":"Tutorial","difficulty":"Medium","mode":"Standard","hero":"Gwendolin"}""", out error);
Check("start_match takes a named hero", medium != null && medium.Mode == "Standard" && medium.Hero == "Gwendolin", error ?? "");
foreach (var (setup, ok) in new[] { ("Standard Easy", true), ("Standard Hard", true), ("Impoppable Hard", true), ("Clicks Medium", false), ("Impoppable Medium", false),
    ("Apopalypse Hard", false), ("Coop Medium", false), ("Standard Impoppable", false) })
{
    var parts = setup.Split(' ');
    var parsed = CommandParser.Parse($$"""{"command_id":"1f0c2a7e-a005","action":"start_match","map":"Tutorial","difficulty":"{{parts[1]}}","mode":"{{parts[0]}}"}""", out _);
    Check($"start_match {(ok ? "accepts" : "refuses")} {setup}", (parsed != null) == ok);
}
foreach (var (what, body) in new Dictionary<string, string>
{
    ["a map ID with a path in it"] = """{"command_id":"1f0c2a7e-a006","action":"start_match","map":"../Tutorial","difficulty":"Hard","mode":"Clicks"}""",
    ["a hero that isn't an ID"] = """{"command_id":"1f0c2a7e-a006","action":"start_match","map":"Tutorial","difficulty":"Hard","mode":"Clicks","hero":7}""",
    ["go_home without the match it expects"] = """{"command_id":"1f0c2a7e-a006","action":"go_home","expect":{}}""",
})
    Check($"refuses {what}", CommandParser.Parse(body, out var why) == null && !string.IsNullOrEmpty(why));
var home = CommandParser.Parse("""{"command_id":"1f0c2a7e-a007","action":"go_home","expect":{"match_id":"m-1"}}""", out error);
Check("go_home parses with the match it expects", home != null && home.Action == "go_home" && home.ExpectMatchId == "m-1", error ?? "");

// Game speed (bridge 0.3.4): fast-forward, with an optional time scale from 1 to 10
var fast = CommandParser.Parse("""{"command_id":"1f0c2a7e-a020","action":"set_speed","fast_forward":true,"multiplier":5,"expect":{"match_id":"m-1"}}""", out error);
Check("set_speed parses fast-forward with a multiplier", fast != null && fast.Action == "set_speed" && fast.FastForward && fast.Multiplier == 5 && fast.ExpectMatchId == "m-1", error ?? "");
var normal = CommandParser.Parse("""{"command_id":"1f0c2a7e-a021","action":"set_speed","fast_forward":false,"expect":{"match_id":"m-1"}}""", out error);
Check("set_speed without a multiplier resets the time scale", normal != null && !normal.FastForward && normal.Multiplier == null, error ?? "");
Check("set_speed takes a null multiplier", CommandParser.Parse("""{"command_id":"1f0c2a7e-a022","action":"set_speed","fast_forward":true,"multiplier":null,"expect":{"match_id":"m-1"}}""", out _)?.Multiplier == null);
foreach (var (what, body) in new Dictionary<string, string>
{
    ["set_speed without its match"] = """{"command_id":"1f0c2a7e-a023","action":"set_speed","fast_forward":true,"expect":{}}""",
    ["set_speed without an expect block"] = """{"command_id":"1f0c2a7e-a023","action":"set_speed","fast_forward":true}""",
    ["set_speed without fast_forward"] = """{"command_id":"1f0c2a7e-a023","action":"set_speed","multiplier":3,"expect":{"match_id":"m-1"}}""",
    ["a fast_forward that isn't a boolean"] = """{"command_id":"1f0c2a7e-a023","action":"set_speed","fast_forward":"yes","expect":{"match_id":"m-1"}}""",
    ["a multiplier above 10"] = """{"command_id":"1f0c2a7e-a023","action":"set_speed","fast_forward":true,"multiplier":10.5,"expect":{"match_id":"m-1"}}""",
    ["a multiplier below 1"] = """{"command_id":"1f0c2a7e-a023","action":"set_speed","fast_forward":true,"multiplier":0.5,"expect":{"match_id":"m-1"}}""",
    ["a multiplier that isn't a number"] = """{"command_id":"1f0c2a7e-a023","action":"set_speed","fast_forward":true,"multiplier":"5","expect":{"match_id":"m-1"}}""",
})
    Check($"refuses {what}", CommandParser.Parse(body, out var why) == null && !string.IsNullOrEmpty(why));
Check("set_speed accepts the limits 1 and 10",
    CommandParser.Parse("""{"command_id":"1f0c2a7e-a024","action":"set_speed","fast_forward":true,"multiplier":1,"expect":{"match_id":"m-1"}}""", out _)?.Multiplier == 1
    && CommandParser.Parse("""{"command_id":"1f0c2a7e-a025","action":"set_speed","fast_forward":true,"multiplier":10,"expect":{"match_id":"m-1"}}""", out _)?.Multiplier == 10);

// Auto-start (bridge 0.3.11): the match's setting, on or off
var autoOff = CommandParser.Parse("""{"command_id":"1f0c2a7e-a030","action":"set_auto_start","enabled":false,"expect":{"match_id":"m-1"}}""", out error);
Check("set_auto_start parses off with its match", autoOff != null && autoOff.Action == "set_auto_start" && !autoOff.Enabled && autoOff.ExpectMatchId == "m-1", error ?? "");
Check("set_auto_start parses on", CommandParser.Parse("""{"command_id":"1f0c2a7e-a031","action":"set_auto_start","enabled":true,"expect":{"match_id":"m-1"}}""", out _)?.Enabled == true);
foreach (var (what, body) in new Dictionary<string, string>
{
    ["set_auto_start without enabled"] = """{"command_id":"1f0c2a7e-a032","action":"set_auto_start","expect":{"match_id":"m-1"}}""",
    ["an enabled that isn't a boolean"] = """{"command_id":"1f0c2a7e-a032","action":"set_auto_start","enabled":"off","expect":{"match_id":"m-1"}}""",
    ["set_auto_start without its match"] = """{"command_id":"1f0c2a7e-a032","action":"set_auto_start","enabled":false,"expect":{}}""",
})
    Check($"refuses {what}", CommandParser.Parse(body, out var why) == null && !string.IsNullOrEmpty(why));

var refused = new Dictionary<string, string>
{
    ["not JSON"] = "{",
    ["an array"] = "[]",
    ["a short command_id"] = "{\"command_id\":\"abc\",\"action\":\"start_round\"," + Expect + "}",
    ["an unknown action"] = "{\"command_id\":\"1f0c2a7e-dddd\",\"action\":\"sell_tower\"," + Expect + "}",
    ["no expectation"] = "{\"command_id\":\"1f0c2a7e-dddd\",\"action\":\"start_round\"}",
    ["no expected match"] = "{\"command_id\":\"1f0c2a7e-dddd\",\"action\":\"start_round\",\"expect\":{\"towers_hash\":null}}",
    ["a tower ID with a path in it"] = "{\"command_id\":\"1f0c2a7e-dddd\",\"action\":\"place_tower\",\"tower\":\"../Dart\",\"x\":1,\"y\":1," + Expect + "}",
    ["a coordinate out of range"] = "{\"command_id\":\"1f0c2a7e-dddd\",\"action\":\"place_tower\",\"tower\":\"DartMonkey\",\"x\":1e9,\"y\":1," + Expect + "}",
    ["a coordinate given as text"] = "{\"command_id\":\"1f0c2a7e-dddd\",\"action\":\"place_tower\",\"tower\":\"DartMonkey\",\"x\":\"1\",\"y\":1," + Expect + "}",
    ["path 3"] = "{\"command_id\":\"1f0c2a7e-dddd\",\"action\":\"upgrade_tower\",\"tower_id\":7,\"path\":3," + Expect + "}",
    ["a negative tower_id"] = "{\"command_id\":\"1f0c2a7e-dddd\",\"action\":\"upgrade_tower\",\"tower_id\":-1,\"path\":0," + Expect + "}",
};
foreach (var (what, body) in refused)
    Check($"refuses {what}", CommandParser.Parse(body, out var why) == null && !string.IsNullOrEmpty(why));

var placement = CommandParser.ParsePlacement("{\"tower\":\"DartMonkey\",\"points\":[[1,2],[-3.5,4]]}", out error);
Check("placement check parses", placement != null && placement.Value.Points.Count == 2 && placement.Value.Points[1].X == -3.5, error ?? "");
Check("placement check refuses a bad point", CommandParser.ParsePlacement("{\"tower\":\"DartMonkey\",\"points\":[[1]]}", out _) == null);
var tooMany = "{\"tower\":\"DartMonkey\",\"points\":[" + string.Join(",", System.Linq.Enumerable.Repeat("[1,2]", BridgeJson.MaxPlacementPoints + 1)) + "]}";
Check("placement check refuses more points than one frame should check", CommandParser.ParsePlacement(tooMany, out _) == null);

// Ledger: at most one execution per command ID, a bounded history, and queued records that settle later.
var ledger = new CommandLedger(capacity: 2);
Check("a new ID is recorded as queued", ledger.Begin("id-00001", "place_tower") == null && ledger.Get("id-00001")?.Status == "queued");
var done = ledger.Complete("id-00001", "executed", towerId: 12, towersHash: "abc");
Check("completion is recorded", done.Status == "executed" && done.TowerId == 12 && done.FinishedAt != null);
var again = ledger.Begin("id-00001", "place_tower");
Check("a repeated ID returns the first record instead of running again", again?.Status == "executed" && again.TowerId == 12);
ledger.Begin("id-00002", "start_round");
ledger.Begin("id-00003", "start_round");
Check("the oldest record is dropped past capacity", ledger.Get("id-00001") == null && ledger.Get("id-00003") != null);
Check("an unknown ID has no record", ledger.Get("never-seen") == null);

// Request guard
Check("a local runner request passes", RequestGuard.Check(true, null, "127.0.0.1", "POST", "application/json; charset=utf-8") == null);
Check("a browser request is refused", RequestGuard.Check(true, "http://example.test", "127.0.0.1", "GET", null) != null);
Check("a remote request is refused", RequestGuard.Check(false, null, "127.0.0.1", "GET", null) != null);
Check("another host name is refused", RequestGuard.Check(true, null, "attacker.test", "GET", null) != null);
Check("a form post is refused", RequestGuard.Check(true, null, "localhost", "POST", "application/x-www-form-urlencoded") != null);
Check("other methods are refused", RequestGuard.Check(true, null, "localhost", "DELETE", null) != null);

// Towers hash
var a = new TowerDto { Id = 7, BaseId = "DartMonkey", Tiers = new[] { 0, 2, 0 } };
var b = new TowerDto { Id = 9, BaseId = "Quincy", Tiers = new[] { 0, 0, 0 } };
Check("the hash ignores list order", TowersHash.Compute(new[] { a, b }) == TowersHash.Compute(new[] { b, a }));
Check("the hash changes with an upgrade", TowersHash.Compute(new[] { a, b }) != TowersHash.Compute(new[] { new TowerDto { Id = 7, BaseId = "DartMonkey", Tiers = new[] { 1, 2, 0 } }, b }));
Check("the hash ignores pops and cash earned", TowersHash.Compute(new[] { a, b }) == TowersHash.Compute(new[] { new TowerDto { Id = 7, BaseId = "DartMonkey", Tiers = new[] { 0, 2, 0 }, Pops = 1234, CashEarned = 50 }, b }));
var hero = new TowerDto { Id = 9, BaseId = "Quincy", Tiers = new[] { 3, 0, 0 }, IsHero = true };
Check("the hash leaves out a hero's level", TowersHash.Compute(new[] { a, hero }) == TowersHash.Compute(new[] { a, new TowerDto { Id = 9, BaseId = "Quincy", Tiers = new[] { 4, 0, 0 }, IsHero = true } }));
Check("the hash still has the hero's ID and type", TowersHash.Compute(new[] { a, hero }) != TowersHash.Compute(new[] { a }) && TowersHash.Compute(new[] { a, hero }) != TowersHash.Compute(new[] { a, new TowerDto { Id = 10, BaseId = "Quincy", Tiers = new[] { 3, 0, 0 }, IsHero = true } }));
Check("an empty map has a fixed hash", TowersHash.Compute(Array.Empty<TowerDto>()) == TowersHash.Compute(new List<TowerDto>()));

// JSON shape the Node side reads (integration/btd6/state.mjs)
var json = BridgeJson.Serialize(new BridgeStateDto { BridgeVersion = "0.1.0", Screen = "in_game", Match = new MatchDto { Id = "m" }, Round = new RoundDto { Index = 20 }, Towers = { a } });
using (var doc = JsonDocument.Parse(json))
{
    var root = doc.RootElement;
    Check("state JSON uses the snake_case names", root.GetProperty("api").GetInt32() == 1 && root.GetProperty("bridge_version").GetString() == "0.1.0"
        && root.GetProperty("round").GetProperty("index").GetInt32() == 20 && root.GetProperty("towers")[0].GetProperty("base_id").GetString() == "DartMonkey"
        && root.GetProperty("towers")[0].GetProperty("tiers").GetArrayLength() == 3 && root.GetProperty("match").GetProperty("result").ValueKind == JsonValueKind.Null);
    Check("a tower without read counters sends null pops and cash_earned", root.GetProperty("towers")[0].GetProperty("pops").ValueKind == JsonValueKind.Null
        && root.GetProperty("towers")[0].GetProperty("cash_earned").ValueKind == JsonValueKind.Null);
}
using (var doc = JsonDocument.Parse(BridgeJson.Serialize(new BridgeStateDto { Towers = { new TowerDto { Id = 3, BaseId = "MortarMonkey", Pops = 812, CashEarned = 0 } } })))
{
    var t = doc.RootElement.GetProperty("towers")[0];
    Check("state JSON carries pops and cash_earned", t.GetProperty("pops").GetInt64() == 812 && t.GetProperty("cash_earned").GetInt64() == 0);
}

var health = BridgeJson.Serialize(new HealthDto { Name = "Jev BTD6 Bridge" });
using (var doc = JsonDocument.Parse(health))
    Check("health JSON reports unlock_all false by default and no extra fields", !doc.RootElement.GetProperty("unlock_all").GetBoolean()
        && !doc.RootElement.TryGetProperty("Extra", out _) && !doc.RootElement.TryGetProperty("extra", out _));
var extended = BridgeJson.Serialize(new HealthDto { Name = "Jev BTD6 Bridge", UnlockAll = true, Extra = new() { ["note"] = "x", ["list"] = new List<string> { "a" } } });
using (var doc = JsonDocument.Parse(extended))
{
    var root = doc.RootElement;
    Check("health JSON writes extra fields at the top level", root.GetProperty("unlock_all").GetBoolean() && root.GetProperty("note").GetString() == "x"
        && root.GetProperty("list")[0].GetString() == "a");
}
using (var doc = JsonDocument.Parse(BridgeJson.Serialize(new BridgeStateDto { UnlockAll = true })))
    Check("state JSON reports unlock_all", doc.RootElement.GetProperty("unlock_all").GetBoolean());
using (var doc = JsonDocument.Parse(BridgeJson.Serialize(new BridgeStateDto { FastForward = true, Multiplier = 5 })))
    Check("state JSON reports fast_forward and the multiplier", doc.RootElement.GetProperty("fast_forward").GetBoolean() && doc.RootElement.GetProperty("multiplier").GetDouble() == 5);
var withPopup = new BridgeStateDto { Popup = new PopupDto { Kind = "tower_unlock_choice", Class = "TowerGiftBoxScreen", Buttons = { new PopupButtonDto { Name = "SelectButton", Interactable = true } }, Options = { "BoomerangMonkey", "BombShooter" } } };
using (var doc = JsonDocument.Parse(BridgeJson.Serialize(withPopup)))
{
    var popup = doc.RootElement.GetProperty("popup");
    Check("state JSON reports an open screen with its buttons and options", popup.GetProperty("kind").GetString() == "tower_unlock_choice"
        && popup.GetProperty("class").GetString() == "TowerGiftBoxScreen" && popup.GetProperty("buttons")[0].GetProperty("name").GetString() == "SelectButton"
        && popup.GetProperty("options")[1].GetString() == "BombShooter");
}
var onMenu = new BridgeStateDto { MainMenu = true, Popup = new PopupDto { Kind = "daily_rewards", Scope = "menu", Class = "DailyRewardsScreen" } };
using (var doc = JsonDocument.Parse(BridgeJson.Serialize(onMenu)))
{
    var root = doc.RootElement;
    Check("state JSON reports the main menu, loading and a screen over it", root.GetProperty("main_menu").GetBoolean() && !root.GetProperty("loading").GetBoolean()
        && root.GetProperty("popup").GetProperty("scope").GetString() == "menu" && root.GetProperty("sub_towers").ValueKind == JsonValueKind.Null);
}
var startupState = new BridgeStateDto { Scene = "TitleScreen", Popup = new PopupDto { Kind = "unknown", Scope = "startup", Class = "Popup", Title = "Notice", Text = "Body",
    Buttons = { new PopupButtonDto { Name = "OkButton", Interactable = true, Label = "Okay" } } } };
using (var doc = JsonDocument.Parse(BridgeJson.Serialize(startupState)))
{
    var root = doc.RootElement;
    var popup = root.GetProperty("popup");
    Check("state JSON reports the scene and an unknown screen's text and button labels", root.GetProperty("scene").GetString() == "TitleScreen"
        && popup.GetProperty("title").GetString() == "Notice" && popup.GetProperty("text").GetString() == "Body"
        && popup.GetProperty("buttons")[0].GetProperty("label").GetString() == "Okay");
}
var helper = BridgeJson.Serialize(new HealthDto { ModHelper = new ModHelperDto { Name = "BloonsTD6 Mod Helper", Version = "3.6.8", Sha256 = "1556c814", File = "Btd6ModHelper.dll" } });
using (var doc = JsonDocument.Parse(helper))
{
    var m = doc.RootElement.GetProperty("mod_helper");
    Check("health JSON reports the loaded Mod Helper", m.GetProperty("version").GetString() == "3.6.8" && m.GetProperty("sha256").GetString() == "1556c814"
        && m.GetProperty("file").GetString() == "Btd6ModHelper.dll");
}

var picked = new CommandLedger();
picked.Begin("id-00009", "dismiss_popup");
Check("an executed dismissal records what it did", picked.Complete("id-00009", "executed", detail: "picked BoomerangMonkey").Detail == "picked BoomerangMonkey");

// The saved-profile answer (GET /api/v1/profile)
var profileDto = new ProfileDto { BridgeVersion = "0.3.2", UnlockAll = true, UnlockedTowers = { "DartMonkey" }, AcquiredUpgrades = { "Sharp Shots" }, Rank = 3, Xp = 1250.5, KnowledgePoints = 0 };
profileDto.TowerXp["DartMonkey"] = 310.5;
using (var doc = JsonDocument.Parse(BridgeJson.Serialize(profileDto)))
{
    var r = doc.RootElement;
    Check("profile fields use the protocol names", r.GetProperty("unlocked_towers")[0].GetString() == "DartMonkey" && r.GetProperty("acquired_upgrades").GetArrayLength() == 1
        && r.GetProperty("unlocked_heroes").GetArrayLength() == 0 && r.GetProperty("rank").GetInt64() == 3 && r.GetProperty("xp").GetDouble() == 1250.5
        && r.GetProperty("tower_xp").GetProperty("DartMonkey").GetDouble() == 310.5 && r.GetProperty("knowledge_points").GetInt64() == 0
        && r.GetProperty("unlock_all").GetBoolean() && r.TryGetProperty("acquired_knowledge", out _));
}

// Bloons on the track (bridge 0.3.3): a summary, not a per-bloon list
var samples = new List<BloonSample>();
for (var i = 0; i < 10; i++) samples.Add(new BloonSample("Red", false, false, false, false, i / 10.0));
samples.Add(new BloonSample("GreenRegrowCamo", true, true, false, false, 0.95));
samples.Add(new BloonSample("MoabFortified", false, false, true, true, 1.4));
var bloons = BloonSummary.Build(samples);
Check("bloon summary counts types and properties", bloons.Count == 12 && bloons.ByType["Red"] == 10 && bloons.ByType["GreenRegrowCamo"] == 1
    && bloons.Camo == 1 && bloons.Regrow == 1 && bloons.Fortified == 1 && bloons.MoabClass == 1 && bloons.OtherTypes == 0);
Check("bloon progress is clamped to 0-1 with nearest-rank quantiles", bloons.Furthest == 1 && bloons.ProgressP50 == 0.5 && bloons.ProgressP75 == 0.8 && bloons.ProgressP90 == 0.95,
    $"{bloons.Furthest} {bloons.ProgressP50} {bloons.ProgressP75} {bloons.ProgressP90}");
var empty = BloonSummary.Build(Array.Empty<BloonSample>());
Check("no bloons: count 0 and no progress", empty.Count == 0 && empty.Furthest == null && empty.ByType.Count == 0);
var many = new List<BloonSample>();
for (var i = 0; i < 12; i++) for (var n = 0; n <= i; n++) many.Add(new BloonSample($"T{i:00}", false, false, false, false, 0.1));
var capped = BloonSummary.Build(many);
Check("at most eight types are listed, the rest counted", capped.ByType.Count == BloonSummary.MaxTypes && capped.ByType.ContainsKey("T11") && !capped.ByType.ContainsKey("T03")
    && capped.OtherTypes == 1 + 2 + 3 + 4 && capped.Count == many.Count);
// MOAB-class bloons with their health (0.3.11), furthest first
var moabSamples = new List<BloonSample> { new("Red", false, false, false, false, 0.9, 1, 1), new("Moab", false, false, false, true, 0.3, 150, 200),
    new("Bfb", false, false, false, true, 0.6, 700, 700), new("MoabFortified", false, false, true, true, 1.2, double.NaN, 400) };
var moabs = BloonSummary.Build(moabSamples).Moabs;
Check("MOAB-class bloons are listed furthest first with health left and full health", moabs.Count == 3
    && moabs[0].Type == "MoabFortified" && moabs[0].Progress == 1 && moabs[0].Health == 0 && moabs[0].MaxHealth == 400
    && moabs[1].Type == "Bfb" && moabs[1].Health == 700 && moabs[2].Type == "Moab" && moabs[2].Health == 150 && moabs[2].MaxHealth == 200,
    string.Join(", ", moabs.ConvertAll(m => $"{m.Type} {m.Progress} {m.Health}/{m.MaxHealth}")));
// The bloons nearest the exit (0.3.15): at most five, furthest first, with their properties
var front = BloonSummary.Build(samples).NearestExit;
Check("the five bloons nearest the exit are listed furthest first", front.Count == BloonSummary.MaxNearestExit
    && front[0].Type == "MoabFortified" && front[0].Progress == 1 && front[0].Fortified && !front[0].Camo
    && front[1].Type == "GreenRegrowCamo" && front[1].Camo && front[1].Regrow && front[1].Progress == 0.95
    && front[2].Type == "Red" && front[2].Progress == 0.9 && front[4].Progress == 0.7,
    string.Join(", ", front.ConvertAll(b => $"{b.Type} {b.Progress}")));
Check("no bloons: nothing near the exit", BloonSummary.Build(Array.Empty<BloonSample>()).NearestExit.Count == 0);
var manyMoabs = new List<BloonSample>();
for (var i = 0; i < 25; i++) manyMoabs.Add(new BloonSample("Moab", false, false, false, true, i / 100.0, 200, 200));
var cappedMoabs = BloonSummary.Build(manyMoabs);
Check("at most twenty MOAB-class bloons are listed; moab_class counts them all", cappedMoabs.Moabs.Count == BloonSummary.MaxMoabs && cappedMoabs.MoabClass == 25 && cappedMoabs.Moabs[0].Progress == 0.24);
Check("no MOAB-class bloons: an empty list", BloonSummary.Build(samples.GetRange(0, 10)).Moabs.Count == 0);
using (var doc = JsonDocument.Parse(BridgeJson.Serialize(new BridgeStateDto { Screen = "in_game", Match = new MatchDto { Id = "m" }, Round = new RoundDto { Index = 5 }, Bloons = BloonSummary.Build(moabSamples) })))
{
    var first = doc.RootElement.GetProperty("bloons").GetProperty("moabs")[0];
    Check("the state serialises moabs as type, progress, health, max_health", first.GetProperty("type").GetString() == "MoabFortified"
        && first.GetProperty("health").GetDouble() == 0 && first.GetProperty("max_health").GetDouble() == 400);
}
using (var doc = JsonDocument.Parse(BridgeJson.Serialize(new BridgeStateDto { Screen = "in_game", Match = new MatchDto { Id = "m" }, Round = new RoundDto { Index = 5, LivesLost = 3 }, Bloons = bloons })))
{
    var r = doc.RootElement;
    var bj = r.GetProperty("bloons");
    Check("bloons and lives_lost use the protocol names", r.GetProperty("round").GetProperty("lives_lost").GetDouble() == 3 && bj.GetProperty("count").GetInt32() == 12
        && bj.GetProperty("by_type").GetProperty("Red").GetInt32() == 10 && bj.GetProperty("moab_class").GetInt32() == 1 && bj.GetProperty("furthest").GetDouble() == 1
        && bj.GetProperty("progress_p90").GetDouble() == 0.95 && bj.TryGetProperty("other_types", out _));
    Check("the summary lists no more than the five bloons nearest the exit", bj.GetProperty("nearest_exit").GetArrayLength() == BloonSummary.MaxNearestExit && BridgeJson.Serialize(bloons).Length < 900, $"{BridgeJson.Serialize(bloons).Length} chars");
}
var roundLives = new RoundLives();
roundLives.Started("m", 5, 100);
Check("lives lost count from the round start", roundLives.LivesLost("m", 5, 96) == 4 && roundLives.LivesLost("m", 5, 100) == 0);
Check("a round the bridge didn't see start counts from its first read", roundLives.LivesLost("m", 6, 90) == 0 && roundLives.LivesLost("m", 6, 88) == 2);
Check("a new match starts over", roundLives.LivesLost("m2", 6, 88) == 0);

// Match IDs (0.3.7). Replay of the live sequence on 0.3.6: start_match, a state read in the loaded match
// before OnMatchStart, then OnMatchStart about a second later for the same match.
{
    var t = new DateTime(2026, 9, 30, 5, 39, 8, 800, DateTimeKind.Utc);
    var ids = new MatchIdentity(() => t);
    var tutorial = new MatchSetup(0x1000, "Tutorial", "Standard", "Hard", 2);
    ids.Ended(); // start_match executed
    var first = ids.Observed(tutorial);
    t = t.AddSeconds(1);
    var reinit = ids.Started(tutorial);
    Check("OnMatchStart after a read of the same match keeps its ID", reinit && ids.Id == first, $"{first} -> {ids.Id}");
    t = t.AddSeconds(0.5);
    Check("a repeated OnMatchStart for a new Simulation with the same setup keeps the ID",
        ids.Started(tutorial with { Simulation = 0x2000 }) && ids.Id == first && ids.Observed(tutorial) == first);
    Check("an unknown setup field doesn't count as a difference", ids.Started(new MatchSetup(0x3000, "Tutorial", null, "Hard", null)) && ids.Id == first);

    // A restart is a new match, even at once and with the same setup.
    ids.Restarted(tutorial);
    var restarted = ids.Id;
    Check("OnRestart gives a new ID", restarted != null && restarted != first);

    // Once a round has started, OnMatchStart is a new match.
    ids.RoundStarted();
    Check("OnMatchStart after a round started gives a new ID", !ids.Started(tutorial) && ids.Id != restarted);

    // Outside the window, or with another setup, OnMatchStart is a new match.
    var current = ids.Id;
    t = t + MatchIdentity.ReinitWindow + TimeSpan.FromSeconds(1);
    Check("OnMatchStart after the window gives a new ID", !ids.Started(tutorial with { Simulation = 0x4000 }) && ids.Id != current);
    current = ids.Id;
    Check("OnMatchStart with another map gives a new ID", !ids.Started(new MatchSetup(0x5000, "MonkeyMeadow", "Standard", "Hard", 2)) && ids.Id != current);
    current = ids.Id;
    Check("OnMatchStart at another round index gives a new ID", !ids.Started(new MatchSetup(0x6000, "MonkeyMeadow", "Standard", "Hard", 16)) && ids.Id != current);

    // A new start_match (or OnMatchEnd) ends the ID, so the next match gets a new one right away.
    current = ids.Id;
    ids.Ended();
    Check("the match after start_match or OnMatchEnd gets a new ID", ids.Id == null && ids.Observed(tutorial) != current);
}

// Targeting (0.3.12): set_targeting names one of the tower's target types, set_target_point a map point; both
// act on the towers as the runner saw them.
var targeting = CommandParser.Parse("{\"command_id\":\"1f0c2a7e-a101\",\"action\":\"set_targeting\",\"tower_id\":12,\"mode\":\"Locked\"," + Expect + "}", out error);
Check("set_targeting parses", targeting != null && targeting.TowerId == 12 && targeting.TargetMode == "Locked" && targeting.ExpectTowersHash == "0123456789abcdef", error ?? "");
var aimPoint = CommandParser.Parse("{\"command_id\":\"1f0c2a7e-a102\",\"action\":\"set_target_point\",\"tower_id\":12,\"x\":-20.5,\"y\":14," + Expect + "}", out error);
Check("set_target_point parses", aimPoint != null && aimPoint.TowerId == 12 && aimPoint.X == -20.5 && aimPoint.Y == 14, error ?? "");
foreach (var (what, body) in new Dictionary<string, string>
{
    ["set_targeting without a mode"] = "{\"command_id\":\"1f0c2a7e-a103\",\"action\":\"set_targeting\",\"tower_id\":12," + Expect + "}",
    ["set_targeting with a mode that isn't an ID"] = "{\"command_id\":\"1f0c2a7e-a104\",\"action\":\"set_targeting\",\"tower_id\":12,\"mode\":\"Lock In\"," + Expect + "}",
    ["set_targeting without a tower"] = "{\"command_id\":\"1f0c2a7e-a105\",\"action\":\"set_targeting\",\"mode\":\"First\"," + Expect + "}",
    ["set_target_point without y"] = "{\"command_id\":\"1f0c2a7e-a106\",\"action\":\"set_target_point\",\"tower_id\":12,\"x\":1," + Expect + "}",
    ["set_target_point far off the map"] = "{\"command_id\":\"1f0c2a7e-a107\",\"action\":\"set_target_point\",\"tower_id\":12,\"x\":1,\"y\":20000," + Expect + "}",
    ["set_target_point without towers_hash"] = "{\"command_id\":\"1f0c2a7e-a108\",\"action\":\"set_target_point\",\"tower_id\":12,\"x\":1,\"y\":2,\"expect\":{\"match_id\":\"m-1\"}}",
})
    Check($"refuses {what}", CommandParser.Parse(body, out var why) == null && !string.IsNullOrEmpty(why));

// Screenshots (0.3.12): the width query and the one-per-second limit.
Check("the screenshot width defaults to 960", CommandParser.ParseShotWidth("", out _) == 960 && CommandParser.ParseShotWidth(null, out _) == 960);
Check("the screenshot width is read from the query", CommandParser.ParseShotWidth("?width=480", out _) == 480 && CommandParser.ParseShotWidth("?a=1&width=1920", out _) == 1920);
foreach (var bad in new[] { "?width=", "?width=0", "?width=4000", "?width=12.5", "?width=-5", "?width=abc" })
    Check($"refuses screenshot query {bad}", CommandParser.ParseShotWidth(bad, out var why) == null && !string.IsNullOrEmpty(why));
var limiter = new ShotLimiter();
Check("the first screenshot is allowed", limiter.TryTake(10_000, out _));
Check("a second within a second waits", !limiter.TryTake(10_400, out var waitMs) && waitMs == 600);
Check("a second after a second is allowed", limiter.TryTake(11_000, out _));

Console.WriteLine(failures == 0 ? "All bridge protocol checks passed." : $"{failures} check(s) failed.");
return failures == 0 ? 0 : 1;
