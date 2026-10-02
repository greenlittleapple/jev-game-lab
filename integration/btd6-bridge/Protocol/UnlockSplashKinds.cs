using System.Collections.Generic;

namespace JevBtd6Bridge.Protocol;

// Rank-up splash screens over a match that only announce a free unlock (0.3.8). The screen class, the
// menu name and the buttons must all match; anything else stays "unknown" and the runner stops.
//
// hero_unlock_notice: HeroPurchaseSplash (Assets.Scripts.Unity.UI_New.Main.HeroSelect) opened as
// "<heroId>UnlockUI" for a hero ID in the game model's heroSet, with exactly one button, named "Click".
// Seen live: GwendolinUnlockUI at rank 14 of a new account (Hard Standard round 10, bridge 0.3.7), whose
// Click button was not yet interactable 40 ms after the rank-up's Continue. LevelUpScreen.LevelUpType
// has HeroUnlock beside Knowledge, TowerUnlock and MonkeyMoney. The game's addressables catalog has
// "<heroId>UnlockUI" prefabs for every hero (StrikerJonesUnlockUI, ObynGreenfootUnlockUI, ...) and
// skin variants (ObynSkeletorUnlockUI, AdoraSheRaUnlockUI); a skin name is not a hero ID, so a skin
// purchase splash stays unknown. The splash's skip button (skipButton) would be a second button.
//
// tower_unlock_notice: GiftboxUnlockSplash (same namespace) opened as "<towerId>UnlockUI" for a tower
// ID in the model's towerSet that is not a hero, with exactly one button (its clickArea). From the
// interop assemblies and the addressables catalog only (DartlingGunnerUnlockUI, MermonkeyUnlockUI,
// BeastHandlerUnlockUI, DesperadoUnlockUI); not seen live. The class has a name, a short description
// and the click area, and no purchase members.
public static class UnlockSplashKinds
{
    public const string HeroSplashClass = "HeroPurchaseSplash";
    public const string HeroSplashButton = "Click";
    public const string TowerSplashClass = "GiftboxUnlockSplash";
    public const string MenuSuffix = "UnlockUI";

    // The kind of a menu over a match, or null when it isn't one of these. heroIds and towerIds are the
    // game model's; towerIds may include the heroes, which are excluded from tower_unlock_notice.
    public static string? Classify(PopupDto dto, ICollection<string> heroIds, ICollection<string> towerIds)
    {
        if (dto.Scope != "match" || dto.Source != "menu" || dto.Buttons.Count != 1) return null;
        var id = UnlockedId(dto.MenuName);
        if (id == null) return null;
        if (dto.Class == HeroSplashClass && dto.Buttons[0].Name == HeroSplashButton && heroIds.Contains(id)) return "hero_unlock_notice";
        if (dto.Class == TowerSplashClass && towerIds.Contains(id) && !heroIds.Contains(id)) return "tower_unlock_notice";
        return null;
    }

    // "GwendolinUnlockUI" -> "Gwendolin"; null for any other shape.
    public static string? UnlockedId(string? menuName)
    {
        if (menuName == null || !menuName.EndsWith(MenuSuffix, System.StringComparison.Ordinal)) return null;
        var id = menuName[..^MenuSuffix.Length];
        return id.Length == 0 ? null : id;
    }
}
