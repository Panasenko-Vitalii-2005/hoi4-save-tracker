# HoI4 Autosave Snapshotter

Hearts of Iron IV overwrites autosaves, which can leave too few historical files for useful Campaign Trends. This small local Windows utility preserves content-distinct autosave snapshots for later batch analysis in HoI4 Save Tracker. Private-alpha users can download the reviewed script directly from the Campaign Import panel; this repository file remains its canonical source.

## Requirements and usage

- Windows 10 or 11.
- Windows PowerShell 5.1 or PowerShell 7.
- No administrator privileges, installer, or server connection.

Download the script from Campaign Import, then open PowerShell in the folder containing `hoi4-save-snapshotter.ps1`. Browser-downloaded `.ps1` files may be blocked by Windows because they came from the Internet or are not digitally signed. If that happens, review the script if desired and unblock only this downloaded file:

```powershell
Unblock-File -LiteralPath ".\hoi4-save-snapshotter.ps1"
```

Alternatively, right-click the file in File Explorer → Properties → Unblock → Apply. Run the command below afterward. No administrator privileges or global execution-policy changes are required.

Replace `<YOUR_HOI4_SAVE_FOLDER>` with the actual HoI4 save directory on your computer; the placeholder is not a path you can run literally. The folder is usually under `Documents\Paradox Interactive\Hearts of Iron IV\save games`, but Windows may redirect Documents through OneDrive or another location.

```powershell
.\hoi4-save-snapshotter.ps1 `
  -SourceDir "<YOUR_HOI4_SAVE_FOLDER>" `
  -OutputDir "C:\HoI4Snapshots"
```

`C:\HoI4Snapshots` is the example output directory for historical snapshots. Keep it separate from the HoI4 save directory. Leave PowerShell running while playing, then select the output folder in Campaign Import.

By default `autosave.hoi4` and `autosave_*.hoi4` are watched. This covers installations where `autosave_temp.hoi4` is persistent, installations where it is transient and `autosave.hoi4` is final, and existing rotating autosave names. Manual saves are ignored. Override the defaults only when your installation uses another autosave name, for example `-Patterns 'autosave.hoi4','my_rotating_save_*.hoi4'`.

Useful options:

- `-PollIntervalSeconds 5` — interval between directory polls.
- `-StabilityIntervalSeconds 2` — interval between file stability checks.
- `-MaximumStabilityChecks 10` — bounded checks before deferring a still-changing file.
- `-Once` — process matching current files once and exit.

Press Ctrl+C to stop watch mode. Normal Ctrl+C shutdown does not write shared state and does not produce an application stack trace.

## Behavior and safety

The utility polls for filename/size/last-write changes, requires two consecutive unchanged checks, calculates SHA-256, and skips content already captured. New content is copied to a temporary file in the output directory, checksum-verified, then renamed to a chronological name such as `autosave_2026-09-20_21-15-03.hoi4`. Collisions receive `_2`, `_3`, and so on. A small `.sha256` sidecar beside each snapshot makes deduplication across restarts inexpensive. A snapshot with a missing or syntactically invalid sidecar is hashed once during startup; a sidecar containing a valid 64-character hexadecimal value is trusted as stored and is not automatically checked against the snapshot on every startup.

Some HoI4 installations briefly create `autosave_temp.hoi4` and then replace it with `autosave.hoi4`. If a candidate disappears during stability checking, the Snapshotter treats that as a normal transient write, stops waiting immediately, and returns to polling for the completed autosave. A stable `autosave_temp.hoi4` is still captured normally.

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
