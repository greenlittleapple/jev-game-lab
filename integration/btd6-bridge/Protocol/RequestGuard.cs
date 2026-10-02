using System;

namespace JevBtd6Bridge.Protocol;

// Only local, non-browser requests reach the game: the runner is the only intended client, and a web
// page must not be able to drive the game through the user's browser.
public static class RequestGuard
{
    // Returns why a request is refused, or null when it may proceed.
    public static string? Check(bool isLocal, string? origin, string? host, string method, string? contentType)
    {
        if (!isLocal) return "Local requests only";
        if (origin != null) return "Browser requests are refused";
        if (host != "localhost" && host != "127.0.0.1") return "Use 127.0.0.1 or localhost";
        if (method != "GET" && method != "POST") return "Only GET and POST are supported";
        if (method == "POST" && !(contentType?.StartsWith("application/json", StringComparison.OrdinalIgnoreCase) ?? false)) return "JSON required";
        return null;
    }
}
