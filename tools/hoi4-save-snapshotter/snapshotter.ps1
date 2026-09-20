[CmdletBinding()]
param(
    [string]$SourceDir = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Paradox Interactive\Hearts of Iron IV\save games'),
    [string]$OutputDir = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'HoI4 Save Tracker Snapshots'),
    [string[]]$Patterns = @('autosave.hoi4', 'autosave_*.hoi4'),
    [ValidateRange(1, 3600)][int]$PollIntervalSeconds = 5,
    [ValidateRange(0, 3600)][int]$StabilityIntervalSeconds = 2,
    [ValidateRange(2, 100)][int]$MaximumStabilityChecks = 10,
    [switch]$Once
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function Write-SnapshotterLog {
    param([ValidateSet('INFO', 'WARN', 'ERROR')][string]$Level, [string]$Message)
    Write-Host ('[{0}] {1}' -f $Level, $Message)
}

function Normalize-DirectoryPath {
    param([Parameter(Mandatory = $true)][string]$Path)
    $fullPath = [IO.Path]::GetFullPath($Path)
    $root = [IO.Path]::GetPathRoot($fullPath)
    if ($fullPath.Length -le $root.Length) { return $root }
    return $fullPath.TrimEnd([char[]]@(
        [IO.Path]::DirectorySeparatorChar,
        [IO.Path]::AltDirectorySeparatorChar
    ))
}

function Test-IsSameOrChildPath {
    param([string]$ParentPath, [string]$CandidatePath)
    if ($CandidatePath.Equals($ParentPath, [StringComparison]::OrdinalIgnoreCase)) { return $true }
    $prefix = $ParentPath
    if (-not $prefix.EndsWith([IO.Path]::DirectorySeparatorChar.ToString())) {
        $prefix += [IO.Path]::DirectorySeparatorChar
    }
    return $CandidatePath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)
}

function Assert-OutputPathIsSeparate {
    param([string]$SourcePath, [string]$OutputPath)
    if (Test-IsSameOrChildPath -ParentPath $SourcePath -CandidatePath $OutputPath) {
        throw 'Output directory must be separate from and outside the HoI4 save directory.'
    }
}

function Get-FileSignature {
    param([Parameter(Mandatory = $true)][string]$Path)
    try {
        $item = Get-Item -LiteralPath $Path -ErrorAction Stop
        if ($item.PSIsContainer) { return $null }
        return '{0}:{1}' -f $item.Length, $item.LastWriteTimeUtc.Ticks
    }
    catch {
        return $null
    }
}

function Get-MatchingSaveFiles {
    param([string]$Directory, [string[]]$FilePatterns)
    $seen = @{}
    foreach ($pattern in $FilePatterns) {
        foreach ($file in @(Get-ChildItem -LiteralPath $Directory -Filter $pattern -File -ErrorAction Stop)) {
            if (-not $seen.ContainsKey($file.FullName)) {
                $seen[$file.FullName] = $true
                $file
            }
        }
    }
}

function Wait-FileStable {
    param(
        [string]$Path,
        [int]$IntervalSeconds,
        [int]$MaximumChecks
    )
    $previous = Get-FileSignature -Path $Path
    if ($null -eq $previous) { return $false }
    $unchangedChecks = 0
    for ($check = 0; $check -lt $MaximumChecks; $check++) {
        if ($IntervalSeconds -gt 0) { Start-Sleep -Seconds $IntervalSeconds }
        $current = Get-FileSignature -Path $Path
        if ($null -eq $current) {
            Write-SnapshotterLog WARN 'Save temporarily unavailable, retrying...'
            $unchangedChecks = 0
            continue
        }
        if ($current -eq $previous) {
            $unchangedChecks++
            if ($unchangedChecks -ge 2) { return $true }
        }
        else {
            $unchangedChecks = 0
            $previous = $current
        }
    }
    return $false
}

function Get-Sha256 {
    param([Parameter(Mandatory = $true)][string]$Path)
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant()
}

function Get-AvailableSnapshotPath {
    param([string]$Directory, [string]$SourceName, [datetime]$Timestamp = (Get-Date))
    $safeBase = [IO.Path]::GetFileNameWithoutExtension($SourceName) -replace '[^A-Za-z0-9._-]', '_'
    if ([string]::IsNullOrWhiteSpace($safeBase)) { $safeBase = 'autosave' }
    $stem = '{0}_{1}' -f $safeBase, $Timestamp.ToString('yyyy-MM-dd_HH-mm-ss')
    $candidate = Join-Path $Directory ($stem + '.hoi4')
    $suffix = 2
    while (Test-Path -LiteralPath $candidate) {
        $candidate = Join-Path $Directory ('{0}_{1}.hoi4' -f $stem, $suffix)
        $suffix++
    }
    return $candidate
}

function Import-KnownHashes {
    param([string]$Directory)
    $hashes = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($snapshot in @(Get-ChildItem -LiteralPath $Directory -Filter '*.hoi4' -File -ErrorAction Stop)) {
        $sidecar = $snapshot.FullName + '.sha256'
        $hash = $null
        if (Test-Path -LiteralPath $sidecar -PathType Leaf) {
            $candidate = (Get-Content -LiteralPath $sidecar -Raw -ErrorAction SilentlyContinue).Trim()
            if ($candidate -match '^[0-9a-fA-F]{64}$') { $hash = $candidate.ToLowerInvariant() }
        }
        if ($null -eq $hash) {
            try { $hash = Get-Sha256 -Path $snapshot.FullName }
            catch { Write-SnapshotterLog WARN ('Could not read existing snapshot hash: {0}' -f $snapshot.Name) }
        }
        if ($null -ne $hash) { [void]$hashes.Add($hash) }
    }
    return ,$hashes
}

