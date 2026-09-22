using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace Snapshotter.Core;

public sealed class SnapshotterException(string message, Exception? inner = null) : Exception(message, inner);

public enum CandidateResult { Created, Duplicate, Disappeared, NotStable }

public sealed record SnapshotActivity(string Message, string? SnapshotName = null);

public sealed class SnapshotterEngine
{
    private readonly TimeSpan _pollInterval;
    private readonly TimeSpan _stabilityInterval;
    private readonly int _maximumStabilityChecks;
    private readonly Func<DateTime> _clock;
    private readonly Action<SnapshotActivity>? _activity;
    private readonly HashSet<string> _knownHashes = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, FileSignature> _observed = new(StringComparer.OrdinalIgnoreCase);

    private readonly record struct FileSignature(long Length, long LastWriteTicks);

    public SnapshotterEngine(Action<SnapshotActivity>? activity = null, TimeSpan? pollInterval = null,
        TimeSpan? stabilityInterval = null, int maximumStabilityChecks = 10, Func<DateTime>? clock = null)
    {
        _activity = activity;
        _pollInterval = pollInterval ?? TimeSpan.FromSeconds(5);
        _stabilityInterval = stabilityInterval ?? TimeSpan.FromSeconds(2);
        _maximumStabilityChecks = maximumStabilityChecks;
        _clock = clock ?? (() => DateTime.Now);
        if (_maximumStabilityChecks < 2 || _pollInterval < TimeSpan.Zero || _stabilityInterval < TimeSpan.Zero)
            throw new ArgumentOutOfRangeException(nameof(maximumStabilityChecks));
    }

    public async Task WatchAsync(string source, string output, CancellationToken cancellationToken)
    {
        var paths = Initialize(source, output);
        while (true)
        {
            cancellationToken.ThrowIfCancellationRequested();
            try { await ScanOnceAsync(paths.Source, paths.Output, cancellationToken); }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            {
                _activity?.Invoke(new SnapshotActivity("Cannot access the HoI4 save folder right now. Watching will retry."));
            }
            await Task.Delay(_pollInterval, cancellationToken);
        }
    }

    public async Task ScanOncePreparedAsync(string source, string output, CancellationToken cancellationToken = default)
    {
        var paths = Initialize(source, output);
        await ScanOnceAsync(paths.Source, paths.Output, cancellationToken);
    }

