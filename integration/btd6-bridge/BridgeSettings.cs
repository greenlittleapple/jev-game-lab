using MelonLoader;

namespace JevBtd6Bridge;

// Bridge settings, in the game's UserData/MelonPreferences.cfg under [JevBtd6Bridge]. Read once at
// start; a change takes effect after a game restart.
internal static class BridgeSettings
{
    public const string Category = "JevBtd6Bridge";

    public static int Port { get; private set; } = JevBridgeMod.DefaultPort;

    public static void Load()
    {
        var category = MelonPreferences.CreateCategory(Category, "Jev BTD6 Bridge");
        var port = category.CreateEntry("port", JevBridgeMod.DefaultPort, description: "Loopback port the bridge serves on.");
        Port = port.Value is > 0 and <= 65535 ? port.Value : JevBridgeMod.DefaultPort;
    }
}
