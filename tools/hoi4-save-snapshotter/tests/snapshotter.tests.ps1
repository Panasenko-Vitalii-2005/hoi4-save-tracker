Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path $PSScriptRoot -Parent) 'snapshotter.ps1')

$script:Passed = 0
$script:Failed = 0
function Assert-True { param([bool]$Condition, [string]$Message) if (-not $Condition) { throw $Message } }
function Invoke-Test {
    param([string]$Name, [scriptblock]$Body)
    try { & $Body; $script:Passed++; Write-Host "[PASS] $Name" }
    catch { $script:Failed++; Write-Host "[FAIL] $Name - $($_.Exception.Message)" }
}
function New-TestDirectory {
    $path = Join-Path ([IO.Path]::GetTempPath()) ('hoi4-snapshotter-test-' + [Guid]::NewGuid().ToString('N'))
    [void](New-Item -ItemType Directory -Path $path)
    return $path
}

Invoke-Test 'filters default autosave patterns' {
    $root = New-TestDirectory
    try {
        Set-Content -LiteralPath (Join-Path $root 'autosave.hoi4') -Value 'a'
        Set-Content -LiteralPath (Join-Path $root 'autosave_1.hoi4') -Value 'b'
        Set-Content -LiteralPath (Join-Path $root 'autosave_temp.hoi4') -Value 'temp'
        Set-Content -LiteralPath (Join-Path $root 'manual.hoi4') -Value 'c'
        $names = @(Get-MatchingSaveFiles $root @('autosave.hoi4', 'autosave_*.hoi4') | ForEach-Object Name)
        Assert-True ($names.Count -eq 3) 'Expected persistent, rotating, and temporary-named autosaves.'
        Assert-True ($names -contains 'autosave_temp.hoi4') 'autosave_temp.hoi4 was not included.'
        Assert-True ($names -notcontains 'manual.hoi4') 'Manual save was included.'
    } finally { Remove-Item -LiteralPath $root -Recurse -Force }
}

Invoke-Test 'normalizes ordinary source and output paths' {
    $root = New-TestDirectory
    try {
        $source = Join-Path $root 'source'; $output = Join-Path $root 'output'
        [void](New-Item -ItemType Directory -Path $source); [void](New-Item -ItemType Directory -Path $output)
        $normalizedSource = Normalize-DirectoryPath ($source + [IO.Path]::DirectorySeparatorChar)
        $normalizedOutput = Normalize-DirectoryPath ($output + [IO.Path]::DirectorySeparatorChar)
        Assert-True ($normalizedSource -eq [IO.Path]::GetFullPath($source)) 'Normal source path retained a trailing separator.'
        Assert-True ($normalizedOutput -eq [IO.Path]::GetFullPath($output)) 'Normal output path retained a trailing separator.'
        Assert-OutputPathIsSeparate $normalizedSource $normalizedOutput
    } finally { Remove-Item -LiteralPath $root -Recurse -Force }
}

Invoke-Test 'preserves a Windows drive root during normalization' {
    $driveRoot = [IO.Path]::GetPathRoot((Get-Location).Path)
    $normalized = Normalize-DirectoryPath $driveRoot
    Assert-True ($normalized -eq $driveRoot) "Drive root changed from '$driveRoot' to '$normalized'."
    Assert-True ($normalized.EndsWith([IO.Path]::DirectorySeparatorChar.ToString())) 'Drive root lost its separator.'
}

Invoke-Test 'rejects equal and child output paths while allowing a sibling' {
    $root = Normalize-DirectoryPath (New-TestDirectory)
    try {
        $child = Normalize-DirectoryPath (Join-Path $root 'snapshots')
        $sibling = Normalize-DirectoryPath ($root + '-sibling')
        $equalRejected = $false; $childRejected = $false
        try { Assert-OutputPathIsSeparate $root $root } catch { $equalRejected = $true }
        try { Assert-OutputPathIsSeparate $root $child } catch { $childRejected = $true }
        Assert-True $equalRejected 'Equal source/output paths were accepted.'
        Assert-True $childRejected 'Output nested under source was accepted.'
        Assert-OutputPathIsSeparate $root $sibling
    } finally { Remove-Item -LiteralPath $root -Recurse -Force }
}

Invoke-Test 'generates chronological collision-safe names' {
    $root = New-TestDirectory
    try {
        $time = [datetime]'2026-09-20T21:15:03'
        $first = Get-AvailableSnapshotPath $root 'autosave_1.hoi4' $time
        Assert-True ($first.EndsWith('autosave_1_2026-09-20_21-15-03.hoi4')) 'Unexpected snapshot name.'
        Set-Content -LiteralPath $first -Value 'occupied'
        $second = Get-AvailableSnapshotPath $root 'autosave_1.hoi4' $time
        Assert-True ($second.EndsWith('_2.hoi4')) 'Collision suffix was not added.'
    } finally { Remove-Item -LiteralPath $root -Recurse -Force }
}

