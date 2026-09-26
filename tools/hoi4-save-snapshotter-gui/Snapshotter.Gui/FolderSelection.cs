namespace Snapshotter.Gui;

internal static class FolderSelection
{
    internal static string? Choose(string currentPath, Func<string?, (DialogResult Result, string? Path)> showDialog)
    {
        // A stale or inaccessible configured path must not be handed to the shell dialog.
        var initialPath = !string.IsNullOrWhiteSpace(currentPath) && Directory.Exists(currentPath)
            ? currentPath
            : null;
        var (result, selectedPath) = showDialog(initialPath);
        return result == DialogResult.OK && !string.IsNullOrWhiteSpace(selectedPath) && Directory.Exists(selectedPath)
            ? selectedPath
            : null;
    }
}
