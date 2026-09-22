namespace Snapshotter.Core;

public static class SnapshotPaths
{
    public static string DocumentsSaveFolder(string documentsPath) =>
        Path.Combine(documentsPath, "Paradox Interactive", "Hearts of Iron IV", "save games");

    public static string DocumentsOutputFolder(string documentsPath) =>
        Path.Combine(documentsPath, "HoI4Snapshots");

    public static string? DetectSource(string documentsPath)
    {
        var candidate = DocumentsSaveFolder(documentsPath);
        return Directory.Exists(candidate) ? candidate : null;
    }

    public static (string Source, string Output) Validate(string source, string output)
    {
        if (string.IsNullOrWhiteSpace(source) || !Directory.Exists(source))
            throw new SnapshotterException("The HoI4 save folder could not be found. Choose the folder that contains your HoI4 saves.");
        if (string.IsNullOrWhiteSpace(output))
            throw new SnapshotterException("Choose a snapshot folder outside the HoI4 save folder.");

        string sourceFull;
        string outputFull;
        try
        {
            sourceFull = Path.TrimEndingDirectorySeparator(Path.GetFullPath(source));
            outputFull = Path.TrimEndingDirectorySeparator(Path.GetFullPath(output));
        }
        catch (Exception error) when (error is ArgumentException or NotSupportedException or PathTooLongException)
        {
            throw new SnapshotterException("One of the selected folder paths is invalid. Choose the folders again.", error);
        }

        if (outputFull.Equals(sourceFull, StringComparison.OrdinalIgnoreCase) ||
            outputFull.StartsWith(Path.EndsInDirectorySeparator(sourceFull) ? sourceFull : sourceFull + Path.DirectorySeparatorChar,
                StringComparison.OrdinalIgnoreCase))
            throw new SnapshotterException("The snapshot folder must be separate from and outside the HoI4 save folder.");

        return (sourceFull, outputFull);
    }
}
