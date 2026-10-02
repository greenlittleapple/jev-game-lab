using System;
using System.Collections.Generic;

namespace JevBtd6Bridge.Protocol;

// The recent commands by ID, so a command is executed at most once and a runner that lost a response
// can ask what happened (GET /api/v1/commands/{id}). Held in memory: a game restart clears it.
public sealed class CommandLedger
{
    private readonly object gate = new();
    private readonly Dictionary<string, CommandResultDto> records = new();
    private readonly Queue<string> order = new();
    private readonly int capacity;

    public CommandLedger(int capacity = 256) { this.capacity = capacity; }

    // Records a new command as queued and returns null, or returns the existing record when the
    // ID was seen before (the command is then not executed again).
    public CommandResultDto? Begin(string commandId, string action)
    {
        lock (gate)
        {
            if (records.TryGetValue(commandId, out var existing)) return Copy(existing);
            records[commandId] = new CommandResultDto { CommandId = commandId, Action = action, ReceivedAt = DateTime.UtcNow.ToString("o") };
            order.Enqueue(commandId);
            while (order.Count > capacity) records.Remove(order.Dequeue());
            return null;
        }
    }

    public CommandResultDto Complete(string commandId, string status, string? reason = null, uint? towerId = null, string? towersHash = null, string? detail = null)
    {
        lock (gate)
        {
            if (!records.TryGetValue(commandId, out var record))
                throw new InvalidOperationException($"Command {commandId} was not recorded");
            record.Status = status;
            record.Reason = reason;
            record.TowerId = towerId;
            record.TowersHash = towersHash;
            record.Detail = detail;
            record.FinishedAt = status == "queued" ? null : DateTime.UtcNow.ToString("o");
            return Copy(record);
        }
    }

    public CommandResultDto? Get(string commandId)
    {
        lock (gate) return records.TryGetValue(commandId, out var record) ? Copy(record) : null;
    }

    private static CommandResultDto Copy(CommandResultDto r) => new()
    {
        CommandId = r.CommandId, Action = r.Action, Status = r.Status, Reason = r.Reason, TowerId = r.TowerId, Detail = r.Detail,
        TowersHash = r.TowersHash, ReceivedAt = r.ReceivedAt, FinishedAt = r.FinishedAt,
    };
}
