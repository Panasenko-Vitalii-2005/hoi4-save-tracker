using System.Security.Cryptography;
using Snapshotter.Core;

var tests = new (string Name, Func<Task> Run)[]
{
    ("Documents and redirected Documents detection", TestDocuments),
    ("Missing source and unsafe output paths", TestPaths),
    ("Output creation and stable autosave", TestStableSave),
    ("Transient temp disappears; final autosave proceeds", TestTransient),
    ("Deduplication, changed content and restart", TestDeduplication),
    ("Matching sidecar and collision suffix", TestSidecarAndCollision),
    ("Sidecar failure does not duplicate a published snapshot", TestSidecarFailure),
    ("Clean cancellation", TestStop),
};

var failed = 0;
foreach (var (name, run) in tests)
{
    try { await run(); Console.WriteLine("PASS " + name); }
    catch (Exception error) { failed++; Console.Error.WriteLine("FAIL " + name + ": " + error); }
}
Console.WriteLine($"Tests: {tests.Length - failed} passed, {failed} failed");
return failed == 0 ? 0 : 1;

static void Check(bool condition, string message)
{
    if (!condition) throw new Exception(message);
}

static async Task ExpectError(Func<Task> action)
{
    try { await action(); }
    catch (SnapshotterException) { return; }
    throw new Exception("Expected a SnapshotterException");
}

static string TempRoot()
{
    var root = Path.Combine(Path.GetTempPath(), "hoi4-gui-test-" + Guid.NewGuid().ToString("N"));
    Directory.CreateDirectory(root);
    return root;
}

static async Task TestDocuments()
{
    var root = TempRoot();
    try
    {
        var normal = Path.Combine(root, "Documents");
        var redirected = Path.Combine(root, "OneDrive", "Documents");
        Directory.CreateDirectory(normal);
        Directory.CreateDirectory(redirected);
        Check(SnapshotPaths.DetectSource(normal) is null, "Missing save folder was detected");
        var expected = SnapshotPaths.DocumentsSaveFolder(redirected);
        Directory.CreateDirectory(expected);
        Check(SnapshotPaths.DetectSource(redirected) == expected, "Redirected Documents not detected");
        Check(SnapshotPaths.DocumentsOutputFolder(normal) == Path.Combine(normal, "HoI4Snapshots"), "Output default wrong");
        Directory.CreateDirectory(SnapshotPaths.DocumentsSaveFolder(normal));
        Check(SnapshotPaths.DetectSource(normal) == SnapshotPaths.DocumentsSaveFolder(normal), "Normal Documents not detected");
    }
    finally { Directory.Delete(root, true); }
    await Task.CompletedTask;
}

static async Task TestPaths()
{
    var root = TempRoot();
    try
    {
        var source = Path.Combine(root, "saves");
        Directory.CreateDirectory(source);
        await ExpectError(() => Task.FromResult(SnapshotPaths.Validate(Path.Combine(root, "missing"), root)));
        await ExpectError(() => Task.FromResult(SnapshotPaths.Validate(source, source)));
        await ExpectError(() => Task.FromResult(SnapshotPaths.Validate(source, Path.Combine(source, "output"))));
        var sibling = SnapshotPaths.Validate(source, Path.Combine(root, "saves-backup"));
        Check(sibling.Output.EndsWith("saves-backup"), "Sibling output rejected");
        var driveRoot = Path.GetPathRoot(root)!;
        Check(SnapshotPaths.Validate(source, driveRoot).Output == Path.TrimEndingDirectorySeparator(driveRoot),
            "Drive root normalization changed");
    }
    finally { Directory.Delete(root, true); }
}

static async Task TestStableSave()
{
    var root = TempRoot();
    try
    {
        var source = Path.Combine(root, "source");
        var output = Path.Combine(root, "output");
        Directory.CreateDirectory(source);
        File.WriteAllText(Path.Combine(source, "autosave.hoi4"), "stable save");
        File.WriteAllText(Path.Combine(source, "manual.hoi4"), "manual save");
        var engine = FastEngine();
        await engine.ScanOncePreparedAsync(source, output);
        Check(Directory.Exists(output), "Output was not created");
        Check(Directory.GetFiles(output, "*.hoi4").Length == 1, "Expected one autosave, no manual save");
        Check(File.ReadAllText(Path.Combine(source, "autosave.hoi4")) == "stable save", "Source changed");
    }
    finally { Directory.Delete(root, true); }
}

static async Task TestTransient()
{
    var root = TempRoot();
    try
    {
        var source = Path.Combine(root, "source");
        var output = Path.Combine(root, "output");
        Directory.CreateDirectory(source);
        Directory.CreateDirectory(output);
        var temp = Path.Combine(source, "autosave_temp.hoi4");
        File.WriteAllText(temp, "transient");
        var messages = new List<string>();
        var engine = new SnapshotterEngine(a => messages.Add(a.Message),
            stabilityInterval: TimeSpan.FromMilliseconds(100));
        var pending = engine.ProcessCandidateAsync(temp, output);
        await Task.Delay(20);
        File.Delete(temp);
        var result = await pending;
        Check(result == CandidateResult.Disappeared, "Transient file was not recognized as disappeared");
        Check(messages.Count == 1 && messages[0].Contains("disappeared", StringComparison.OrdinalIgnoreCase),
            "Transient disappearance produced unexpected activity");
        var final = Path.Combine(source, "autosave.hoi4");
        File.WriteAllText(final, "completed save");
        Check(await engine.ProcessCandidateAsync(final, output) == CandidateResult.Created, "Final autosave not created");
        Check(Directory.GetFiles(output, "*.hoi4").Length == 1, "Unexpected snapshot count");
    }
    finally { Directory.Delete(root, true); }
}

