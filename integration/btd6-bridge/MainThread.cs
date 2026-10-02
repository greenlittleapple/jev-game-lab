using System;
using System.Collections.Concurrent;
using System.Threading;
using System.Threading.Tasks;
using JevBtd6Bridge.Protocol;
using MelonLoader;

namespace JevBtd6Bridge;

internal static class Log
{
    public static MelonLogger.Instance? Logger;
    public static void Msg(string text) => Logger?.Msg(text);
    public static void Warning(string text) => Logger?.Warning(text);
    public static void Error(string text) => Logger?.Error(text);
}

// Game objects may only be touched on Unity's main thread; the HTTP threads are never attached to
// IL2CPP. Requests queue plain C# work here, and the mod's OnUpdate runs it once per frame.
internal static class MainThread
{
    private static readonly ConcurrentQueue<Action> Queue = new();
    private static long lastFrameTicks;
    private static long frames;

    // Set each frame from the main thread; read by /api/v1/health without touching the game.
    public static volatile bool RunInBackground;

    public static long Frames => Interlocked.Read(ref frames);
    public static long MsSinceFrame => lastFrameTicks == 0 ? -1 : Environment.TickCount64 - Volatile.Read(ref lastFrameTicks);

    // Runs at most the work that was queued when the frame began; the rest waits for the next frame.
    // Nothing dequeued is ever dropped.
    public static void Drain()
    {
        Volatile.Write(ref lastFrameTicks, Environment.TickCount64);
        Interlocked.Increment(ref frames);
        for (int n = Queue.Count; n > 0 && Queue.TryDequeue(out var work); n--)
        {
            try { work(); }
            catch (Exception e) { Log.Error($"Main thread work failed: {e}"); }
        }
    }

    // Runs func on the main thread and waits for it. If the frame loop doesn't reach it within the
    // timeout, the work is abandoned and never runs late: exactly one of running and abandoning wins.
    public static T Run<T>(Func<T> func, int timeoutMs = 5000)
    {
        int state = 0; // 0 waiting, 1 running, 2 abandoned
        var done = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
        Queue.Enqueue(() =>
        {
            if (Interlocked.CompareExchange(ref state, 1, 0) != 0) return;
            try { done.TrySetResult(func()); }
            catch (Exception e) { done.TrySetException(e); }
        });
        // WaitAny doesn't throw for a faulted task; GetResult then rethrows the original exception.
        if (Task.WaitAny(new Task[] { done.Task }, timeoutMs) < 0 && Interlocked.CompareExchange(ref state, 2, 0) == 0)
            throw new TimeoutException("The game's main thread did not respond in time; the work was not run.");
        return done.Task.GetAwaiter().GetResult();
    }
}

internal static class MatchTracker
{
    // The runner keys its logs and commands on the match ID (Protocol/MatchIdentity.cs).
    private static readonly MatchIdentity ids = new();

    public static string? MatchId => ids.Id;
    public static string? Result { get; private set; }
    public static readonly RoundLives RoundLives = new();

    // Mod Helper's OnMatchStart. A repeat while the game re-initialises the same match keeps its ID.
    public static void Started()
    {
        var before = ids.Id;
        var setup = GameReader.CurrentSetup();
        if (ids.Started(setup)) { Log.Msg($"Match {ids.Id} reinitialised ({Describe(setup)}); keeping its ID."); return; }
        Result = null;
        Log.Msg($"Match {ids.Id} started ({Describe(setup)})" + (before != null ? $"; replaces {before}." : "."));
    }

    // Mod Helper's OnRestart: a new match.
    public static void Restarted()
    {
        var before = ids.Id;
        var setup = GameReader.CurrentSetup();
        ids.Restarted(setup);
        Result = null;
        Log.Msg($"Match {ids.Id} started by a restart ({Describe(setup)})" + (before != null ? $"; replaces {before}." : "."));
    }

    // Mod Helper's OnMatchEnd, or an executed start_match: the next match gets a new ID.
    public static void EndMatch() { ids.Ended(); Result = null; }

    // Mod Helper's OnRoundStart hook: the lives the round starts with.
    public static void RoundStarted(int roundIndex, double lives)
    {
        var id = Current();
        ids.RoundStarted();
        RoundLives.Started(id, roundIndex, lives);
    }

    public static void SetResult(string result) { if (ids.Id != null) Result = result; }

    // A match already running when the bridge first looks at it, or read before OnMatchStart fires, gets an ID.
    public static string Current()
    {
        if (ids.Id != null) return ids.Id;
        var setup = GameReader.CurrentSetup();
        var id = ids.Observed(setup);
        Result = null;
        Log.Msg($"Match {id} first seen by a state read ({Describe(setup)}).");
        return id;
    }

    private static string Describe(MatchSetup s) => $"{s.Map ?? "?"} {s.Difficulty ?? "?"} {s.Mode ?? "?"}, round index {s.Round?.ToString() ?? "?"}";
}
