#!/usr/bin/env node
/**
 * Forward Ho! — screenshot / smoke-test harness.
 *
 * Boots the Vite dev server, drives the game through its `window.__FH` debug
 * hook, captures a timeline of PNGs, tiles them into a contact sheet, and
 * fails the build if the page logged any error.
 *
 * Usage:  node tools/screenshot.mjs [flags]      (see --help)
 *
 * Environment notes (fixed for this repo):
 *   - Node 22, ESM.
 *   - Chromium is PRE-INSTALLED at /opt/pw-browsers (PLAYWRIGHT_BROWSERS_PATH).
 *     This script never runs `playwright install`.
 */

import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// ---------------------------------------------------------------------------
// Paths & constants
// ---------------------------------------------------------------------------

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..'); // repo root — the Vite project root
const HOST = '127.0.0.1';

/** Deterministic seed handed to __FH.seed() by the "auto" script. */
const SEED = 12345;
/** Steering sine period, seconds — slow enough to read in a screenshot. */
const STEER_PERIOD_S = 4;
/** Steering update interval, ms. Deliberately NOT per-frame (20Hz is plenty). */
const STEER_TICK_MS = 50;
/** How long to wait for window.__FH_READY before giving up. */
const READY_TIMEOUT_MS = 30_000;
/** How long to wait for the dev server port to answer. */
const SERVER_TIMEOUT_MS = 60_000;
/** Contact sheet tile width, px. */
const TILE_W = 300;

const DEFAULTS = {
  out: path.join('tools', 'shots'),
  port: 5199,
  width: 430,
  height: 932,
  dpr: 2,
  shots: 'menu@0.6,early@3,mid@9,late@18',
  script: 'auto',
};

const USAGE = `
Forward Ho! screenshot / smoke-test harness

  node tools/screenshot.mjs [flags]
  npm run shots -- [flags]

Flags:
  --out <dir>       Output directory for PNG/JSON             (default: ${DEFAULTS.out})
  --port <n>        Port for the spawned Vite dev server      (default: ${DEFAULTS.port})
  --width <n>       CSS viewport width                        (default: ${DEFAULTS.width})
  --height <n>      CSS viewport height                       (default: ${DEFAULTS.height})
  --dpr <n>         Device scale factor                       (default: ${DEFAULTS.dpr})
  --shots <spec>    Comma-separated "label@seconds" list
                    (default: ${DEFAULTS.shots})
  --script <name>   Input script: auto | none                 (default: ${DEFAULTS.script})
  --keep            Leave the dev server running on exit
  --headed          Run Chromium headed instead of headless
  -h, --help        Print this help and exit (does not start a server)

Shot spec:
  Each entry is "<label>@<seconds>", where seconds is elapsed time measured from
  the moment the game reports ready. Entries are sorted by time. Files are
  written as <NN>-<label>.png with a sibling <NN>-<label>.json holding the
  __FH.state() snapshot taken at that instant.

  A shot labelled "menu" is captured BEFORE the run starts; the auto script
  calls __FH.startRun(0) immediately after it (or before the first non-menu
  shot if no menu shot is listed).

Exit codes:
  0   All shots captured, game became ready, no page errors.
  1   Smoke-test failure: an error-level console message, an uncaught page
      error, the game never became ready, or the harness itself failed.
  130 Interrupted (SIGINT). SIGTERM exits 143, SIGHUP exits 129; all three
      stop the dev server first.
`.trimStart();

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

/**
 * Parse argv into an options object. Throws on malformed input so the caller
 * can print usage and bail out before anything expensive happens.
 */