static async Task TestDeduplication()
{
    var root = TempRoot();
    try
    {
        var source = Path.Combine(root, "source");
        var output = Path.Combine(root, "output");
        Directory.CreateDirectory(source);
        var save = Path.Combine(source, "autosave_temp.hoi4");
        File.WriteAllText(save, "first");
        var engine = FastEngine();
        await engine.ScanOncePreparedAsync(source, output);
        Check(Directory.GetFiles(output, "*.hoi4").Length == 1, "Persistent temp autosave missing");
        await engine.ScanOncePreparedAsync(source, output);
        Check(Directory.GetFiles(output, "*.hoi4").Length == 1, "Unchanged content duplicated");
        File.WriteAllText(save, "second content");
        await engine.ScanOncePreparedAsync(source, output);
        Check(Directory.GetFiles(output, "*.hoi4").Length == 2, "Changed content not captured");
        await FastEngine().ScanOncePreparedAsync(source, output);
        Check(Directory.GetFiles(output, "*.hoi4").Length == 2, "Restart duplicated known content");
    }
    finally { Directory.Delete(root, true); }
}

static async Task TestSidecarAndCollision()
{
    var root = TempRoot();
    try
    {
        var source = Path.Combine(root, "source");
        var output = Path.Combine(root, "output");
        Directory.CreateDirectory(source);
        var save = Path.Combine(source, "autosave.hoi4");
        File.WriteAllText(save, "one");
        var fixedTime = new DateTime(2026, 9, 23, 12, 34, 56);
        await FastEngine(clock: () => fixedTime).ScanOncePreparedAsync(source, output);
        File.WriteAllText(save, "two");
        await FastEngine(clock: () => fixedTime).ScanOncePreparedAsync(source, output);
        var snapshots = Directory.GetFiles(output, "*.hoi4");
        Check(snapshots.Length == 2, "Expected two snapshots");
        Check(snapshots.Any(path => path.EndsWith("_2.hoi4")), "Collision suffix missing");
        foreach (var snapshot in snapshots)
        {
            var expected = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(snapshot))).ToLowerInvariant();
            Check(File.ReadAllText(snapshot + ".sha256").Trim() == expected, "Sidecar hash mismatch");
        }
    }
    finally { Directory.Delete(root, true); }
}

static async Task TestStop()
{
    var root = TempRoot();
    try
    {
        var source = Path.Combine(root, "source");
        var output = Path.Combine(root, "output");
        Directory.CreateDirectory(source);
        using var cancellation = new CancellationTokenSource();
        var watch = FastEngine().WatchAsync(source, output, cancellation.Token);
        await Task.Delay(30);
        cancellation.Cancel();
        try { await watch.WaitAsync(TimeSpan.FromSeconds(2)); }
        catch (OperationCanceledException) { }
        Check(watch.IsCompleted, "Watcher did not stop promptly");
        Check(Directory.GetFiles(output, ".snapshot-*.tmp").Length == 0, "Temporary file remained after stop");
    }
    finally { Directory.Delete(root, true); }
}

static async Task TestSidecarFailure()
{
    var root = TempRoot();
    try
    {
        var source = Path.Combine(root, "source");
        var output = Path.Combine(root, "output");
        Directory.CreateDirectory(source);
        Directory.CreateDirectory(output);
        File.WriteAllText(Path.Combine(source, "autosave.hoi4"), "one");
        var fixedTime = new DateTime(2026, 9, 23, 12, 34, 56);
        var destination = SnapshotterEngine.AvailableSnapshotPath(output, "autosave.hoi4", fixedTime);
        Directory.CreateDirectory(destination + ".sha256"); // Prevent sidecar publication.
        var messages = new List<string>();
        var engine = new SnapshotterEngine(a => messages.Add(a.Message), stabilityInterval: TimeSpan.FromMilliseconds(10), clock: () => fixedTime);
        await engine.ScanOncePreparedAsync(source, output);
        await engine.ScanOncePreparedAsync(source, output);
        Check(Directory.GetFiles(output, "*.hoi4").Length == 1, "Sidecar failure duplicated the snapshot");
        Check(messages.Any(message => message.Contains("checksum file", StringComparison.OrdinalIgnoreCase)),
            "Sidecar failure was not surfaced");
    }
    finally { Directory.Delete(root, true); }
}

static SnapshotterEngine FastEngine(Func<DateTime>? clock = null) =>
    new(pollInterval: TimeSpan.FromMilliseconds(10), stabilityInterval: TimeSpan.FromMilliseconds(10), clock: clock);
