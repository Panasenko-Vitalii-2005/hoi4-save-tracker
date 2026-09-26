using System.Security.Cryptography;
using System.Reflection;
using Snapshotter.Core;
using Snapshotter.Gui;

var tests = new (string Name, Func<Task> Run)[]
{
    ("Documents and redirected Documents detection", TestDocuments),
    ("Missing source and unsafe output paths", TestPaths),
    ("Output creation and stable autosave", TestStableSave),
    ("Generated snapshot names are not live autosaves", TestGeneratedSnapshotNames),
    ("Historical snapshots are skipped before scanning; later saves still work", TestGeneratedSnapshotDiscovery),
    ("Transient temp disappears; final autosave proceeds", TestTransient),
    ("Deduplication, changed content and restart", TestDeduplication),
    ("Matching sidecar and collision suffix", TestSidecarAndCollision),
    ("Sidecar failure does not duplicate a published snapshot", TestSidecarFailure),
    ("Poll-delay cancellation", TestStop),
    ("Stability-wait cancellation", TestStabilityCancellation),
    ("GUI STA entry point and folder selection", TestGuiEntryAndFolderSelection),
    ("GUI repeated Start/Stop and locked configuration", TestGuiLifecycle),
    ("GUI Stop during stability wait", TestGuiStabilityStop),
    ("GUI close while watching", TestGuiClose),
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

static async Task TestGeneratedSnapshotNames()
{
    string[] ignored =
    [
        "autosave_2026-09-26_21-20-34.hoi4",
        "autosave_temp_2026-09-26_21-20-34.hoi4",
        "autosave_142_temp_2026-09-26_21-20-34.hoi4",
        "autosave_2026-09-26_21-20-34_2.hoi4",
        "autosave_2026-09-26_21-20-34_3.hoi4"
    ];
    foreach (var name in ignored)
    {
        Check(SnapshotterEngine.IsGeneratedSnapshotName(name), $"Generated name was not recognized: {name}");
        Check(!SnapshotterEngine.IsAutosave(name), $"Generated name remained a candidate: {name}");
    }

    string[] accepted =
    [
        "autosave.hoi4",
        "autosave_temp.hoi4",
        "autosave_1.hoi4",
        "autosave_142_temp.hoi4",
        "autosave_monthly.hoi4",
        "autosave_2026-09-26_21-20.hoi4",
        "autosave_2026-99-26_21-20-34.hoi4",
        "autosave_2026-09-26_21-20-34_extra.hoi4"
    ];
    foreach (var name in accepted)
    {
        Check(!SnapshotterEngine.IsGeneratedSnapshotName(name), $"Live-style name was excluded: {name}");
        Check(SnapshotterEngine.IsAutosave(name), $"Live-style autosave was rejected: {name}");
    }
    Check(!SnapshotterEngine.IsAutosave("manual.hoi4"), "Manual save became a candidate");
    await Task.CompletedTask;
}

static async Task TestGeneratedSnapshotDiscovery()
{
    var root = TempRoot();
    try
    {
        var source = Path.Combine(root, "source");
        var output = Path.Combine(root, "output");
        Directory.CreateDirectory(source);
        var historical = Path.Combine(source, "autosave_142_temp_2026-09-26_21-20-34.hoi4");
        File.WriteAllText(historical, "historical snapshot");
        var activity = new List<SnapshotActivity>();
        var engine = FastEngine(activity: activity.Add);
        await engine.ScanOncePreparedAsync(source, output);
        Check(Directory.GetFiles(output, "*.hoi4").Length == 0, "Historical snapshot was copied");
        Check(activity.Count == 0, "Ignored snapshot produced activity noise");

        var live = Path.Combine(source, "autosave_142_temp.hoi4");
        File.WriteAllText(live, "live autosave");
        await engine.ScanOncePreparedAsync(source, output);
        Check(Directory.GetFiles(output, "*.hoi4").Length == 1, "Later live autosave was not copied exactly once");
        Check(activity.Count == 1 && activity[0].SnapshotName is not null, "Unexpected activity for live save");
        await engine.ScanOncePreparedAsync(source, output);
        Check(Directory.GetFiles(output, "*.hoi4").Length == 1, "Deduplication changed after exclusion");
        Check(File.ReadAllText(historical) == "historical snapshot", "Historical source was changed");
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
        await ExpectCanceled(watch, cancellation.Token);
        Check(watch.IsCompleted, "Watcher did not stop promptly");
        Check(Directory.GetFiles(output, ".snapshot-*.tmp").Length == 0, "Temporary file remained after stop");
    }
    finally { Directory.Delete(root, true); }
}

static async Task TestStabilityCancellation()
{
    var root = TempRoot();
    try
    {
        var source = Path.Combine(root, "source");
        var output = Path.Combine(root, "output");
        Directory.CreateDirectory(source);
        Directory.CreateDirectory(output);
        var save = Path.Combine(source, "autosave.hoi4");
        File.WriteAllText(save, "being checked");
        using var cancellation = new CancellationTokenSource();
        var processing = new SnapshotterEngine(stabilityInterval: TimeSpan.FromSeconds(2))
            .ProcessCandidateAsync(save, output, cancellation.Token);
        await Task.Delay(30);
        cancellation.Cancel();
        await ExpectCanceled(processing, cancellation.Token);
        Check(Directory.GetFiles(output, "*.hoi4").Length == 0, "Cancellation published a snapshot");
    }
    finally { Directory.Delete(root, true); }
}

static async Task ExpectCanceled(Task task, CancellationToken expectedToken)
{
    try { await task.WaitAsync(TimeSpan.FromSeconds(2)); }
    catch (OperationCanceledException error) when (error.CancellationToken == expectedToken) { return; }
    throw new Exception("Expected cancellation with the watcher token");
}

static async Task TestGuiEntryAndFolderSelection()
{
    var entry = typeof(SnapshotterForm).Assembly.GetType("Snapshotter.Gui.Program")?
        .GetMethod("Main", BindingFlags.Static | BindingFlags.NonPublic);
    Check(entry?.IsDefined(typeof(STAThreadAttribute)) == true, "WinForms entry point is not STA");

    var root = TempRoot();
    try
    {
        var existing = Path.Combine(root, "existing");
        Directory.CreateDirectory(existing);
        var selected = FolderSelection.Choose(existing, initial =>
        {
            Check(initial == existing, "Existing initial path was not passed to Browse");
            return (DialogResult.OK, existing);
        });
        Check(selected == existing, "Valid folder was not selected");
        selected = FolderSelection.Choose(Path.Combine(root, "missing"), initial =>
        {
            Check(initial is null, "Missing initial path was passed to Browse");
            return (DialogResult.Cancel, existing);
        });
        Check(selected is null, "Cancel changed the selected folder");
        selected = FolderSelection.Choose(existing, _ => (DialogResult.OK, Path.Combine(root, "missing")));
        Check(selected is null, "Missing selected folder was accepted");
    }
    finally { Directory.Delete(root, true); }
    await Task.CompletedTask;
}

static async Task TestGuiLifecycle()
{
    var root = TempRoot();
    try
    {
        var source = Path.Combine(root, "source");
        var output = Path.Combine(root, "output");
        Directory.CreateDirectory(source);
        await RunGuiCase(async form =>
        {
            var sourceInput = FormControl<TextBox>(form, "sourcePath");
            var outputInput = FormControl<TextBox>(form, "outputPath");
            var sourceBrowse = FormControl<Button>(form, "sourceBrowse");
            var outputBrowse = FormControl<Button>(form, "outputBrowse");
            var toggle = FormControl<Button>(form, "watchToggle");
            var status = FormControl<Label>(form, "watchStatus");
            sourceInput.Text = source;
            outputInput.Text = output;
            for (var attempt = 0; attempt < 2; attempt++)
            {
                toggle.PerformClick();
                await WaitFor(() => status.Text == "Watching" && Directory.Exists(output));
                Check(!sourceInput.Enabled && !outputInput.Enabled && !sourceBrowse.Enabled && !outputBrowse.Enabled,
                    "Configuration remained editable while watching");
                toggle.PerformClick();
                await WaitFor(() => status.Text == "Idle" && toggle.Enabled);
                Check(sourceInput.Enabled && outputInput.Enabled && sourceBrowse.Enabled && outputBrowse.Enabled,
                    "Configuration was not restored after Stop");
            }
        });
    }
    finally { Directory.Delete(root, true); }
}

static async Task TestGuiStabilityStop()
{
    var root = TempRoot();
    try
    {
        var source = Path.Combine(root, "source");
        var output = Path.Combine(root, "output");
        Directory.CreateDirectory(source);
        File.WriteAllText(Path.Combine(source, "autosave.hoi4"), "candidate");
        await RunGuiCase(async form =>
        {
            FormControl<TextBox>(form, "sourcePath").Text = source;
            FormControl<TextBox>(form, "outputPath").Text = output;
            var toggle = FormControl<Button>(form, "watchToggle");
            var status = FormControl<Label>(form, "watchStatus");
            toggle.PerformClick();
            await WaitFor(() => Directory.Exists(output));
            await Task.Delay(50);
            toggle.PerformClick();
            await WaitFor(() => status.Text == "Idle" && toggle.Enabled);
            Check(Directory.GetFiles(output, "*.hoi4").Length == 0, "Stop during stability check published a snapshot");
        }, TimeSpan.FromSeconds(2));
    }
    finally { Directory.Delete(root, true); }
}

static async Task TestGuiClose()
{
    var root = TempRoot();
    try
    {
        var source = Path.Combine(root, "source");
        var output = Path.Combine(root, "output");
        Directory.CreateDirectory(source);
        await RunGuiCase(async form =>
        {
            FormControl<TextBox>(form, "sourcePath").Text = source;
            FormControl<TextBox>(form, "outputPath").Text = output;
            FormControl<Button>(form, "watchToggle").PerformClick();
            await WaitFor(() => Directory.Exists(output));
            form.Close();
            form.Close(); // A second close request must not race disposal/cancellation.
        });
    }
    finally { Directory.Delete(root, true); }
}

static T FormControl<T>(Form form, string name) where T : Control =>
    form.Controls.Find(name, true).OfType<T>().Single();

static async Task WaitFor(Func<bool> condition)
{
    for (var attempt = 0; attempt < 100; attempt++)
    {
        if (condition()) return;
        await Task.Delay(20);
    }
    throw new Exception("Timed out waiting for the GUI state");
}

static async Task RunGuiCase(Func<SnapshotterForm, Task> scenario, TimeSpan? stabilityInterval = null)
{
    var completed = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
    var thread = new Thread(() =>
    {
        try
        {
            using var form = new SnapshotterForm(activity => new SnapshotterEngine(activity,
                pollInterval: TimeSpan.FromMilliseconds(30),
                stabilityInterval: stabilityInterval ?? TimeSpan.FromMilliseconds(30)));
            form.Shown += async (_, _) =>
            {
                try { await scenario(form); }
                catch (Exception error) { completed.TrySetException(error); }
                finally { if (!form.IsDisposed) form.Close(); }
            };
            Application.Run(form);
            completed.TrySetResult();
        }
        catch (Exception error) { completed.TrySetException(error); }
    });
    thread.SetApartmentState(ApartmentState.STA);
    thread.Start();
    await completed.Task.WaitAsync(TimeSpan.FromSeconds(10));
    Check(thread.Join(TimeSpan.FromSeconds(2)), "GUI message loop remained alive after close");
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

static SnapshotterEngine FastEngine(Func<DateTime>? clock = null, Action<SnapshotActivity>? activity = null) =>
    new(activity, pollInterval: TimeSpan.FromMilliseconds(10), stabilityInterval: TimeSpan.FromMilliseconds(10), clock: clock);
