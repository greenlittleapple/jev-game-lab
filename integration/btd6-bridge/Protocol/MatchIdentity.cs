using System;

namespace JevBtd6Bridge.Protocol;

// What the bridge can see of a match when it assigns or checks its ID. Simulation: the native address of the
// match's Simulation object (0 when unknown). Round: the 0-based round index. Null fields are unknown.
public sealed record MatchSetup(long Simulation, string? Map, string? Mode, string? Difficulty, int? Round);

// Assigns match IDs. A match gets its ID from the first of: a state read that finds it running (Observed),
// or Mod Helper's OnMatchStart hook (Started). The game can be read in a match before OnMatchStart fires
// (seen live with bridge 0.3.6: set_speed and a state read landed between start_match and the hook), and the
// hook can repeat while the game re-initialises a loaded match. A start hook is a reinitialisation, not a
// new match, when the current ID is recent (ReinitWindow), no round has started since, and the setup agrees:
// the same Simulation object, or the same map, mode, difficulty and round index. OnRestart, OnMatchEnd and an
// executed start_match always end the current ID, so a restart or a new match gets a new one.
public sealed class MatchIdentity
{
    public static readonly TimeSpan ReinitWindow = TimeSpan.FromSeconds(10);

    private readonly Func<DateTime> clock;
    private int counter;
    private DateTime assignedAt;
    private MatchSetup? setup;
    private bool roundStarted;

    public MatchIdentity(Func<DateTime>? clock = null) { this.clock = clock ?? (() => DateTime.UtcNow); }

    public string? Id { get; private set; }

    // A state read in a match: the current ID, or a new one when there is none.
    public string Observed(MatchSetup now)
    {
        if (Id == null) Assign(now);
        return Id!;
    }

    // Mod Helper's OnMatchStart. Returns true when it re-initialised the current match (its ID is kept).
    public bool Started(MatchSetup now)
    {
        if (Id != null && Reinitialised(now)) { setup = Merge(setup!, now); return true; }
        Assign(now);
        return false;
    }

    // Mod Helper's OnRestart: always a new match.
    public void Restarted(MatchSetup now) => Assign(now);

    // Mod Helper's OnMatchEnd, or start_match executed: the next match gets a new ID.
    public void Ended() { Id = null; setup = null; roundStarted = false; }

    // Mod Helper's OnRoundStart: a later start hook is a new match, not a reinitialisation.
    public void RoundStarted() => roundStarted = true;

    private bool Reinitialised(MatchSetup now)
    {
        if (roundStarted || clock() - assignedAt > ReinitWindow || setup == null) return false;
        if (setup.Simulation != 0 && setup.Simulation == now.Simulation) return true;
        return Same(setup.Map, now.Map) && Same(setup.Mode, now.Mode) && Same(setup.Difficulty, now.Difficulty) && Same(setup.Round, now.Round);
    }

    // Unknown on either side doesn't count as a difference.
    private static bool Same<T>(T? a, T? b) => a == null || b == null || Equals(a, b);

    private static MatchSetup Merge(MatchSetup old, MatchSetup now) => new(
        now.Simulation != 0 ? now.Simulation : old.Simulation, now.Map ?? old.Map, now.Mode ?? old.Mode,
        now.Difficulty ?? old.Difficulty, now.Round ?? old.Round);

    private void Assign(MatchSetup now)
    {
        counter++;
        assignedAt = clock();
        Id = $"{assignedAt:yyyyMMdd'T'HHmmss'Z'}-{counter}";
        setup = now;
        roundStarted = false;
    }
}
