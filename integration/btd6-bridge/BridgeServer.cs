using System;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using JevBtd6Bridge.Protocol;

namespace JevBtd6Bridge;

// Loopback HTTP server. Requests are handled on pool threads; anything that touches the game runs
// through MainThread.
//   GET  /, /api/v1/health          name, version, api, whether the game's main thread is running frames,
//                                   unlock_all and the loaded Mod Helper (answered without the game)
//   GET  /api/v1/state              menu or match, round, cash, lives, towers, open screen (BridgeStateDto)
//   POST /api/v1/command            place_tower | upgrade_tower | start_round | dismiss_popup | start_match | go_home | set_speed |
//                                   set_auto_start | set_targeting | set_target_point (CommandParser)
//   GET  /api/v1/screenshot?width=N a PNG of the game's current frame, N pixels wide (default 960, 64 to 1920); at most
//                                   one per second (429), 503 when the main thread isn't running frames (Screenshot)
//   GET  /api/v1/commands/{id}      what happened to a command ID; 404 if the bridge never saw it
//   GET  /api/v1/map                track paths
//   POST /api/v1/placement-check    whether a tower can be placed at each point (no change to the game; 400 points per request)
//   GET  /api/v1/catalog            towers in the shop with their current cost
//   GET  /api/v1/profile            the saved profile: unlocked towers and heroes, acquired upgrades and
//                                   knowledge, rank, XP, tower XP, unlock_all (read only, ProfileReader)
internal sealed class BridgeServer
{
    private readonly HttpListener listener = new();
    private readonly CommandLedger ledger = new();
    private Thread? thread;

    public void Start(int port)
    {
        listener.Prefixes.Add($"http://127.0.0.1:{port}/");
        listener.Start();
        thread = new Thread(Loop) { IsBackground = true, Name = "JevBtd6Bridge" };
        thread.Start();
    }

    public void Stop()
    {
        try { listener.Stop(); listener.Close(); }
        catch (Exception e) { Log.Warning($"Stopping the bridge server: {e.Message}"); }
    }

    private void Loop()
    {
        while (listener.IsListening)
        {
            HttpListenerContext context;
            try { context = listener.GetContext(); }
            catch (HttpListenerException) { break; }
            catch (ObjectDisposedException) { break; }
            catch (InvalidOperationException) { break; }
            ThreadPool.QueueUserWorkItem(_ => Handle(context));
        }
    }

    private void Handle(HttpListenerContext context)
    {
        var request = context.Request;
        var response = context.Response;
        try
        {
            var refusal = RequestGuard.Check(request.IsLocal, request.Headers["Origin"], request.Url?.Host, request.HttpMethod, request.ContentType);
            if (refusal != null) { Send(response, 403, new ErrorDto { Error = refusal }); return; }
            var path = request.Url!.AbsolutePath;
            var get = request.HttpMethod == "GET";
            if (get && (path == "/" || path == "/api/v1/health")) Send(response, 200, Health());
            else if (get && path == "/api/v1/state") Send(response, 200, MainThread.Run(GameReader.ReadState));
            else if (get && path == "/api/v1/map") Send(response, 200, MainThread.Run(GameReader.ReadMap));
            else if (get && path == "/api/v1/catalog") Send(response, 200, MainThread.Run(GameReader.ReadCatalog));
            else if (get && path == "/api/v1/profile") Send(response, 200, MainThread.Run(ProfileReader.Read));
            else if (get && path == "/api/v1/screenshot")
            {
                var width = CommandParser.ParseShotWidth(request.Url!.Query, out var error);
                if (width == null) { Send(response, 400, new ErrorDto { Error = error! }); return; }
                SendPng(response, Screenshot.Take(width.Value));
            }
            else if (get && path.StartsWith("/api/v1/commands/", StringComparison.Ordinal))
            {
                var record = ledger.Get(Uri.UnescapeDataString(path.Substring("/api/v1/commands/".Length)));
                if (record == null) Send(response, 404, new ErrorDto { Error = "Unknown command ID" });
                else Send(response, 200, record);
            }
            else if (!get && path == "/api/v1/command") HandleCommand(ReadBody(request), response);
            else if (!get && path == "/api/v1/placement-check")
            {
                var parsed = CommandParser.ParsePlacement(ReadBody(request), out var error);
                if (parsed == null) { Send(response, 400, new ErrorDto { Error = error! }); return; }
                var (tower, points) = parsed.Value;
                Send(response, 200, MainThread.Run(() => GameReader.CheckPlacement(tower, points)));
            }
            else Send(response, 404, new ErrorDto { Error = "Not found" });
        }
        catch (BridgeException e) { Send(response, e.Status, new ErrorDto { Error = e.Message }); }
        catch (TimeoutException e) { Send(response, 503, new ErrorDto { Error = e.Message }); }
        catch (Exception e)
        {
            Log.Error($"Request {request.HttpMethod} {request.Url?.AbsolutePath} failed: {e}");
            Send(response, 500, new ErrorDto { Error = "Bridge error" });
        }
    }