export function parseArgs(argv) {
  const opts = {
    out: null,
    port: DEFAULTS.port,
    width: DEFAULTS.width,
    height: DEFAULTS.height,
    dpr: DEFAULTS.dpr,
    shots: DEFAULTS.shots,
    script: DEFAULTS.script,
    keep: false,
    headed: false,
    help: false,
  };

  // Flags taking a value, mapped to their coercion.
  const num = (name, raw, { int = true, min = 0 } = {}) => {
    const v = Number(raw);
    if (!Number.isFinite(v) || v < min || (int && !Number.isInteger(v))) {
      throw new Error(`--${name} expects ${int ? 'an integer' : 'a number'} >= ${min}, got "${raw}"`);
    }
    return v;
  };

  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    if (arg === '-h' || arg === '--help') {
      opts.help = true;
      continue;
    }
    if (arg === '--keep') {
      opts.keep = true;
      continue;
    }
    if (arg === '--headed') {
      opts.headed = true;
      continue;
    }
    if (!arg.startsWith('--')) throw new Error(`unexpected argument "${arg}"`);

    // Support both "--flag value" and "--flag=value".
    let value = null;
    const eq = arg.indexOf('=');
    if (eq !== -1) {
      value = arg.slice(eq + 1);
      arg = arg.slice(0, eq);
    }
    const take = () => {
      if (value !== null) return value;
      if (i + 1 >= argv.length) throw new Error(`${arg} expects a value`);
      return argv[++i];
    };

    switch (arg) {
      case '--out':
        opts.out = take();
        break;
      case '--port':
        opts.port = num('port', take(), { min: 1 });
        break;
      case '--width':
        opts.width = num('width', take(), { min: 1 });
        break;
      case '--height':
        opts.height = num('height', take(), { min: 1 });
        break;
      case '--dpr':
        opts.dpr = num('dpr', take(), { int: false, min: 0.1 });
        break;
      case '--shots':
        opts.shots = take();
        break;
      case '--script':
        opts.script = take();
        break;
      default:
        throw new Error(`unknown flag "${arg}"`);
    }
  }

  // --out is resolved against the caller's cwd; the default lives in the repo.
  opts.outDir = opts.out ? path.resolve(process.cwd(), opts.out) : path.join(ROOT, DEFAULTS.out);
  opts.shotList = parseShots(opts.shots);
  return opts;
}

/** Turn "menu@0.6,early@3" into [{ label, at }] sorted by time ascending. */
export function parseShots(spec) {
  const shots = [];
  for (const chunk of String(spec).split(',')) {
    const entry = chunk.trim();
    if (!entry) continue;
    const at = entry.lastIndexOf('@');
    if (at === -1) throw new Error(`bad shot spec "${entry}" — expected "label@seconds"`);
    const label = entry.slice(0, at).trim();
    const seconds = Number(entry.slice(at + 1).trim());
    if (!label) throw new Error(`bad shot spec "${entry}" — missing label`);
    if (!Number.isFinite(seconds) || seconds < 0) {
      throw new Error(`bad shot spec "${entry}" — seconds must be a number >= 0`);
    }
    shots.push({ label, at: seconds });
  }
  if (!shots.length) throw new Error('--shots produced no entries');
  shots.sort((a, b) => a.at - b.at);
  return shots;
}

/** Make a label safe to use as a filename component. */
const safeName = (label) => label.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'shot';

/** A shot labelled "menu" is understood to precede the run. */
const isMenuShot = (label) => /^menu\b/i.test(label.trim());

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));
const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Resolve true once a TCP connection to host:port succeeds. */
function probePort(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: HOST });
    const finish = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(1000, () => finish(false));
  });
}

/** True if a path exists and is readable. */
const exists = (p) => fs.access(p).then(() => true, () => false);

/**
 * Locate a usable Chromium binary.
 *
 * Chromium is pre-installed here under PLAYWRIGHT_BROWSERS_PATH, but the
 * installed build revision can lag the `playwright` package: the package looks
 * for its own pinned revision (and, for headless, a `chrome-headless-shell`
 * binary that older installs ship as `headless_shell`). We must never run
 * `playwright install`, so when the expected binary is absent we fall back to
 * the newest chromium-<rev> actually present on disk.
 *
 * Returns an executablePath, or null to let Playwright resolve it normally.
 */
