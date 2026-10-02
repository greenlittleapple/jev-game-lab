using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using BTD_Mod_Helper;
using JevBtd6Bridge;
using JevBtd6Bridge.Protocol;
using MelonLoader;

[assembly: MelonInfo(typeof(JevBridgeMod), ModHelperData.Name, ModHelperData.Version, ModHelperData.Author)]
[assembly: MelonGame("Ninja Kiwi", "BloonsTD6")]

namespace JevBtd6Bridge;

public sealed class JevBridgeMod : BloonsTD6Mod
{
    public const int DefaultPort = 15527;
    private BridgeServer? server;

    public override void OnApplicationStart()
    {
        Log.Logger = LoggerInstance;
        var helper = LoadedModHelper.Read();
        Log.Msg($"Mod Helper {helper.Version ?? "?"} ({helper.File ?? "?"}, SHA-256 {helper.Sha256 ?? helper.Error ?? "?"})");
        BridgeSettings.Load();
        Unlocks.Start(this);
        var port = BridgeSettings.Port;
        try
        {
            server = new BridgeServer();
            server.Start(port);
            Log.Msg($"{ModHelperData.Name} {ModHelperData.Version} is serving on http://127.0.0.1:{port}/");
        }
        catch (Exception e) { Log.Error($"The bridge could not start on port {port}: {e.Message}"); }
    }

    // Unity's main thread, once per frame: run the work HTTP requests queued.
    public override void OnUpdate()
    {
        MainThread.RunInBackground = UnityEngine.Application.runInBackground;
        MainThread.Drain();
    }

    public override void OnApplicationQuit() => server?.Stop();

    public override void OnMatchStart() => MatchTracker.Started();
    public override void OnRestart() => MatchTracker.Restarted();
    public override void OnMatchEnd() => MatchTracker.EndMatch();
    public override void OnRoundStart()
    {
        var bridge = GameReader.CurrentBridge();
        if (bridge != null) MatchTracker.RoundStarted(bridge.GetCurrentRound(), bridge.GetHealth());
    }
    public override void OnVictory() => MatchTracker.SetResult("victory");
    public override void OnDefeat() => MatchTracker.SetResult("defeat");
}

// The Mod Helper that is loaded. Mod Helper's UpdaterPlugin can replace it when the game starts, so
// /api/v1/health reports its version and the SHA-256 of its DLL for the runner to compare with its pin.
internal static class LoadedModHelper
{
    private static ModHelperDto? cached;

    public static ModHelperDto Read()
    {
        if (cached != null) return cached;
        var dto = new ModHelperDto();
        try
        {
            var assembly = typeof(BloonsTD6Mod).Assembly;
            var melon = MelonBase.RegisteredMelons.FirstOrDefault(m => m.MelonAssembly?.Assembly == assembly);
            dto.Name = melon?.Info?.Name;
            dto.Version = melon?.Info?.Version;
            var path = melon?.MelonAssembly?.Location;
            if (string.IsNullOrEmpty(path)) path = assembly.Location;
            if (!string.IsNullOrEmpty(path) && File.Exists(path))
            {
                dto.Sha256 = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path))).ToLowerInvariant();
                dto.File = Path.GetFileName(path);
            }
            else dto.Error = "the Mod Helper DLL file was not found";
        }
        catch (Exception e) { dto.Error = e.Message; }
        if (dto.Version != null && dto.Sha256 != null) cached = dto;
        return dto;
    }
}
