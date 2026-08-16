# Screenshot / smoke-test harness

`screenshot.mjs` boots the Vite dev server, drives the game through its debug
hook, captures a timeline of PNGs, tiles them into a contact sheet, and fails if
the page logged any error.

## Run it

```bash
npm run shots              # uses the "shots" script already in package.json
npm run shots -- --help    # flags (prints usage, never starts a server)
node tools/screenshot.mjs  # equivalent direct invocation
```

`package.json` already defines `"shots": "node tools/screenshot.mjs"`. When
going through npm, put `--` before harness flags so npm forwards them:

```bash
npm run shots -- --shots 'menu@0.5,boss@25' --out /tmp/fh --headed
```

The harness starts and stops its own dev server (`npx vite --port <port>
--strictPort`) — do not run `npm run dev` alongside it on the same port.

## Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--out <dir>` | `tools/shots` | Output directory (created if missing) |
| `--port <n>` | `5199` | Port for the spawned dev server |
| `--width <n>` | `430` | CSS viewport width |
| `--height <n>` | `932` | CSS viewport height |
| `--dpr <n>` | `2` | Device scale factor |
| `--shots <spec>` | `menu@0.6,early@3,mid@9,late@18` | Comma-separated `label@seconds` |
| `--script <name>` | `auto` | Input script: `auto` or `none` |
| `--keep` | off | Leave the dev server running after exit |
| `--headed` | off | Run Chromium headed instead of headless |
| `-h`, `--help` | — | Print usage and exit 0 |

## Output

For `--shots 'menu@0.6,early@3'` you get, in `--out`:

```
01-menu.png    01-menu.json     # __FH.state() at that instant
02-early.png   02-early.json
sheet.png                       # all shots tiled horizontally, 300px tiles
```

Shots are sorted by time; `NN` follows that order. The contact sheet is built
without any image library — the PNGs are injected as data URLs into a flex row
on an `about:blank` page, which is then screenshotted.

## Timing and the `auto` script

The clock starts when the game reports ready, so `late@18` means 18s of real
gameplay. With `--script auto` the harness:

1. calls `__FH.seed(12345)` for deterministic level generation,
2. calls `__FH.startRun(0)`,
3. sweeps `__FH.setSteer()` along a slow 4s sine (a 20Hz `setInterval` **inside
   the page**, so there is no round trip per frame).

A shot labelled `menu` is captured *before* the run starts; the run begins
immediately after it, so the next shot shows real gameplay rather than frame
zero. If no `menu` shot is listed, the run starts before the first shot.

## The `window.__FH` debug hook

The harness expects the game to expose these. Every one is optional — if
`window.__FH` is missing the harness degrades to just watching and shooting.

```js
window.__FH_READY = true;   // polled for up to 30s; gates the clock
window.__FH = {
  ready,                    // boolean
  startRun(levelIndex),
  setSteer(x),              // -1..1 lateral input
  state(),                  // arbitrary snapshot, dumped next to each shot
  seed(n),                  // deterministic level generation
  fastForward(seconds),     // available, not used — shots are wall-clock timed
};
```

`state()` is serialised inside the page with a cycle-safe replacer, so returning
a live game object will not crash the harness.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | All shots captured, game became ready, no page errors |
| `1` | Smoke-test failure (see below) |
| `130` | Interrupted with Ctrl-C |

Exit `1` is returned if **any** of these hold:

- an error-level console message was logged,
- an uncaught page error (`pageerror`) fired,
- `window.__FH_READY` never became `true` within 30s,
- the harness itself failed (dev server never came up, browser launch failed).

Even when the game never becomes ready, the harness still walks the full shot
schedule, writes the PNGs and the contact sheet, and prints the console log —
then exits `1`. A blank `sheet.png` is usually the fastest way to see what broke.

Failed network requests are printed for information but do **not** affect the
exit code.

## Browsers

Chromium is pre-installed at `/opt/pw-browsers` (`PLAYWRIGHT_BROWSERS_PATH`).
**Never run `playwright install`.**

The installed build (`chromium-1194`) is older than the revision the
`playwright` package pins, and it ships the headless binary under the legacy
name `headless_shell`, so Playwright's default resolution fails. The harness
therefore scans `PLAYWRIGHT_BROWSERS_PATH` and launches the newest
`chromium-<rev>/chrome-linux/chrome` it finds, and retries without the sandbox
if the first launch fails. Override with `FH_CHROMIUM_PATH=/path/to/chrome` if
you ever need to pin a specific binary.
