using Snapshotter.Core;

namespace Snapshotter.Gui;

public sealed class SnapshotterForm : Form
{
    private readonly TextBox _source = new() { Name = "sourcePath", Dock = DockStyle.Fill };
    private readonly TextBox _output = new() { Name = "outputPath", Dock = DockStyle.Fill };
    private readonly Label _sourceHint = new() { AutoSize = true };
    private readonly Label _status = new() { Name = "watchStatus", AutoSize = true, Text = "Idle" };
    private readonly Label _last = new() { AutoSize = true, Text = "None yet" };
    private readonly Label _count = new() { AutoSize = true, Text = "0" };
    private readonly Label _activity = new() { AutoEllipsis = true, Dock = DockStyle.Fill, Text = "Ready to watch HoI4 autosaves." };
    private readonly Button _sourceBrowse = new() { Name = "sourceBrowse", Text = "Browse...", AutoSize = true };
    private readonly Button _outputBrowse = new() { Name = "outputBrowse", Text = "Browse...", AutoSize = true };
    private readonly Button _toggle = new() { Name = "watchToggle", Text = "Start watching", AutoSize = true };
    private readonly Func<Action<SnapshotActivity>, SnapshotterEngine> _engineFactory;
    private CancellationTokenSource? _watchCancellation;
    private Task? _watchTask;
    private bool _closing;
    private int _created;

    public SnapshotterForm(Func<Action<SnapshotActivity>, SnapshotterEngine>? engineFactory = null)
    {
        _engineFactory = engineFactory ?? (activity => new SnapshotterEngine(activity));
        Text = "HoI4 Campaign Snapshotter";
        MinimumSize = new Size(620, 560);
        Size = new Size(760, 620);
        StartPosition = FormStartPosition.CenterScreen;
        Font = new Font("Segoe UI", 10);

        var documents = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
        var detected = string.IsNullOrWhiteSpace(documents) ? null : SnapshotPaths.DetectSource(documents);
        _source.Text = detected ?? string.Empty;
        _sourceHint.Text = detected is null ? "Save folder not detected. Use Browse to choose it." : "Detected from your Windows Documents folder. You can change it.";
        _output.Text = string.IsNullOrWhiteSpace(documents) ? string.Empty : SnapshotPaths.DocumentsOutputFolder(documents);

        var layout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(20),
            ColumnCount = 2,
            RowCount = 12,
            AutoScroll = true
        };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        for (var row = 0; row < layout.RowCount; row++) layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        Controls.Add(layout);

        AddFullRow(layout, 0, new Label { Text = "HoI4 Campaign Snapshotter", Font = new Font(Font, FontStyle.Bold), AutoSize = true });
        AddFullRow(layout, 1, new Label { Text = "HoI4 save folder", AutoSize = true });
        layout.Controls.Add(_source, 0, 2);
        layout.Controls.Add(_sourceBrowse, 1, 2);
        AddFullRow(layout, 3, _sourceHint);
        AddFullRow(layout, 4, new Label { Text = "Snapshot folder (outside the save folder)", AutoSize = true });
        layout.Controls.Add(_output, 0, 5);
        layout.Controls.Add(_outputBrowse, 1, 5);
        AddFullRow(layout, 6, _toggle);
        AddFullRow(layout, 7, new Label { Text = "Status:", AutoSize = true });
        AddFullRow(layout, 8, _status);
        AddFullRow(layout, 9, new Label { Text = "Last snapshot / snapshots this run:", AutoSize = true });
        var summary = new FlowLayoutPanel { Dock = DockStyle.Fill, AutoSize = true };
        summary.Controls.Add(_last);
        summary.Controls.Add(new Label { Text = "  ·  ", AutoSize = true });
        summary.Controls.Add(_count);
        AddFullRow(layout, 10, summary);
        AddFullRow(layout, 11, _activity);

