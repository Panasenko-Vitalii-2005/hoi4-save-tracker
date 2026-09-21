# HoI4 Autosave Snapshotter

Hearts of Iron IV overwrites autosaves, which can leave too few historical files for useful Campaign Trends. This small local Windows utility preserves content-distinct autosave snapshots for later batch analysis in HoI4 Save Tracker.

## Requirements and usage

- Windows 10 or 11.
- Windows PowerShell 5.1 or PowerShell 7.
- No administrator privileges, installer, or server connection.

From a PowerShell window:

```powershell
cd D:\custom-projects\save-tracker\tools\hoi4-save-snapshotter
.\snapshotter.ps1 `
  -SourceDir "$HOME\Documents\Paradox Interactive\Hearts of Iron IV\save games" `
  -OutputDir "D:\HoI4Snapshots"
```

The defaults use the current user's Documents folder for both the standard HoI4 save location and a separate `HoI4 Save Tracker Snapshots` directory. The source path is validated; pass `-SourceDir` explicitly when Documents is redirected or the game uses another location.

By default only `autosave.hoi4` and `autosave_*.hoi4` are watched. Manual saves are ignored. Override this with, for example, `-Patterns 'autosave.hoi4','my_rotating_save_*.hoi4'`.

Useful options:

- `-PollIntervalSeconds 5` — interval between directory polls.
- `-StabilityIntervalSeconds 2` — interval between file stability checks.
- `-MaximumStabilityChecks 10` — bounded checks before deferring a still-changing file.
- `-Once` — process matching current files once and exit.

Press Ctrl+C to stop watch mode. Normal Ctrl+C shutdown does not write shared state and does not produce an application stack trace.

## Behavior and safety

The utility polls for filename/size/last-write changes, requires two consecutive unchanged checks, calculates SHA-256, and skips content already captured. New content is copied to a temporary file in the output directory, checksum-verified, then renamed to a chronological name such as `autosave_2026-09-20_21-15-03.hoi4`. Collisions receive `_2`, `_3`, and so on. A small `.sha256` sidecar beside each snapshot makes deduplication across restarts inexpensive. A snapshot with a missing or syntactically invalid sidecar is hashed once during startup; a sidecar containing a valid 64-character hexadecimal value is trusted as stored and is not automatically checked against the snapshot on every startup.

Source saves are opened only for reading. They are never modified, moved, renamed, truncated, or deleted. The output directory must be separate from and outside the source directory. Copy errors, locks, sharing violations, and temporary read failures are logged without changing the source or terminating watch mode. Existing snapshots are never deleted and there is no retention policy.

Run the tool while playing and allow snapshots to accumulate. In HoI4 Save Tracker's campaign import, choose **Select snapshot folder** and keep the recommended 25-file sample, choose another density, or choose **All**. Direct `.hoi4` snapshots are included; checksum sidecars and nested folders are ignored. Sampling is based on chronological snapshot capture order; exact game dates are extracted during analysis, and previously analyzed snapshots are reused.

## Tests and local validation

Run the dependency-free tests with either supported shell:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tests\snapshotter.tests.ps1
pwsh -NoProfile -File .\tests\snapshotter.tests.ps1
```

Manual validation without launching HoI4:

1. Create empty temporary source and output directories.
2. Start the snapshotter with those explicit paths and a one-second polling/stability interval.
3. Create `autosave.hoi4` with content A and confirm one snapshot appears.
4. rewrite or touch it with identical content A and confirm no second snapshot appears.
5. Replace it with content B and confirm a second snapshot appears.
6. Confirm the source still exists with content B and was not renamed or moved.
7. Stop with Ctrl+C, restart, touch identical content B, and confirm no duplicate appears.

## MVP limitations

This is not a GUI, tray application, Windows service, installer, or automatic-start tool. Its PowerShell window must remain open. It has no upload, cloud sync, compression, retention cleanup, automatic deletion, telemetry, parsing, or campaign logic. It uses polling and local filesystem copies only. A power loss during an active copy can leave a hidden `.snapshot-*.tmp` file in the output directory; published `.hoi4` snapshots are only created after checksum verification.
