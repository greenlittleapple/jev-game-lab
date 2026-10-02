using BTD_Mod_Helper.Api.Helpers;
using Il2CppAssets.Scripts.Simulation;
using Il2CppAssets.Scripts.Unity.Bridge;
using JevBtd6Bridge.Protocol;

namespace JevBtd6Bridge;

// Game speed (bridge 0.3.4), the only place the bridge changes it. Fast-forward is toggled the way the
// in-game button does it, through UnityToSimulation.SetFastForward. The fast-forward time scale is Mod
// Helper's TimeHelper.OverrideFastForwardTimeScale, which Mod Helper returns in place of
// TimeManager.FastForwardTimeScale; its default is the game's Constants.fastForwardTimeScaleMultiplier (3).
// The override is static, so it lasts until the next set_speed or a game restart.
// Auto-start (0.3.11, set_auto_start) is set the way the in-game toggle sets it for the match, through
// UnityToSimulation.SetAutoPlay; the state reports it as auto_start (Simulation.autoPlay).
internal static class GameSpeed
{
    public static CommandResultDto Set(BridgeCommand command, UnityToSimulation bridge, CommandLedger ledger)
    {
        TimeHelper.OverrideFastForwardTimeScale = command.Multiplier ?? Il2CppAssets.Scripts.Constants.fastForwardTimeScaleMultiplier;
        if (TimeManager.FastForwardActive != command.FastForward) bridge.SetFastForward(command.FastForward);
        Log.Msg($"Speed: fast-forward {(command.FastForward ? "on" : "off")}, time scale {TimeHelper.OverrideFastForwardTimeScale}");
        return ledger.Complete(command.CommandId, "executed", towersHash: GameReader.CurrentTowersHash(bridge));
    }

    public static CommandResultDto SetAutoStart(BridgeCommand command, UnityToSimulation bridge, CommandLedger ledger)
    {
        bridge.SetAutoPlay(command.Enabled);
        Log.Msg($"Auto-start: {(command.Enabled ? "on" : "off")}");
        return ledger.Complete(command.CommandId, "executed", towersHash: GameReader.CurrentTowersHash(bridge));
    }

    // The fast-forward time scale in effect (Mod Helper's override, when it is loaded).
    public static double Multiplier() => TimeManager.FastForwardTimeScale;
}