        _sourceBrowse.Click += (_, _) => Browse(_source);
        _outputBrowse.Click += (_, _) => Browse(_output);
        _toggle.Click += async (_, _) =>
        {
            try { await ToggleAsync(); }
            catch (Exception)
            {
                if (!IsDisposed && !_closing)
                    ShowError("Snapshotter encountered an unexpected problem. Stop and try again.");
            }
        };
        FormClosing += OnFormClosing;
    }

    private static void AddFullRow(TableLayoutPanel layout, int row, Control control)
    {
        control.Margin = new Padding(0, 5, 0, 5);
        layout.Controls.Add(control, 0, row);
        layout.SetColumnSpan(control, 2);
    }

    private void Browse(TextBox target)
    {
        if (_watchCancellation is not null) return;
        try
        {
            var selectedPath = FolderSelection.Choose(target.Text, initialPath =>
            {
                using var dialog = new FolderBrowserDialog { ShowNewFolderButton = true };
                if (initialPath is not null) dialog.SelectedPath = initialPath;
                return (dialog.ShowDialog(this), dialog.SelectedPath);
            });
            if (selectedPath is not null) target.Text = selectedPath;
        }
        catch (Exception)
        {
            ShowError("The folder chooser could not open. Check the folder and try again.");
        }
    }

    private async Task ToggleAsync()
    {
        if (_watchCancellation is not null)
        {
            _toggle.Enabled = false;
            _watchCancellation.Cancel();
            return;
        }

        (string Source, string Output) paths;
        try { paths = SnapshotPaths.Validate(_source.Text, _output.Text); }
        catch (SnapshotterException error) { ShowError(error.Message); return; }

        _source.Text = paths.Source;
        _output.Text = paths.Output;
        _created = 0;
        _count.Text = "0";
        _last.Text = "None yet";
        _source.Enabled = _output.Enabled = _sourceBrowse.Enabled = _outputBrowse.Enabled = false;
        _toggle.Text = "Stop watching";
        _status.Text = "Watching";
        _activity.Text = "Watching for autosaves. Leave this window open while playing.";
        var cancellation = new CancellationTokenSource();
        _watchCancellation = cancellation;
        try
        {
            var engine = _engineFactory(OnActivity);
            _watchTask = Task.Run(() => engine.WatchAsync(paths.Source, paths.Output, cancellation.Token));
            await _watchTask;
        }
        catch (OperationCanceledException error) when (
            cancellation.IsCancellationRequested && error.CancellationToken == cancellation.Token)
        {
            // User-requested Stop and form close are normal shutdown.
        }
        catch (SnapshotterException error) { ShowError(error.Message); }
        catch (Exception) { ShowError("Snapshotter could not access a folder. Check its permissions and try again."); }
        finally
        {
            _watchCancellation = null;
            _watchTask = null;
            cancellation.Dispose();
            _source.Enabled = _output.Enabled = _sourceBrowse.Enabled = _outputBrowse.Enabled = true;
            _toggle.Enabled = true;
            _toggle.Text = "Start watching";
            if (_status.Text != "Error") _status.Text = "Idle";
            if (_closing && !IsDisposed) Close();
        }
    }

    private void OnActivity(SnapshotActivity activity)
    {
        if (IsDisposed || !IsHandleCreated) return;
        BeginInvoke(() =>
        {
            if (IsDisposed) return;
            _activity.Text = activity.Message;
            if (activity.SnapshotName is null) return;
            _last.Text = activity.SnapshotName;
            _count.Text = (++_created).ToString();
        });
    }

    private void ShowError(string message)
    {
        _status.Text = "Error";
        _activity.Text = message;
        MessageBox.Show(this, message, "Snapshotter", MessageBoxButtons.OK, MessageBoxIcon.Warning);
    }

    private void OnFormClosing(object? sender, FormClosingEventArgs e)
    {
        if (_watchCancellation is null) return;
        e.Cancel = true;
        _closing = true;
        _toggle.Enabled = false;
        _watchCancellation.Cancel();
    }
}