    private void HandleCommand(string body, HttpListenerResponse response)
    {
        var command = CommandParser.Parse(body, out var error);
        if (command == null) { Send(response, 400, new ErrorDto { Error = error! }); return; }
        // A repeated command ID gets the first attempt's record and is not executed again.
        var existing = ledger.Begin(command.CommandId, command.Action);
        if (existing != null) { Send(response, 200, existing); return; }
        // A timed-out command was abandoned before it ran, so it is recorded as refused. One that threw
        // may have partly run, so it is recorded as failed for the runner to re-observe.
        try { Send(response, 200, MainThread.Run(() => ExecuteOnce(command))); }
        catch (TimeoutException) { Send(response, 200, ledger.Complete(command.CommandId, "rejected", "main_thread_timeout")); }
    }

    private CommandResultDto ExecuteOnce(BridgeCommand command)
    {
        try { return GameCommands.Execute(command, ledger); }
        catch (Exception e)
        {
            Log.Error($"Command {command.CommandId} ({command.Action}) threw: {e}");
            return ledger.Complete(command.CommandId, "failed", "exception", detail: e.GetType().Name);
        }
    }

    private static HealthDto Health() => new()
    {
        Name = ModHelperData.Name, Version = ModHelperData.Version, MsSinceFrame = MainThread.MsSinceFrame, Frames = MainThread.Frames,
        MainThreadPumping = MainThread.MsSinceFrame is >= 0 and < 2000, RunInBackground = MainThread.RunInBackground,
        UnlockAll = Unlocks.All, Extra = Unlocks.Details(),
        ModHelper = LoadedModHelper.Read(),
    };

    private static string ReadBody(HttpListenerRequest request)
    {
        if (request.ContentLength64 > BridgeJson.MaxBodyBytes) throw new BridgeException(413, "Request body too large");
        using var reader = new StreamReader(request.InputStream, request.ContentEncoding ?? Encoding.UTF8);
        var buffer = new char[BridgeJson.MaxBodyBytes + 1];
        var read = reader.ReadBlock(buffer, 0, buffer.Length);
        if (read > BridgeJson.MaxBodyBytes) throw new BridgeException(413, "Request body too large");
        return new string(buffer, 0, read);
    }

    private static void SendPng(HttpListenerResponse response, byte[] png)
    {
        try
        {
            response.StatusCode = 200;
            response.ContentType = "image/png";
            response.Headers["Cache-Control"] = "no-store";
            response.ContentLength64 = png.Length;
            response.OutputStream.Write(png, 0, png.Length);
        }
        catch (Exception e) { Log.Warning($"Could not send a screenshot: {e.Message}"); }
        finally { try { response.Close(); } catch { } }
    }

    private static void Send(HttpListenerResponse response, int status, object body)
    {
        try
        {
            var bytes = Encoding.UTF8.GetBytes(BridgeJson.Serialize(body));
            response.StatusCode = status;
            response.ContentType = "application/json";
            response.Headers["Cache-Control"] = "no-store";
            response.ContentLength64 = bytes.Length;
            response.OutputStream.Write(bytes, 0, bytes.Length);
        }
        catch (Exception e) { Log.Warning($"Could not send a response: {e.Message}"); }
        finally { try { response.Close(); } catch { } }
    }
}