async function resolveChromiumExecutable() {
  // Escape hatch for odd setups.
  if (process.env.FH_CHROMIUM_PATH) return process.env.FH_CHROMIUM_PATH;

  // Happy path: the revision Playwright wants is really installed.
  try {
    const wanted = chromium.executablePath();
    if (wanted && (await exists(wanted))) return null;
  } catch {
    /* nothing registered — fall through to the scan */
  }

  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root) return null;

  let entries = [];
  try {
    entries = await fs.readdir(root);
  } catch {
    return null;
  }

  // Linux layout: <root>/chromium-<rev>/chrome-linux/chrome — newer Playwright
  // builds moved to chrome-linux64/, so accept either.
  const found = [];
  for (const name of entries) {
    const m = /^chromium-(\d+)$/.exec(name);
    if (!m) continue;
    for (const dir of ['chrome-linux', 'chrome-linux64']) {
      const exe = path.join(root, name, dir, 'chrome');
      if (await exists(exe)) {
        found.push({ rev: Number(m[1]), exe });
        break;
      }
    }
  }
  if (!found.length) return null;

  found.sort((a, b) => b.rev - a.rev); // newest revision wins
  return found[0].exe;
}

/**
 * Launch Chromium, retrying once without the sandbox — containers frequently
 * lack the privileges the Chromium sandbox needs.
 */
export async function launchBrowser({ headed }) {
  const executablePath = await resolveChromiumExecutable();
  if (executablePath) console.log(`[browser] using pre-installed chromium: ${executablePath}`);

  const base = {
    headless: !headed,
    ...(executablePath ? { executablePath } : {}),
    // Playwright defaults these to true, which installs its own signal handlers
    // that close the browser and then call process.exit() immediately. That
    // races our teardown and wins, so the spawned vite server is never killed.
    // We own shutdown; see the signal handlers in main().
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
    args: [
      '--hide-scrollbars',
      '--disable-dev-shm-usage', // containers often have a tiny /dev/shm
      '--force-color-profile=srgb',
      '--font-render-hinting=none',
    ],
  };

  try {
    return await chromium.launch(base);
  } catch (err) {
    console.warn(`[browser] launch failed (${err.message.split('\n')[0]}) — retrying without sandbox`);
    return chromium.launch({ ...base, chromiumSandbox: false });
  }
}

// ---------------------------------------------------------------------------
// Dev server lifecycle
// ---------------------------------------------------------------------------

/**
 * Spawn `npx vite --port <port> --strictPort` from the repo root.
 * Runs detached so we can signal the whole process group on teardown —
 * killing `npx` alone would orphan the actual Vite process.
 */
export function startServer(port) {
  const child = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
    cwd: ROOT,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    shell: process.platform === 'win32',
  });

  const log = [];
  const collect = (buf) => {
    const text = buf.toString();
    log.push(text);
    if (log.length > 200) log.shift(); // keep the tail only
  };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);

  let exited = false;
  let exitInfo = null;
  let spawnError = null;

  child.on('error', (err) => {
    log.push(`spawn error: ${err.message}\n`);
    // Node does NOT emit 'exit' when the spawn itself fails (ENOENT, EACCES…),
    // so without this the server would look alive and waitForServer would poll
    // for the full timeout before reporting a misleading "timed out" error.
    spawnError = err;
    exited = true;
  });

  child.on('exit', (code, signal) => {
    exited = true;
    exitInfo = { code, signal };
  });
  // 'close' always fires, including on spawn failure — belt and braces.
  child.on('close', (code, signal) => {
    exited = true;
    exitInfo ??= { code, signal };
  });

  return {
    child,
    port,
    url: `http://${HOST}:${port}/`,
    get exited() {
      return exited;
    },
    get exitInfo() {
      return exitInfo;
    },
    get spawnError() {
      return spawnError;
    },
    output: () => log.join(''),
  };
}

/** Poll until the dev server answers, or throw with its output attached. */
export async function waitForServer(server, timeoutMs = SERVER_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.exited) {
      if (server.spawnError) {
        throw new Error(
          `failed to spawn the dev server: ${server.spawnError.message}\n--- vite output ---\n${server.output()}`,
        );
      }
      const { code, signal } = server.exitInfo ?? {};
      throw new Error(
        `vite exited before serving (code=${code}, signal=${signal})\n--- vite output ---\n${server.output()}`,
      );
    }
    if (await probePort(server.port)) {
      // The port is open; make sure it actually serves HTML before we drive it.
      try {
        // A bound-but-wedged server must not hang the poll loop past the deadline.
        const res = await fetch(server.url, { redirect: 'follow', signal: AbortSignal.timeout(5_000) });
        if (res.ok || res.status === 304) {
          await res.arrayBuffer().catch(() => {});
          return;
        }
      } catch {
        /* server still warming up — retry */
      }
    }
    await sleep(250);
  }
  throw new Error(
    `timed out after ${timeoutMs}ms waiting for ${server.url}\n--- vite output ---\n${server.output()}`,
  );
}