    private (string Source, string Output) Initialize(string source, string output)
    {
        var paths = SnapshotPaths.Validate(source, output);
        try { Directory.CreateDirectory(paths.Output); }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            throw new SnapshotterException("The snapshot folder could not be created. Choose another folder or check its permissions.", error);
        }
        LoadKnownHashes(paths.Output);
        _observed.Clear();
        return paths;
    }

    public async Task ScanOnceAsync(string source, string output, CancellationToken cancellationToken = default)
    {
        foreach (var file in Directory.EnumerateFiles(source, "*.hoi4", SearchOption.TopDirectoryOnly)
                     .Where(IsAutosave).OrderBy(path => path, StringComparer.OrdinalIgnoreCase))
        {
            cancellationToken.ThrowIfCancellationRequested();
            var signature = ReadSignature(file);
            if (signature is null || (_observed.TryGetValue(file, out var previous) && previous == signature)) continue;
            var result = await ProcessCandidateAsync(file, output, cancellationToken);
            if (result is CandidateResult.Created or CandidateResult.Duplicate) _observed[file] = signature.Value;
        }
    }

    public static bool IsAutosave(string path)
    {
        var name = Path.GetFileName(path);
        return name.Equals("autosave.hoi4", StringComparison.OrdinalIgnoreCase) ||
               (name.StartsWith("autosave_", StringComparison.OrdinalIgnoreCase) &&
                name.EndsWith(".hoi4", StringComparison.OrdinalIgnoreCase));
    }

    public async Task<CandidateResult> ProcessCandidateAsync(string sourcePath, string output, CancellationToken cancellationToken = default)
    {
        var stability = await WaitForStableAsync(sourcePath, cancellationToken);
        if (stability is StabilityResult.Disappeared)
        {
            _activity?.Invoke(new SnapshotActivity("A temporary autosave disappeared; waiting for the completed save."));
            return CandidateResult.Disappeared;
        }
        if (stability is StabilityResult.NotStable)
        {
            _activity?.Invoke(new SnapshotActivity("An autosave is still being written. Watching will retry."));
            return CandidateResult.NotStable;
        }

        try { return CreateSnapshot(sourcePath, output); }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            _activity?.Invoke(new SnapshotActivity("The save became unavailable or snapshot verification failed. Watching will retry."));
            return CandidateResult.NotStable;
        }
    }

    private enum StabilityResult { Stable, Disappeared, NotStable }

    private async Task<StabilityResult> WaitForStableAsync(string path, CancellationToken cancellationToken)
    {
        var previous = ReadSignature(path);
        if (previous is null) return File.Exists(path) ? StabilityResult.NotStable : StabilityResult.Disappeared;
        var unchanged = 0;
        for (var check = 0; check < _maximumStabilityChecks; check++)
        {
            await Task.Delay(_stabilityInterval, cancellationToken);
            var current = ReadSignature(path);
            if (current is null)
                return File.Exists(path) ? StabilityResult.NotStable : StabilityResult.Disappeared;
            if (current == previous)
            {
                if (++unchanged >= 2) return StabilityResult.Stable;
            }
            else { previous = current; unchanged = 0; }
        }
        return StabilityResult.NotStable;
    }

    private CandidateResult CreateSnapshot(string sourcePath, string output)
    {
        var sourceSignature = ReadSignature(sourcePath) ?? throw new IOException("Source unavailable");
        var sourceHash = Sha256(sourcePath);
        if (_knownHashes.Contains(sourceHash)) return CandidateResult.Duplicate;

        var temporary = Path.Combine(output, ".snapshot-" + Guid.NewGuid().ToString("N") + ".tmp");
        try
        {
            File.Copy(sourcePath, temporary);
            if (ReadSignature(sourcePath) != sourceSignature) throw new IOException("Source changed during copy");
            if (!Sha256(temporary).Equals(sourceHash, StringComparison.OrdinalIgnoreCase))
                throw new IOException("Copied hash did not match source");

            var destination = AvailableSnapshotPath(output, Path.GetFileName(sourcePath), _clock());
            File.Move(temporary, destination);
            _knownHashes.Add(sourceHash);
            try
            {
                WriteSidecar(destination, sourceHash);
                _activity?.Invoke(new SnapshotActivity("Snapshot created", Path.GetFileName(destination)));
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            {
                // The completed snapshot is already published. Keep it and avoid making a duplicate;
                // startup can recover its deduplication hash directly from the file.
                _activity?.Invoke(new SnapshotActivity(
                    "Snapshot created, but its checksum file could not be written. Check folder permissions.",
                    Path.GetFileName(destination)));
            }
            return CandidateResult.Created;
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }

    public static string AvailableSnapshotPath(string output, string sourceName, DateTime timestamp)
    {
        var safeBase = Regex.Replace(Path.GetFileNameWithoutExtension(sourceName), "[^A-Za-z0-9._-]", "_");
        if (string.IsNullOrWhiteSpace(safeBase)) safeBase = "autosave";
        var stem = safeBase + "_" + timestamp.ToString("yyyy-MM-dd_HH-mm-ss", System.Globalization.CultureInfo.InvariantCulture);
        var candidate = Path.Combine(output, stem + ".hoi4");
        for (var suffix = 2; File.Exists(candidate); suffix++)
            candidate = Path.Combine(output, stem + "_" + suffix + ".hoi4");
        return candidate;
    }

    private void LoadKnownHashes(string output)
    {
        _knownHashes.Clear();
        foreach (var snapshot in Directory.EnumerateFiles(output, "*.hoi4", SearchOption.TopDirectoryOnly))
        {
            string? hash = null;
            var sidecar = snapshot + ".sha256";
            try
            {
                if (File.Exists(sidecar))
                {
                    var candidate = File.ReadAllText(sidecar).Trim();
                    if (Regex.IsMatch(candidate, "^[0-9a-fA-F]{64}$")) hash = candidate;
                }
                hash ??= Sha256(snapshot);
                _knownHashes.Add(hash);
            }
            catch (Exception error) when (error is IOException or UnauthorizedAccessException)
            {
                _activity?.Invoke(new SnapshotActivity("Could not read an existing snapshot; continuing."));
            }
        }
    }

    private static void WriteSidecar(string destination, string hash)
    {
        var sidecar = destination + ".sha256";
        var temporary = sidecar + ".tmp-" + Guid.NewGuid().ToString("N");
        try
        {
            File.WriteAllText(temporary, hash + Environment.NewLine, Encoding.ASCII);
            File.Move(temporary, sidecar);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }

    private static FileSignature? ReadSignature(string path)
    {
        try
        {
            var file = new FileInfo(path);
            return file.Exists ? new FileSignature(file.Length, file.LastWriteTimeUtc.Ticks) : null;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException) { return null; }
    }

    private static string Sha256(string path)
    {
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        return Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
    }
}