Invoke-Test 'hashes, deduplicates, preserves source, and captures changed content' {
    $root = New-TestDirectory
    try {
        $sourceDir = Join-Path $root 'source'; $outputDir = Join-Path $root 'output'
        [void](New-Item -ItemType Directory -Path $sourceDir); [void](New-Item -ItemType Directory -Path $outputDir)
        $source = Join-Path $sourceDir 'autosave.hoi4'
        [IO.File]::WriteAllText($source, 'content A')
        $hashes = Import-KnownHashes $outputDir
        Assert-True ((Wait-FileStable $source 0 2) -eq 'Stable') 'Stable file was not detected.'
        [void](New-SaveSnapshot $source $outputDir $hashes)
        $originalHash = Get-Sha256 $source
        [void](New-SaveSnapshot $source $outputDir $hashes)
        Assert-True (@(Get-ChildItem $outputDir -Filter '*.hoi4').Count -eq 1) 'Identical content created a duplicate.'
        [IO.File]::WriteAllText($source, 'content B')
        [void](New-SaveSnapshot $source $outputDir $hashes)
        Assert-True (@(Get-ChildItem $outputDir -Filter '*.hoi4').Count -eq 2) 'Changed content was not captured.'
        Assert-True ((Get-Content $source -Raw) -eq 'content B') 'Source content changed unexpectedly.'
        Assert-True ($originalHash -ne (Get-Sha256 $source)) 'Source hash did not change with content.'
        Assert-True (@(Get-ChildItem $outputDir -Filter '*.sha256').Count -eq 2) 'Checksum metadata was not created.'
    } finally { Remove-Item -LiteralPath $root -Recurse -Force }
}

Invoke-Test 'recovers deduplication hashes after restart' {
    $root = New-TestDirectory
    try {
        $source = Join-Path $root 'autosave.hoi4'; $output = Join-Path $root 'output'
        [void](New-Item -ItemType Directory -Path $output); [IO.File]::WriteAllText($source, 'same')
        $first = Import-KnownHashes $output; [void](New-SaveSnapshot $source $output $first)
        $reloaded = Import-KnownHashes $output; [void](New-SaveSnapshot $source $output $reloaded)
        Assert-True (@(Get-ChildItem $output -Filter '*.hoi4').Count -eq 1) 'Restart created a duplicate.'
    } finally { Remove-Item -LiteralPath $root -Recurse -Force }
}

