# NeuroMD MVP

NeuroMD is a local, read-only terminal Markdown viewer. A small Rust WebAssembly
module parses and renders Markdown; Deno supplies the terminal UI and capability
sandbox. It is a desktop terminal application, not a website, browser shell, or
background web service.

![NeuroMD terminal splash screen](docs/splash_screen.png)

The current source version is **v0.4.1**. The version is also shown subtly in the
startup ident so screenshots and bug reports can identify the running build.

## macOS quick start

The viewer works from source on both Apple Silicon and Intel Macs. It uses the
checked-in `neuromd_engine.wasm`, so users need Deno but do **not** need Rust,
Node.js, Docker, Python, or a build step.

1. Open Terminal or iTerm and install Deno 2.3 or newer:

   ```bash
   brew install deno
   ```

   If Homebrew is not installed, use the official Deno installer instead:

   ```bash
   curl -fsSL https://deno.land/install.sh | sh
   ```

   Open a new terminal after installation, then check it with `deno --version`.

2. Download and unzip this repository, or clone it:

   ```bash
   git clone https://github.com/d-b-w-gain/neuromd.git
   cd neuromd
   ```

3. Open the demo:

   ```bash
   deno task view -- ./demo.md
   ```

   Open any Markdown file by passing its absolute or relative path. Keep paths
   containing spaces inside quotes:

   ```bash
   deno task view -- "$HOME/Documents/My Notes/README.md"
   ```

The splash remains visible until Enter is pressed. Press `q` to quit. The
terminal returns to its normal screen and colours when NeuroMD exits.

### Current macOS limitations

- `NeuroMD.exe`, `NeuroMD.cmd`, file-association registration, local Kokoro
  installation, and WAV playback are Windows-only.
- Markdown viewing, resizing, source/rendered views, and all navigation controls
  work on macOS.
- Pressing `s` for narration is not yet supported on macOS. A future native Mac
  package can add audio playback and Finder file association; the present Mac
  release intentionally makes no such claim.

## Windows quick start

Requirements: Windows Terminal (or another ANSI terminal) and Deno 2.3 or newer.

Install Deno once:

```powershell
winget install --id DenoLand.Deno
```

Extract the entire repository first. Double-click `NeuroMD.cmd` to open the
included demo, or drag any `.md` file onto `NeuroMD.cmd`. The launcher locates
the TypeScript, WebAssembly engine, and demo relative to itself, regardless of
PowerShell's current directory.

From PowerShell, open a file with:

```powershell
& "C:\path\to\NeuroMD\NeuroMD.cmd" "C:\path\to\README.md"
```

Or run the source task directly:

```powershell
Set-Location "C:\path\to\NeuroMD"
deno task view -- "C:\path\to\README.md"
```

The downloadable `NeuroMD.exe` is a convenience build and is not needed when
running the repository with Deno.

## Make NeuroMD an available Windows default

Double-click `Register-NeuroMD.cmd`. It registers NeuroMD as an `.md` handler
for the current Windows user and opens the correct Default Apps page. No
administrator rights are required.

On the page Windows opens, select `.md`, choose **NeuroMD**, and confirm. Windows
requires this final user choice and does not permit applications to silently
replace a default handler.

## Controls

The startup ident remains on screen until Enter is pressed.

- `j`, `k`, arrows: move one line
- `Page Down`, `Page Up`, Space: move one page
- `g`, `G`, Home, End: jump to the beginning or end
- `r`: toggle rendered Markdown and source
- `R`: reload the file
- `s`: start or stop Kokoro narration at the current top line (Windows)
- `L`: show or hide the NeuroMD logo
- `?`: show key help
- `q`, Ctrl-C: quit

## Kokoro narration on Windows

Press `s` to read from the current top line. NeuroMD requests short WAV chunks,
plays them through Windows' built-in `System.Media.SoundPlayer`, highlights the
active Kokoro word or phoneme group, and scrolls when the highlight leaves the
screen. Press `s` again to stop immediately.

If the configured Kokoro endpoint is unavailable, `s` opens an in-terminal
setup panel. Press `i` to install and run a pinned Kokoro-FastAPI release locally
without Docker. The panel reports each phase, download percentages, model
progress, installation output, and the final health check. This installer is
currently Windows-only and may cause ordinary Defender network/download scans.

For a remote or already-installed server, copy `neuromd.example.json` to
`neuromd.json`. Put it beside `neuromd.ts` when running from source, or beside
the compiled `NeuroMD.exe`, then set the base URL, voice, and speed:

```json
{
  "kokoroUrl": "http://127.0.0.1:8880",
  "voice": "af_bella",
  "speed": 1
}
```

Command-line options take precedence:

```powershell
.\NeuroMD.exe --kokoro-url http://127.0.0.1:8880 --voice af_bella --speed 1 README.md
```

NeuroMD first tries Kokoro-FastAPI's `/dev/captioned_speech` endpoint for exact
word timestamps. If a reverse proxy exposes only `/v1/audio/speech`, narration
still works and highlighting uses WAV-duration-weighted estimates. The footer
reports `EXACT WORD TIMING` or `ESTIMATED WORD TIMING` while it reads.

## Build the Rust engine

End users do not need to build anything. Developers changing `src/lib.rs` need
Rust and the WebAssembly target:

```powershell
rustup target add wasm32-unknown-unknown
cargo build --release --target wasm32-unknown-unknown
Copy-Item .\target\wasm32-unknown-unknown\release\neuromd_engine.wasm .\neuromd_engine.wasm
```

On macOS, the final copy command is:

```bash
cp target/wasm32-unknown-unknown/release/neuromd_engine.wasm ./neuromd_engine.wasm
```

The checked-in `neuromd_engine.wasm` is the only Rust build artifact required at
runtime.

## Continuous integration

Pull requests run the viewer checks and a real Markdown render smoke test on
Windows and macOS. CI also formats, tests, and rebuilds the Rust WebAssembly
engine, and parses the Windows Kokoro helper scripts without executing them.

## Security boundary

NeuroMD receives filesystem read permission so it can open the path supplied by
the user. Windows narration additionally needs temporary-file write access,
network access to the configured Kokoro server, and permission to start
`powershell.exe` for WAV playback. It receives no native FFI permission and does
not modify the Markdown file. The Rust WebAssembly module has no WASI imports
and cannot access the operating system directly; Deno passes Markdown bytes into
it and receives rendered terminal text back.
