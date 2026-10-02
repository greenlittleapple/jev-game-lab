using System.Threading;

namespace JevBtd6Bridge.Protocol;

// Screenshots (0.3.12) cost a frame capture and a PNG encode on the game's main thread, so the bridge takes
// at most one per MinIntervalMs; a request sooner gets 429 with the milliseconds to wait.
public sealed class ShotLimiter
{
    public const long MinIntervalMs = 1000;
    private long last = long.MinValue;

    // True, and the slot is taken, when a shot may start at nowMs; otherwise false and the wait left.
    public bool TryTake(long nowMs, out long waitMs)
    {
        while (true)
        {
            var before = Interlocked.Read(ref last);
            var elapsed = before == long.MinValue ? long.MaxValue : nowMs - before;
            if (elapsed < MinIntervalMs) { waitMs = MinIntervalMs - elapsed; return false; }
            if (Interlocked.CompareExchange(ref last, nowMs, before) == before) { waitMs = 0; return true; }
        }
    }
}
