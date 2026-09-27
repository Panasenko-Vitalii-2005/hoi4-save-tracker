# HoI4 Campaign Snapshotter for Windows

A small, local Windows GUI for preserving historical HoI4 autosaves. It is the recommended Campaign Import download; the proven [PowerShell Snapshotter](../hoi4-save-snapshotter/README.md) remains an advanced fallback and behavioral reference.

## Architecture and build

C#/.NET 9 Windows Forms supplies the native window. `Snapshotter.Core` implements polling, stability checks, SHA-256 deduplication and safe publication without invoking PowerShell. `Snapshotter.Tests` is a dependency-free synthetic-file test runner. This avoids Electron, Node.js and a manually installed runtime for end users. The portable self-contained single-file release is larger than a native C++ binary, but keeps the implementation small, testable and maintainable with the SDK available in this repository's Windows development environment.

From this directory on a Windows build machine with the .NET 9 SDK:

```powershell
dotnet run --project .\Snapshotter.Tests\Snapshotter.Tests.csproj
dotnet publish .\Snapshotter.Gui\Snapshotter.Gui.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true -p:DebugType=none
```

The portable `Snapshotter.Gui.exe` appears in `Snapshotter.Gui\bin\Release\net9.0-windows\win-x64\publish`. Only the executable needs to be distributed; build folders and binaries are not committed. The release is Windows x64 and needs no separate .NET/Node/Python installation or administrator privileges. It is not code-signed: Windows SmartScreen may warn about an unknown publisher. Do not disable Windows security protections to run it.

## Release distribution

The tag-only GitHub Actions workflow at `.github/workflows/snapshotter-release.yml` runs on a `snapshotter-vMAJOR.MINOR.PATCH` tag, for example `snapshotter-v0.1.1`. It checks out that exact tag, installs .NET 9 SDK `9.0.316`, runs `Snapshotter.Tests`, and publishes a Release/win-x64/self-contained/single-file executable with the same flags shown above. It uploads exactly `Snapshotter.Gui.exe` and `Snapshotter.Gui.exe.sha256` to a non-draft, non-prerelease GitHub Release and marks it latest. The tag identifies the version; the EXE is never committed to normal Git history. The checksum is available beside the EXE in the release assets.

After testing and committing an update, the future release sequence is:

```powershell
git push origin main
git tag snapshotter-v0.1.1
git push origin snapshotter-v0.1.1
```

Replace the example version with the next intended version. Wait for the release workflow to pass, then verify both assets and their checksum on GitHub. The existing website button uses:

`https://github.com/Panasenko-Vitalii-2005/hoi4-save-tracker/releases/latest/download/Snapshotter.Gui.exe`

GitHub's `latest` is **repository-wide**, not Snapshotter-specific: a later unrelated release marked latest without this asset would break that URL. Keep the newest Snapshotter release marked latest, or revisit the distribution URL before publishing unrelated releases. Drafts and prereleases do not become latest; the first GUI release must be published before deploying the new web button. There is no in-app updater or network access in the GUI.

For an emergency manual build, run the test and `dotnet publish` commands above on Windows with .NET SDK `9.0.316`, then compute the EXE's SHA-256 with `Get-FileHash -Algorithm SHA256`. Once a corresponding tag is pushed, an operator can attach the EXE and checksum to that tag's GitHub Release with `gh release create <tag> <path-to-Snapshotter.Gui.exe> <path-to-Snapshotter.Gui.exe.sha256> --verify-tag --title <title> --notes <notes> --latest`. Verify the release assets before directing users to them. Do not distribute an untested local build as if it came from the tagged workflow.

## Use

1. Launch the built executable. It checks the Windows **Documents known folder**, including redirected/OneDrive Documents, for `Paradox Interactive\Hearts of Iron IV\save games`. If the folder is not present, choose it with **Browse**; no arbitrary-drive scan occurs.
2. Accept or change the default snapshot folder under Documents. It must be outside the HoI4 save folder and is created when Start is pressed.
3. Click **Start watching**, leave the window open while playing, and check the status, latest snapshot and session count.
4. Click **Stop watching** before closing. Closing while watching also cancels the watcher cleanly.
5. Later, select the snapshot folder in Campaign Import. The GUI itself never uploads data.

The defaults watch `autosave.hoi4` and `autosave_*.hoi4`, including installations where `autosave_temp.hoi4` is persistent or disappears before a final `autosave.hoi4` appears. Watch mode records existing eligible saves as a starting baseline without copying them; only later changes or newly appearing saves are snapshotted. Files already named like generated snapshots (`<source-base>_YYYY-MM-DD_HH-mm-ss.hoi4`, optionally with a numeric collision suffix) are ignored if they appear in the source folder. A candidate must have an unchanged size and last-write time across two checks. Disappearing temporary candidates are informational and do not block the next save. Identical SHA-256 content is skipped, including after restart. Each published snapshot has a timestamped `.hoi4` name and matching `.hoi4.sha256` sidecar; collisions receive `_2`, `_3`, etc. A valid 64-hex existing sidecar is trusted during startup deduplication; a missing or malformed one is recovered by hashing the snapshot. Source saves are opened read-only, copied to a temporary file, checked against the source signature and hash, and then moved to the final name.

No network calls, telemetry, API access, authentication, cloud sync or automatic uploads exist. The application does not change PowerShell policy, the registry, firewall, Defender or system PATH.

## Manual Windows acceptance

On a fresh Windows user account, launch the built artifact, verify that the HoI4 folder is detected or choose it, choose a separate output folder, click Start, play until an autosave is written, check that a `.hoi4` and matching `.sha256` appear and the count increases, then Stop and close. Repeat with redirected/OneDrive Documents if such a machine is available. Test both a persistent `autosave_temp.hoi4` layout and a transient-temp/final-`autosave.hoi4` layout where possible.