/** Terminate the dev server and its children. Safe to call more than once. */
export async function stopServer(server) {
  if (!server || server.exited) return;
  const pid = server.child.pid;
  if (!pid) return;

  const signal = (sig) => {
    try {
      // Negative pid targets the process group created by detached: true.
      if (process.platform !== 'win32') process.kill(-pid, sig);
      else server.child.kill(sig);
    } catch {
      /* already gone */
    }
  };

  signal('SIGTERM');
  for (let i = 0; i < 40 && !server.exited; i++) await sleep(50); // up to 2s grace
  if (!server.exited) signal('SIGKILL');
}

// ---------------------------------------------------------------------------
// In-page interaction (everything below runs inside the browser)
// ---------------------------------------------------------------------------

/** Wait for window.__FH_READY === true. Resolves false on timeout. */
async function waitForReady(page, timeoutMs) {
  try {
    await page.waitForFunction(() => window.__FH_READY === true, undefined, {
      timeout: timeoutMs,
      polling: 100,
    });
    return true;
  } catch {
    return false;
  }
}

/** Seed the RNG for deterministic level generation. Returns true if applied. */
function seedGame(page, seed) {
  return page
    .evaluate((s) => {
      const FH = window.__FH;
      if (!FH || typeof FH.seed !== 'function') return false;
      FH.seed(s);
      return true;
    }, seed)
    .catch(() => false);
}

/**
 * Start the run and install a steering driver *inside the page*: a setInterval
 * that sweeps setSteer() along a slow sine. Keeping the loop in-page avoids a
 * round trip per frame.
 */
function startRunAndSteer(page, { levelIndex = 0, periodS = STEER_PERIOD_S, tickMs = STEER_TICK_MS } = {}) {
  return page
    .evaluate(
      ({ levelIndex, periodS, tickMs }) => {
        const FH = window.__FH;
        if (!FH) return { started: false, steering: false };

        let started = false;
        if (typeof FH.startRun === 'function') {
          FH.startRun(levelIndex);
          started = true;
        }

        let steering = false;
        if (typeof FH.setSteer === 'function') {
          if (window.__fhSteerTimer) clearInterval(window.__fhSteerTimer);
          const t0 = performance.now();
          window.__fhSteerTimer = setInterval(() => {
            const t = (performance.now() - t0) / 1000;
            // Slow sine sweep across the full -1..1 lateral range.
            window.__FH?.setSteer?.(Math.sin((2 * Math.PI * t) / periodS));
          }, tickMs);
          steering = true;
        }
        return { started, steering };
      },
      { levelIndex, periodS, tickMs },
    )
    .catch(() => ({ started: false, steering: false }));
}

/** Stop the in-page steering interval and centre the input. */
function stopSteer(page) {
  return page
    .evaluate(() => {
      if (window.__fhSteerTimer) {
        clearInterval(window.__fhSteerTimer);
        window.__fhSteerTimer = null;
      }
      window.__FH?.setSteer?.(0);
    })
    .catch(() => {});
}

/**
 * Snapshot __FH.state() as pretty JSON. Serialised inside the page with a
 * cycle-safe replacer so an arbitrary game object can't blow up the harness.
 */
function snapshotState(page) {
  return page
    .evaluate(() => {
      const FH = window.__FH;
      if (!FH || typeof FH.state !== 'function') return null;
      try {
        const seen = new WeakSet();
        return JSON.stringify(
          FH.state(),
          (key, value) => {
            if (typeof value === 'function') return '[Function]';
            if (typeof value === 'bigint') return String(value);
            if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
            if (value && typeof value === 'object') {
              if (seen.has(value)) return '[Circular]';
              seen.add(value);
            }
            return value;
          },
          2,
        );
      } catch (err) {
        return JSON.stringify({ __stateError: String(err?.message ?? err) }, null, 2);
      }
    })
    .catch((err) => JSON.stringify({ __stateError: String(err?.message ?? err) }, null, 2));
}