function Write-HashSidecar {
    param([string]$SnapshotPath, [string]$Hash)
    $sidecar = $SnapshotPath + '.sha256'
    $temporary = $sidecar + '.tmp-' + [Guid]::NewGuid().ToString('N')
    try {
        [IO.File]::WriteAllText($temporary, $Hash + [Environment]::NewLine, [Text.Encoding]::ASCII)
        Move-Item -LiteralPath $temporary -Destination $sidecar -ErrorAction Stop
    }
    finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue }
    }
}

function New-SaveSnapshot {
    param([string]$SourcePath, [string]$DestinationDirectory, $KnownHashes)
    $sourceSignature = Get-FileSignature -Path $SourcePath
    if ($null -eq $sourceSignature) { throw 'Source save is temporarily unavailable.' }
    $sourceHash = Get-Sha256 -Path $SourcePath
    if ($KnownHashes.Contains($sourceHash)) {
        Write-SnapshotterLog INFO 'Duplicate content, skipped'
        return $null
    }

    $destination = Get-AvailableSnapshotPath -Directory $DestinationDirectory -SourceName ([IO.Path]::GetFileName($SourcePath))
    $temporary = Join-Path $DestinationDirectory ('.snapshot-' + [Guid]::NewGuid().ToString('N') + '.tmp')
    try {
        Copy-Item -LiteralPath $SourcePath -Destination $temporary -ErrorAction Stop
        if ((Get-FileSignature -Path $SourcePath) -ne $sourceSignature) {
            throw 'Source save changed during snapshot creation; it will be retried.'
        }
        $copyHash = Get-Sha256 -Path $temporary
        if ($copyHash -ne $sourceHash) { throw 'Snapshot checksum did not match the source save.' }
        Move-Item -LiteralPath $temporary -Destination $destination -ErrorAction Stop
        [void]$KnownHashes.Add($sourceHash)
        Write-HashSidecar -SnapshotPath $destination -Hash $sourceHash
        Write-SnapshotterLog INFO ('Snapshot created: {0}' -f ([IO.Path]::GetFileName($destination)))
        return $destination
    }
    finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue }
    }
}

function Invoke-SnapshotCandidate {
    param([IO.FileInfo]$File, [string]$DestinationDirectory, $KnownHashes, [int]$StableSeconds, [int]$MaximumChecks)
    Write-SnapshotterLog INFO ('Change detected: {0}' -f $File.Name)
    Write-SnapshotterLog INFO 'Waiting for stable file...'
    if (-not (Wait-FileStable -Path $File.FullName -IntervalSeconds $StableSeconds -MaximumChecks $MaximumChecks)) {
        Write-SnapshotterLog WARN ('File did not become stable in time: {0}' -f $File.Name)
        return $false
    }
    try {
        [void](New-SaveSnapshot -SourcePath $File.FullName -DestinationDirectory $DestinationDirectory -KnownHashes $KnownHashes)
        return $true
    }
    catch {
        Write-SnapshotterLog ERROR ('Failed to create snapshot: {0}' -f $_.Exception.Message)
        return $false
    }
}

function Start-Hoi4SaveSnapshotter {
    param([string]$Source, [string]$Output, [string[]]$FilePatterns, [int]$PollSeconds, [int]$StableSeconds, [int]$MaximumChecks, [bool]$RunOnce)
    if (-not (Test-Path -LiteralPath $Source -PathType Container)) { throw "Source directory does not exist: $Source" }
    $sourceFull = Normalize-DirectoryPath -Path (Get-Item -LiteralPath $Source).FullName
    if (-not (Test-Path -LiteralPath $Output)) { [void](New-Item -ItemType Directory -Path $Output -Force) }
    if (-not (Test-Path -LiteralPath $Output -PathType Container)) { throw "Output path is not a directory: $Output" }
    $outputFull = Normalize-DirectoryPath -Path (Get-Item -LiteralPath $Output).FullName
    Assert-OutputPathIsSeparate -SourcePath $sourceFull -OutputPath $outputFull
    if ($FilePatterns.Count -eq 0) { throw 'At least one filename pattern is required.' }

    $knownHashes = Import-KnownHashes -Directory $outputFull
    $observed = @{}
    Write-SnapshotterLog INFO ('Watching: {0}' -f $sourceFull)
    Write-SnapshotterLog INFO ('Output: {0}' -f $outputFull)

    do {
        $files = @()
        try { $files = @(Get-MatchingSaveFiles -Directory $sourceFull -FilePatterns $FilePatterns) }
        catch {
            Write-SnapshotterLog WARN ('Could not scan save directory; retrying: {0}' -f $_.Exception.Message)
        }
        foreach ($file in $files) {
            $signature = Get-FileSignature -Path $file.FullName
            if ($RunOnce -or -not $observed.ContainsKey($file.FullName) -or $observed[$file.FullName] -ne $signature) {
                $processed = Invoke-SnapshotCandidate -File $file -DestinationDirectory $outputFull -KnownHashes $knownHashes -StableSeconds $StableSeconds -MaximumChecks $MaximumChecks
                if ($processed) { $observed[$file.FullName] = Get-FileSignature -Path $file.FullName }
            }
        }
        if (-not $RunOnce) { Start-Sleep -Seconds $PollSeconds }
    } while (-not $RunOnce)
}

if ($MyInvocation.InvocationName -ne '.') {
    try {
        Start-Hoi4SaveSnapshotter -Source $SourceDir -Output $OutputDir -FilePatterns $Patterns -PollSeconds $PollIntervalSeconds -StableSeconds $StabilityIntervalSeconds -MaximumChecks $MaximumStabilityChecks -RunOnce ([bool]$Once)
    }
    catch {
        Write-SnapshotterLog ERROR $_.Exception.Message
        exit 1
    }
}
