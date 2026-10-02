using System;
using System.Text.Encodings.Web;
using System.Text.Json;

namespace JevBtd6Bridge.Protocol;

public static class BridgeJson
{
    public const int ApiVersion = 1;
    public const int MaxBodyBytes = 64 * 1024;
    // Placement checks run in one frame, so a request is kept small; clients send larger grids in batches.
    public const int MaxPlacementPoints = 400;

    public static readonly JsonSerializerOptions Options = new()
    {
        WriteIndented = false,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    public static string Serialize(object value) => JsonSerializer.Serialize(value, value.GetType(), Options);
}

// An error with the HTTP status the server should answer with.
public sealed class BridgeException : Exception
{
    public int Status { get; }
    public BridgeException(int status, string message) : base(message) { Status = status; }
}