Invoke-Test 'temporary sharing violation does not crash or alter the source' {
    $root = New-TestDirectory
    try {
        $output = Join-Path $root 'output'; [void](New-Item -ItemType Directory -Path $output)
        $source = Join-Path $root 'autosave.hoi4'; [IO.File]::WriteAllText($source, 'locked content')
        $hashes = Import-KnownHashes $output
        $lock = [IO.File]::Open($source, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
        try {
            $processed = Invoke-SnapshotCandidate (Get-Item $source) $output $hashes 0 2
            Assert-True (-not $processed) 'Locked source was incorrectly marked processed.'
            Assert-True (@(Get-ChildItem $output -Filter '*.hoi4').Count -eq 0) 'Locked source created a snapshot.'
        } finally { $lock.Dispose() }
        $processed = Invoke-SnapshotCandidate (Get-Item $source) $output $hashes 0 2
        Assert-True $processed 'Unlocked source was not marked processed.'
        Assert-True (@(Get-ChildItem $output -Filter '*.hoi4').Count -eq 1) 'Unlocked source was not captured.'
        Assert-True ([IO.File]::ReadAllText($source) -eq 'locked content') 'Source was altered.'
    } finally { Remove-Item -LiteralPath $root -Recurse -Force }
}

Invoke-Test 'one-shot mode creates output and leaves manual saves untouched' {
    $root = New-TestDirectory
    try {
        $source = Join-Path $root 'source'; $output = Join-Path $root 'new-output'
        [void](New-Item -ItemType Directory -Path $source)
        [IO.File]::WriteAllText((Join-Path $source 'autosave.hoi4'), 'autosave')
        [IO.File]::WriteAllText((Join-Path $source 'manual.hoi4'), 'manual')
        Start-Hoi4SaveSnapshotter $source $output @('autosave.hoi4', 'autosave_*.hoi4') 1 0 2 $true
        Assert-True (Test-Path $output -PathType Container) 'Output directory was not created.'
        Assert-True (@(Get-ChildItem $output -Filter '*.hoi4').Count -eq 1) 'One-shot output count was incorrect.'
        Assert-True (Test-Path (Join-Path $source 'manual.hoi4')) 'Manual save was changed.'
    } finally { Remove-Item -LiteralPath $root -Recurse -Force }
}

Invoke-Test 'persistent autosave_temp is captured with default-compatible patterns' {
    $root = New-TestDirectory
    try {
        $source = Join-Path $root 'source'; $output = Join-Path $root 'output'
        [void](New-Item -ItemType Directory -Path $source)
        [IO.File]::WriteAllText((Join-Path $source 'autosave_temp.hoi4'), 'persistent temp layout')
        Start-Hoi4SaveSnapshotter $source $output @('autosave.hoi4', 'autosave_*.hoi4') 1 0 2 $true
        $snapshots = @(Get-ChildItem $output -Filter '*.hoi4')
        Assert-True ($snapshots.Count -eq 1) 'Persistent autosave_temp.hoi4 was not captured.'
        Assert-True ($snapshots[0].Name.StartsWith('autosave_temp_')) 'Unexpected autosave_temp snapshot name.'
    } finally { Remove-Item -LiteralPath $root -Recurse -Force }
}

Invoke-Test 'disappeared candidate exits stability checking immediately' {
    $root = New-TestDirectory
    try {
        $source = Join-Path $root 'autosave_temp.hoi4'
        [IO.File]::WriteAllText($source, 'transient')
        $script:TestSignatureCalls = 0
        $status = & {
            function Get-FileSignature {
                param([string]$Path)
                $script:TestSignatureCalls++
                if ($script:TestSignatureCalls -eq 1) { return '9:1' }
                if (Test-Path -LiteralPath $Path) { Remove-Item -LiteralPath $Path -Force }
                return $null
            }
            Wait-FileStable $source 0 10
        }
        Assert-True ($status -eq 'Disappeared') 'Disappeared candidate returned the wrong stability status.'
        Assert-True ($script:TestSignatureCalls -eq 2) 'Stability checking continued after disappearance.'
    } finally { Remove-Item -LiteralPath $root -Recurse -Force }
}

Invoke-Test 'disappeared temp is informational and does not block completed autosave' {
    $root = New-TestDirectory
    try {
        $sourceDir = Join-Path $root 'source'; $output = Join-Path $root 'output'
        [void](New-Item -ItemType Directory -Path $sourceDir)
        [void](New-Item -ItemType Directory -Path $output)
        $temporary = Join-Path $sourceDir 'autosave_temp.hoi4'
        [IO.File]::WriteAllText($temporary, 'transient')
        $temporaryFile = Get-Item $temporary
        $hashes = Import-KnownHashes $output
        $script:TestSignatureCalls = 0
        $script:TransientProcessed = $true
        $messages = @(& {
            function Get-FileSignature {
                param([string]$Path)
                $script:TestSignatureCalls++
                if ($script:TestSignatureCalls -eq 1) { return '9:1' }
                if (Test-Path -LiteralPath $Path) { Remove-Item -LiteralPath $Path -Force }
                return $null
            }
            $script:TransientProcessed = Invoke-SnapshotCandidate $temporaryFile $output $hashes 0 10
        } 6>&1)
        $messageText = ($messages | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine
        Assert-True (-not $script:TransientProcessed) 'Disappeared temporary save was marked processed.'
        Assert-True ($messageText.Contains('[INFO] Save disappeared during write; waiting for completed autosave...')) 'Disappearance INFO message was not emitted.'
        Assert-True (-not $messageText.Contains('[WARN]')) 'Disappearing save emitted a warning.'
        Assert-True ($script:TestSignatureCalls -eq 2) 'Candidate was retried after disappearance.'

        $completed = Join-Path $sourceDir 'autosave.hoi4'
        [IO.File]::WriteAllText($completed, 'completed autosave')
        $processed = Invoke-SnapshotCandidate (Get-Item $completed) $output $hashes 0 2
        Assert-True $processed 'Subsequent autosave.hoi4 was not processed.'
        Assert-True (@(Get-ChildItem $output -Filter '*.hoi4').Count -eq 1) 'Subsequent autosave snapshot was not created exactly once.'
    } finally { Remove-Item -LiteralPath $root -Recurse -Force }
}

Write-Host ("Tests: {0} passed, {1} failed" -f $script:Passed, $script:Failed)
if ($script:Failed -gt 0) { exit 1 }
