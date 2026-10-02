using System;
using System.Collections;
using System.Threading.Tasks;
using JevBtd6Bridge.Protocol;
using MelonLoader;
using UnityEngine;

namespace JevBtd6Bridge;

// GET /api/v1/screenshot (0.3.12): a PNG of the game's own rendered frame, so an operator can see what the
// runner sees without screen capture of the desktop (it holds only the game, never other windows). The
// frame is read at the end of a frame in a coroutine on the main thread (ScreenCapture needs the finished
// frame), scaled down to the requested width on the GPU, encoded, and every texture made for it is destroyed.
internal static class Screenshot
{
    public const int TimeoutMs = 5000;
    private static readonly ShotLimiter Limiter = new();

    // Throws BridgeException: 503 when the main thread isn't running frames, 429 when a shot was taken less
    // than ShotLimiter.MinIntervalMs ago.
    public static byte[] Take(int width)
    {
        if (MainThread.MsSinceFrame is < 0 or >= 2000) throw new BridgeException(503, "The game's main thread is not running frames");
        if (!Limiter.TryTake(Environment.TickCount64, out var wait)) throw new BridgeException(429, $"One screenshot per second; try again in {wait} ms");
        var done = new TaskCompletionSource<byte[]>(TaskCreationOptions.RunContinuationsAsynchronously);
        MainThread.Run(() => { MelonCoroutines.Start(Capture(width, done)); return true; });
        if (!done.Task.Wait(TimeoutMs)) throw new BridgeException(503, "The frame was not captured in time");
        return done.Task.GetAwaiter().GetResult();
    }

    private static IEnumerator Capture(int width, TaskCompletionSource<byte[]> done)
    {
        yield return new WaitForEndOfFrame();
        Texture2D? full = null, small = null;
        RenderTexture? scaled = null;
        var previous = RenderTexture.active;
        try
        {
            full = ScreenCapture.CaptureScreenshotAsTexture();
            var w = Math.Max(1, Math.Min(width, full.width));
            var h = Math.Max(1, (int)Math.Round(full.height * (double)w / full.width));
            scaled = RenderTexture.GetTemporary(w, h);
            Graphics.Blit(full, scaled);
            RenderTexture.active = scaled;
            small = new Texture2D(w, h, TextureFormat.RGB24, false);
            small.ReadPixels(new Rect(0, 0, w, h), 0, 0);
            small.Apply();
            var png = ImageConversion.EncodeToPNG(small);
            var bytes = new byte[png.Length];
            for (var i = 0; i < bytes.Length; i++) bytes[i] = png[i];
            done.TrySetResult(bytes);
        }
        catch (Exception e) { done.TrySetException(e); }
        finally
        {
            RenderTexture.active = previous;
            if (scaled != null) RenderTexture.ReleaseTemporary(scaled);
            if (full != null) UnityEngine.Object.Destroy(full);
            if (small != null) UnityEngine.Object.Destroy(small);
        }
    }
}
