using System.Collections.Generic;

namespace JevBtd6Bridge;

// unlock_all in /state, /health and /profile: whether every tower, upgrade, hero, map and single-player
// mode is available regardless of the account's own unlocks. This bridge uses the account's own
// unlocks, so it reports false. The lab's recorded results were played on a separate single-player
// account with every tower and upgrade available.
// The partial methods below are optional; without an implementation the compiler removes their calls.
internal static partial class Unlocks
{
    public static void Start(JevBridgeMod mod)
    {
        var started = false;
        StartExtension(mod, ref started);
        if (!started) Log.Msg("The account's own unlocks apply.");
    }

    public static bool All
    {
        get
        {
            var all = false;
            ReadAll(ref all);
            return all;
        }
    }

    // Extra fields for /health and /profile, or null when there are none.
    public static Dictionary<string, object>? Details()
    {
        var details = new Dictionary<string, object>();
        AddDetails(details);
        return details.Count > 0 ? details : null;
    }

    static partial void StartExtension(JevBridgeMod mod, ref bool started);
    static partial void ReadAll(ref bool all);
    static partial void AddDetails(Dictionary<string, object> details);
}
