using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Serialization;

namespace JevBtd6Bridge.Protocol;

// One bloon on the track as GameReader reads it: the model's variant ID (e.g. "GreenRegrowCamo"), its
// properties, its progress along its path (Bloon.PercThroughMap(), 0 at the entrance, 1 at the exit), and
// (0.3.11) its health left (Bloon.health) and full health (BloonModel.maxHealth).
public readonly record struct BloonSample(string Type, bool Camo, bool Regrow, bool Fortified, bool MoabClass, double Progress, double Health = 0, double MaxHealth = 0);

// One MOAB-class bloon on the track (0.3.11): its variant ID, progress, health left and full health.
public sealed class MoabDto
{
    [JsonPropertyName("type")] public string Type { get; set; } = "";
    [JsonPropertyName("progress")] public double Progress { get; set; }
    [JsonPropertyName("health")] public double Health { get; set; }
    [JsonPropertyName("max_health")] public double MaxHealth { get; set; }
}

// One of the bloons nearest the exit (0.3.15): its variant ID, properties and progress.
public sealed class FrontBloonDto
{
    [JsonPropertyName("type")] public string Type { get; set; } = "";
    [JsonPropertyName("camo")] public bool Camo { get; set; }
    [JsonPropertyName("regrow")] public bool Regrow { get; set; }
    [JsonPropertyName("fortified")] public bool Fortified { get; set; }
    [JsonPropertyName("progress")] public double Progress { get; set; }
}

// Bloons on the track, summarised: no full per-bloon list, so the state stays small with hundreds of bloons.
public sealed class BloonsDto
{
    [JsonPropertyName("count")] public int Count { get; set; }
    // Count per variant ID, most first (ties by ID); at most MaxTypes entries, the rest counted in other_types.
    [JsonPropertyName("by_type")] public Dictionary<string, int> ByType { get; set; } = new();
    [JsonPropertyName("other_types")] public int OtherTypes { get; set; }
    [JsonPropertyName("camo")] public int Camo { get; set; }
    [JsonPropertyName("regrow")] public int Regrow { get; set; }
    [JsonPropertyName("fortified")] public int Fortified { get; set; }
    [JsonPropertyName("moab_class")] public int MoabClass { get; set; }
    // Progress of the furthest bloon along its path (0 to 1); null with no bloons.
    [JsonPropertyName("furthest")] public double? Furthest { get; set; }
    // Progress quantiles over all bloons: median, 75th and 90th percentile (nearest rank).
    [JsonPropertyName("progress_p50")] public double? ProgressP50 { get; set; }
    [JsonPropertyName("progress_p75")] public double? ProgressP75 { get; set; }
    [JsonPropertyName("progress_p90")] public double? ProgressP90 { get; set; }
    // MOAB-class bloons (0.3.11), furthest first, at most MaxMoabs; moab_class counts them all.
    [JsonPropertyName("moabs")] public List<MoabDto> Moabs { get; set; } = new();
    // The MaxNearestExit bloons furthest along (0.3.15), furthest first, any type.
    [JsonPropertyName("nearest_exit")] public List<FrontBloonDto> NearestExit { get; set; } = new();
}

public static class BloonSummary
{
    public const int MaxTypes = 8;
    public const int MaxMoabs = 20;
    public const int MaxNearestExit = 5;

    public static BloonsDto Build(IEnumerable<BloonSample> bloons)
    {
        var list = bloons.Where(b => b.Type != null).ToList();
        var dto = new BloonsDto { Count = list.Count };
        if (list.Count == 0) return dto;
        var types = list.GroupBy(b => b.Type).Select(g => (g.Key, Count: g.Count())).OrderByDescending(t => t.Count).ThenBy(t => t.Key, StringComparer.Ordinal).ToList();
        foreach (var (type, count) in types.Take(MaxTypes)) dto.ByType[type] = count;
        dto.OtherTypes = types.Skip(MaxTypes).Sum(t => t.Count);
        dto.Camo = list.Count(b => b.Camo);
        dto.Regrow = list.Count(b => b.Regrow);
        dto.Fortified = list.Count(b => b.Fortified);
        dto.MoabClass = list.Count(b => b.MoabClass);
        var progress = list.Select(b => Clamp(b.Progress)).OrderBy(p => p).ToArray();
        dto.Furthest = Round(progress[^1]);
        dto.ProgressP50 = Round(Quantile(progress, 0.5));
        dto.ProgressP75 = Round(Quantile(progress, 0.75));
        dto.ProgressP90 = Round(Quantile(progress, 0.9));
        dto.Moabs = list.Where(b => b.MoabClass).OrderByDescending(b => Clamp(b.Progress)).ThenBy(b => b.Type, StringComparer.Ordinal).Take(MaxMoabs)
            .Select(b => new MoabDto { Type = b.Type, Progress = Round(Clamp(b.Progress)), Health = Health(b.Health), MaxHealth = Health(b.MaxHealth) }).ToList();
        dto.NearestExit = list.OrderByDescending(b => Clamp(b.Progress)).ThenBy(b => b.Type, StringComparer.Ordinal).Take(MaxNearestExit)
            .Select(b => new FrontBloonDto { Type = b.Type, Camo = b.Camo, Regrow = b.Regrow, Fortified = b.Fortified, Progress = Round(Clamp(b.Progress)) }).ToList();
        return dto;
    }

    // Nearest-rank quantile of a sorted array.
    public static double Quantile(double[] sorted, double q) => sorted[Math.Clamp((int)Math.Ceiling(q * sorted.Length) - 1, 0, sorted.Length - 1)];

    private static double Clamp(double p) => double.IsFinite(p) ? Math.Clamp(p, 0, 1) : 0;
    private static double Round(double p) => Math.Round(p, 3);
    private static double Health(double h) => double.IsFinite(h) ? Math.Max(0, Math.Round(h, 1)) : 0;
}

// Lives lost in the current round: the lives when the round started (Mod Helper's OnRoundStart hook), or
// when the bridge first saw the round if it missed the start, minus the lives now. Lives gained during the
// round (a Banana Farm or Monkey Village upgrade) offset losses, so this is a lower bound then.
public sealed class RoundLives
{
    private string? match;
    private int round = int.MinValue;
    private double startLives;

    public void Started(string match, int round, double lives) { this.match = match; this.round = round; startLives = lives; }

    public double LivesLost(string match, int round, double lives)
    {
        if (this.match != match || this.round != round) Started(match, round, lives);
        return Math.Max(0, startLives - lives);
    }
}