// ---------------------------------------------------------------------------
// Contact sheet — built with the browser, no image library involved
// ---------------------------------------------------------------------------

/**
 * Tile the captured PNGs horizontally into sheet.png by rendering them as
 * data-URL <img> tags in a flex row on an about:blank page and screenshotting it.
 */
export async function buildContactSheet(browser, tiles, outFile, aspect) {
  if (!tiles.length) return null;

  const tileH = Math.max(1, Math.round(TILE_W * aspect));
  const gap = 8;
  const pad = 12;
  const captionH = 22;
  const width = pad * 2 + tiles.length * TILE_W + gap * (tiles.length - 1);
  const height = pad * 2 + tileH + captionH;

  // Chromium refuses absurdly large surfaces; warn rather than fail mysteriously.
  if (width > 16000) {
    console.warn(`[sheet] contact sheet is ${width}px wide — Chromium may clip it.`);
  }

  const body = tiles
    .map(
      (t) => `
      <figure class="tile">
        <img src="data:image/png;base64,${t.base64}" alt="${escapeHtml(t.label)}" />
        <figcaption>${escapeHtml(t.label)} @ ${t.at}s</figcaption>
      </figure>`,
    )
    .join('');

  const html = `<!doctype html><meta charset="utf-8" />
<style>
  html, body { margin: 0; background: #0a0e17; }
  .row {
    display: flex; flex-direction: row; flex-wrap: nowrap;
    gap: ${gap}px; padding: ${pad}px; align-items: flex-start;
  }
  .tile { margin: 0; width: ${TILE_W}px; }
  .tile img {
    display: block; box-sizing: border-box;
    width: ${TILE_W}px; height: ${tileH}px;
    object-fit: contain; background: #05070d;
    border: 1px solid #1d2740; image-rendering: pixelated;
  }
  figcaption {
    height: ${captionH}px; line-height: ${captionH}px;
    font: 600 12px ui-monospace, Menlo, Consolas, monospace;
    color: #ffd447; text-align: center; letter-spacing: .06em;
    overflow: hidden; white-space: nowrap;
  }
</style>
<div class="row">${body}</div>`;

  // deviceScaleFactor 1 — the sheet is a proof sheet, not a hi-dpi asset.
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  try {
    await page.goto('about:blank');
    await page.setContent(html, { waitUntil: 'load' });
    // Ensure every data URL has actually decoded before we shoot.
    await page.evaluate(() => Promise.all([...document.images].map((img) => img.decode().catch(() => {}))));
    await page.screenshot({ path: outFile, fullPage: true });
    return outFile;
  } finally {
    await context.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

let server = null;
let browser = null;
let teardownPromise = null;

/**
 * Close the browser and (unless --keep) the dev server. Idempotent: concurrent
 * callers await the SAME in-flight run rather than returning early, otherwise a
 * signal arriving mid-teardown would let the caller process.exit() while the
 * dev server was still being killed.
 */
function teardown(opts) {
  teardownPromise ??= runTeardown(opts);
  return teardownPromise;
}

async function runTeardown(opts) {
  if (browser) await browser.close().catch(() => {});
  if (server && !opts?.keep) await stopServer(server);
  if (server && opts?.keep) {
    // Let the harness exit while vite keeps running: detach the child *and*
    // close the stdio pipes, which would otherwise hold the event loop open.
    server.child.stdout?.destroy();
    server.child.stderr?.destroy();
    server.child.unref();
    console.log(`\n[keep] dev server still running at ${server.url} (pid ${server.child.pid})`);
  }
}

export async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`error: ${err.message}\n`);
    process.stdout.write(USAGE);
    return 1;
  }

  // --help must never start a server.
  if (opts.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  // A signal must not leave a stray dev server behind. Playwright's own
  // handlers are disabled in launchBrowser() so these are the only ones.
  const onSignal = (name, code) => () => {
    console.log(`\n[harness] ${name} — shutting down`);
    teardown({ keep: false }).finally(() => process.exit(code));
  };
  process.on('SIGINT', onSignal('SIGINT', 130));
  process.on('SIGTERM', onSignal('SIGTERM', 143));
  process.on('SIGHUP', onSignal('SIGHUP', 129));

  const consoleLog = []; // every console message, in order
  const pageErrors = []; // uncaught exceptions
  const failedRequests = []; // logged, but not part of the exit contract
  let errorCount = 0;
  let fatal = null;
  let ready = false;
  let lastState = null;
  const written = [];
  const tiles = [];

  try {
    // Inside the try: a failure here (e.g. --out names an existing file) must
    // be reported through the normal FAIL path, not as a raw Node crash dump.
    await fs.mkdir(opts.outDir, { recursive: true });

    // --- dev server -------------------------------------------------------
    console.log(`[server] npx vite --port ${opts.port} --strictPort  (cwd: ${ROOT})`);
    server = startServer(opts.port);
    await waitForServer(server);
    console.log(`[server] ready at ${server.url}`);

    // --- browser ----------------------------------------------------------
    browser = await launchBrowser({ headed: opts.headed });
    const context = await browser.newContext({
      viewport: { width: opts.width, height: opts.height },
      deviceScaleFactor: opts.dpr,
    });
    const page = await context.newPage();

    // Collect everything the page says. This is the smoke test.
    page.on('console', (msg) => {
      const loc = msg.location();
      const where = loc?.url ? `${loc.url}:${loc.lineNumber ?? 0}:${loc.columnNumber ?? 0}` : '';
      consoleLog.push({ type: msg.type(), text: msg.text(), where });
      if (msg.type() === 'error') errorCount++;
    });
    page.on('pageerror', (err) => {
      pageErrors.push(err?.stack || String(err));
    });
    page.on('requestfailed', (req) => {
      failedRequests.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText ?? 'failed'}`);
    });

    console.log(`[page] ${opts.width}x${opts.height} @${opts.dpr}x → ${server.url}`);
    try {
      await page.goto(server.url, { waitUntil: 'load', timeout: 30_000 });
    } catch (err) {
      // Not fatal on its own — capture whatever rendered and let the log speak.
      console.warn(`[page] navigation issue: ${err.message}`);
    }

    // --- readiness --------------------------------------------------------
    ready = await waitForReady(page, READY_TIMEOUT_MS);
    if (ready) {
      console.log('[game] window.__FH_READY === true');
    } else {
      console.warn(
        `[game] never became ready within ${READY_TIMEOUT_MS / 1000}s — capturing anyway (will exit 1)`,
      );
    }

    const hasHook = await page.evaluate(() => Boolean(window.__FH)).catch(() => false);
    if (!hasHook) console.warn('[game] window.__FH is undefined — running without input driving');

    // --- input script -----------------------------------------------------
    const scriptName = opts.script.toLowerCase();
    const driving = scriptName === 'auto' && hasHook;
    if (scriptName !== 'auto' && scriptName !== 'none') {
      console.warn(`[script] unknown script "${opts.script}" — falling back to "none"`);
    }
    if (driving) {
      const seeded = await seedGame(page, SEED);
      console.log(seeded ? `[script] auto — seeded ${SEED}` : '[script] auto — __FH.seed() unavailable');
    }

    // The clock starts once the game is ready (or once we gave up waiting).
    const t0 = Date.now();
    let runStarted = false;
    const beginRun = async () => {
      if (runStarted || !driving) return;
      runStarted = true;
      // A real click first: audio (and therefore the 8bit-sfx bank) is gated on
      // a user gesture, so without this the smoke test never exercises it.
      await page.mouse.click(opts.width / 2, opts.height - 30).catch(() => {});
      const { started, steering } = await startRunAndSteer(page, { levelIndex: 0 });
      console.log(
        `[script] startRun(0) ${started ? 'ok' : 'unavailable'}; steering ${steering ? 'on' : 'unavailable'}`,
      );
    };

    // --- shot timeline ----------------------------------------------------
    for (const [i, shot] of opts.shotList.entries()) {
      // A "menu" shot is taken before the run; anything else implies it started.
      if (!isMenuShot(shot.label)) await beginRun();

      const waitMs = t0 + shot.at * 1000 - Date.now();
      if (waitMs > 0) await sleep(waitMs);

      const base = `${String(i + 1).padStart(2, '0')}-${safeName(shot.label)}`;
      const pngPath = path.join(opts.outDir, `${base}.png`);
      const jsonPath = path.join(opts.outDir, `${base}.json`);

      const buffer = await page.screenshot({ path: pngPath });
      const stateJson = await snapshotState(page);
      if (stateJson !== null) lastState = stateJson;
      await fs.writeFile(jsonPath, stateJson ?? JSON.stringify({ __state: 'unavailable' }, null, 2), 'utf8');

      const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
      console.log(`[shot] ${base}.png  (t=${elapsed}s, target ${shot.at}s)`);
      written.push(pngPath);
      tiles.push({ label: shot.label, at: shot.at, base64: buffer.toString('base64') });

      // Starting the run right after the menu frame means the next shot shows
      // real gameplay rather than frame zero.
      if (isMenuShot(shot.label)) await beginRun();
    }

    if (driving) await stopSteer(page);

    // --- contact sheet ----------------------------------------------------
    const sheetPath = path.join(opts.outDir, 'sheet.png');
    const sheet = await buildContactSheet(browser, tiles, sheetPath, opts.height / opts.width);
    if (sheet) console.log(`[sheet] ${sheet}`);
  } catch (err) {
    fatal = err;
  } finally {
    await teardown(opts);
  }

  // --- report ---------------------------------------------------------------
  const MAX_LINES = 200;
  console.log('\n=== console ===');
  if (!consoleLog.length) {
    console.log('(no console output)');
  } else {
    for (const entry of consoleLog.slice(0, MAX_LINES)) {
      console.log(`  [${entry.type}] ${entry.text}${entry.where ? `\n        at ${entry.where}` : ''}`);
    }
    if (consoleLog.length > MAX_LINES) console.log(`  ... ${consoleLog.length - MAX_LINES} more message(s)`);
  }

  if (pageErrors.length) {
    console.log('\n=== page errors ===');
    for (const err of pageErrors.slice(0, MAX_LINES)) console.log(`  ${err}`);
  }
  if (failedRequests.length) {
    // Informational only — does not affect the exit code.
    console.log('\n=== failed requests ===');
    for (const req of failedRequests.slice(0, MAX_LINES)) console.log(`  ${req}`);
  }
  if (fatal) {
    console.log('\n=== harness error ===');
    console.log(`  ${fatal?.stack || fatal}`);
  }

  console.log('\n=== summary ===');
  console.log(`  shots written : ${written.length}${written.length ? ` → ${opts.outDir}` : ''}`);
  console.log(`  console errors: ${errorCount}`);
  console.log(`  page errors   : ${pageErrors.length}`);
  console.log(`  game ready    : ${ready ? 'yes' : 'NO'}`);
  console.log('  last state    :');
  console.log(
    lastState
      ? lastState
          .split('\n')
          .map((l) => `    ${l}`)
          .join('\n')
      : '    (unavailable — __FH.state() never returned)',
  );

  const failed = Boolean(fatal) || !ready || errorCount > 0 || pageErrors.length > 0;
  console.log(`\n${failed ? 'FAIL' : 'PASS'} — exit ${failed ? 1 : 0}`);
  return failed ? 1 : 0;
}

// Only run when invoked as a CLI, so tests can import the helpers above.
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  // Never leave a dev server running because of an unexpected throw.
  process.on('unhandledRejection', async (err) => {
    console.error(`[harness] unhandled rejection: ${err?.stack || err}`);
    await teardown({ keep: false });
    process.exit(1);
  });

  // A rejection from main() itself is NOT routed to the handler above (Node
  // reports a top-level-await failure as a fatal error), so catch it here or
  // the dev server would outlive the crash.
  process.exitCode = await main().catch(async (err) => {
    console.error(`[harness] fatal: ${err?.stack || err}`);
    await teardown({ keep: false });
    return 1;
  });
}
