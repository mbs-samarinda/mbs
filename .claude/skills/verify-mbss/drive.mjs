#!/usr/bin/env node
// Drives the running stack in headless Chromium, one step per argument, and
// writes what it saw into --out. Steps run in order; the first failure takes a
// screenshot named fail-<n>, and the script exits 1.
//
//   node drive.mjs --out <dir> [--state <file>] [--mobile | --width <px>] [--dark] <step>...
//
// Steps (role names are ARIA roles, names are accessible names, exact match):
//   goto:<url>                    open a URL, record the HTTP status; fails on 5xx
//   upload:<role>:<name>=<path>   give a file to the input a button opens
//   offline:on | offline:off      cut the network and bring it back
//   slow4g:on | slow4g:off        throttle to a phone on a bad signal. Turn it
//                                 on after the page has loaded, or a dev
//                                 server's module graph alone takes minutes
//   abort:<substring>             drop the next response whose URL contains it,
//                                 once, after it reached the server
//   click:<role>:<name>           click the first matching element
//   tryclick:<role>:<name>        click it if it shows within 5s, else go on
//                                 (for popups that come only sometimes)
//   fill:<role>:<name>=<value>    type into a textbox, searchbox or combobox
//   code:<role>:<name>=<address>  type the newest sign-in code Mailpit holds for
//                                 that address (needs --mail)
//   select:<role>:<name>=<label>  choose an option of a native select
//   press:<key>                   press a key on the page (Enter, Escape, /)
//   see:<role>:<name>             wait until such an element is visible
//   text:<text>                   wait until this text is visible anywhere
//   wait:<ms>                     sit still, for a sampler or an expiry
//   shot:<label>                  save <label>.png, <label>.aria.txt, <label>.url
//   errors                        fail on the open page's errors: what next dev
//                                 reports (/_next/mcp get_errors), or, on a Vite
//                                 app, its overlay and what the page itself threw
//                                 or printed since the last goto
//
// --mail <url> is Mailpit's web address, for the `code` step.
// --video <dir> records the whole run as a .webm there.
// --state loads and saves cookies, so a CMS login survives between runs.
// Everything printed to the console or failing over the network goes to
// <out>/drive.log alongside each step.
import { appendFileSync, existsSync, mkdirSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";

// The global Playwright, not a repo dependency: nothing in the workspace ships
// it, and adding one for verification alone is not worth the install. Found
// through the `playwright` command, because the repo's Node (fnm, per .nvmrc)
// is not the Node it was installed under.
const cliOnPath = (process.env.PATH ?? "")
  .split(delimiter)
  .map((dir) => join(dir, "playwright"))
  .find((file) => existsSync(file));
const playwrightPath =
  process.env.PLAYWRIGHT_MODULE ??
  (cliOnPath ? join(dirname(realpathSync(cliOnPath)), "index.mjs") : "playwright");
const { chromium, devices } = await import(playwrightPath);

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args.splice(i, 2)[1];
};
const out = flag("--out");
const state = flag("--state");
const mobile = args.includes("--mobile") && args.splice(args.indexOf("--mobile"), 1);
const width = flag("--width");
const video = flag("--video");
const mail = flag("--mail");
const dark = args.includes("--dark") && args.splice(args.indexOf("--dark"), 1);
if (!out || args.length === 0) {
  console.error(
    "usage: node drive.mjs --out <dir> [--state <file>] [--mobile | --width <px>] [--dark] <step>...",
  );
  process.exit(2);
}
mkdirSync(out, { recursive: true });
const logFile = join(out, "drive.log");
const log = (line) => {
  console.log(line);
  appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`);
};

// The installed headless-shell build lags this Playwright, but the full
// Chromium in the cache runs headless fine. Newest one wins.
const cache = join(homedir(), ".cache/ms-playwright");
const chromiumDir = existsSync(cache)
  ? readdirSync(cache)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))[0]
  : undefined;
const executablePath = chromiumDir ? join(cache, chromiumDir, "chrome-linux64/chrome") : undefined;

const browser = await chromium.launch({ executablePath });
const context = await browser.newContext({
  ...(mobile
    ? devices["Pixel 7"]
    : { viewport: { width: width ? Number(width) : 1280, height: width ? 812 : 900 } }),
  colorScheme: dark ? "dark" : "light",
  storageState: state && existsSync(state) ? state : undefined,
  ...(video ? { recordVideo: { dir: video, size: { width: 1280, height: 720 } } } : {}),
});
const page = await context.newPage();

// Chrome DevTools Protocol, because Playwright's own throttling covers only
// the routes it intercepts. The numbers are Chrome's own "Slow 4G" preset.
let cdp;
const throttle = async (on) => {
  cdp ??= await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: on ? 400 : 0,
    downloadThroughput: on ? (400 * 1024) / 8 : -1,
    uploadThroughput: on ? (400 * 1024) / 8 : -1,
  });
};
// The page's own errors since the last goto. Chromium also prints one for every
// 4xx and dropped request; those are logged below and are often the point.
let pageErrors = [];
page.on("console", (m) => {
  if (m.type() !== "error") return;
  log(`  console.error ${m.text()}`);
  if (!m.text().startsWith("Failed to load resource")) pageErrors.push(`console ${m.text()}`);
});
page.on("pageerror", (e) => {
  log(`  pageerror ${e.message}`);
  pageErrors.push(`pageerror ${e.stack ?? e.message}`);
});
page.on("response", (r) => r.status() >= 400 && log(`  http ${r.status()} ${r.url()}`));
page.on("requestfailed", (r) => log(`  failed ${r.failure()?.errorText} ${r.url()}`));

const split = (s, sep) => {
  const i = s.indexOf(sep);
  return i === -1 ? [s, ""] : [s.slice(0, i), s.slice(i + 1)];
};
// next dev's own error report, with source-mapped stacks, which a pageerror
// line lacks. It reads from the browsers connected right now, so it has to run
// as a step, while this page is still open.
const nextErrors = async () => {
  const { port } = new URL(page.url());
  // Every stack port is explicit; none means no page yet, or not next dev.
  if (!port) throw new Error(`no port in ${page.url()}; goto a profile page first`);
  const response = await fetch(`http://127.0.0.1:${port}/_next/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "get_errors", arguments: {} },
    }),
  });
  const data = (await response.text()).split("\n").find((line) => line.startsWith("data: "));
  if (!data) throw new Error(`no MCP answer (HTTP ${response.status}); is this next dev?`);
  const answer = JSON.parse(data.slice(6));
  if (answer.error) throw new Error(`MCP error: ${answer.error.message}`);
  const report = JSON.parse(answer.result.content[0].text);
  if (report.error) throw new Error(report.error);
  const lines = [
    ...report.configErrors.map((e) => `config ${e.message ?? JSON.stringify(e)}`),
    ...report.sessionErrors.flatMap(({ url, buildError, runtimeErrors }) => [
      ...(buildError ? [`build ${url} ${buildError}`] : []),
      ...runtimeErrors.map(({ message, stack }) => {
        // React's own frames come first and carry no line; the first that
        // does is usually ours.
        const frame = stack?.find((f) => f.line != null);
        const at = frame ? ` at ${frame.file}:${frame.line}` : "";
        return `runtime ${url} ${message}${at}`;
      }),
    ]),
  ];
  for (const line of lines) log(`  next-error ${line}`);
  if (lines.length > 0) throw new Error(`next dev reports ${lines.length} error(s)`);
  log("  next dev reports no errors");
};

// Everything that is not `next dev`: a Vite app in dev, and a built app behind
// its own Caddy, which has neither a report to ask nor an overlay. The overlay
// holds a build error where there is one; the rest is what the page did.
const pageProblems = async () => {
  // Without this an `errors` step before any `goto` reports a clean blank page.
  if (new URL(page.url()).protocol === "about:") {
    throw new Error("no page is open; goto one first");
  }
  const overlay = await page
    .locator("vite-error-overlay .message")
    .allTextContents()
    .catch(() => []);
  const lines = [...overlay.map((text) => `vite ${text.trim()}`), ...pageErrors];
  for (const line of lines) log(`  page-error ${line}`);
  if (lines.length > 0) throw new Error(`the page has ${lines.length} error(s)`);
  log("  no Vite overlay and no page errors");
};
// `next dev` is the only thing with a report to ask, so it is what is looked
// for. Asking "is this Vite?" instead made a production build, which carries no
// Vite client either, fall through to Next and fail on its 405.
const servedByNextDev = () => page.locator('script[src^="/_next/"]').count();

const byRole = (spec) => {
  const [role, name] = split(spec, ":");
  return page.getByRole(role, { name, exact: true }).first();
};

let failed = false;
for (const [n, step] of args.entries()) {
  const [cmd, rest] = split(step, ":");
  log(`step ${n + 1}: ${step}`);
  try {
    if (cmd === "goto") {
      pageErrors = [];
      const response = await page.goto(rest, { waitUntil: "load", timeout: 120_000 });
      log(`  status ${response?.status()} ${page.url()}`);
      // 4xx can be the point of a step (a 404 page); 5xx never is.
      if ((response?.status() ?? 0) >= 500) throw new Error(`server error ${response?.status()}`);
    } else if (cmd === "click") await byRole(rest).click();
    else if (cmd === "upload") {
      const [target, file] = split(rest, "=");
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser", { timeout: 30_000 }),
        byRole(target).click(),
      ]);
      await chooser.setFiles(file);
      log(`  gave ${file}`);
    } else if (cmd === "slow4g") {
      await throttle(rest === "on");
      log(`  Slow 4G ${rest}`);
    } else if (cmd === "offline") {
      await context.setOffline(rest === "on");
      log(`  network ${rest === "on" ? "cut" : "back"}`);
    } else if (cmd === "abort") {
      // Playwright matches a route by the identity of its predicate, so it is
      // named and reused rather than written out twice.
      const matches = (url) => url.href.includes(rest);
      // The flag, not `unroute`, is what makes it happen once: unrouting from
      // inside the handler takes the route out from under the abort.
      let dropped = false;
      await page.route(matches, async (route) => {
        if (dropped) return route.continue();
        dropped = true;
        await route.fetch().catch(() => undefined);
        await route.abort("connectionfailed");
        log(`  dropped the answer to ${rest}`);
      });
    } else if (cmd === "wait") await page.waitForTimeout(Number(rest));
    else if (cmd === "tryclick") {
      const target = byRole(rest);
      const shown = await target.waitFor({ state: "visible", timeout: 5_000 }).then(
        () => true,
        () => false,
      );
      if (shown) await target.click();
      log(shown ? "  clicked" : "  not shown, skipped");
    }
    else if (cmd === "fill") {
      const [target, value] = split(rest, "=");
      await byRole(target).fill(value);
    } else if (cmd === "code") {
      const [target, address] = split(rest, "=");
      if (!mail) throw new Error("the code step needs --mail <mailpit url>");
      const { messages } = await fetch(`${mail}/api/v1/messages?limit=200`).then((r) => r.json());
      const newest = messages.find((m) => m.To.some((t) => t.Address === address));
      const digits = newest && /\b(\d{6})\b/.exec(newest.Subject)?.[1];
      if (!digits) throw new Error(`no sign-in code for ${address} in Mailpit`);
      log(`  code ${digits}`);
      await byRole(target).fill(digits);
    } else if (cmd === "select") {
      const [target, label] = split(rest, "=");
      await byRole(target).selectOption({ label });
    } else if (cmd === "press") await page.keyboard.press(rest);
    else if (cmd === "see") await byRole(rest).waitFor({ state: "visible", timeout: 30_000 });
    else if (cmd === "text")
      await page.getByText(rest).first().waitFor({ state: "visible", timeout: 30_000 });
    else if (cmd === "shot") {
      await page.screenshot({ path: join(out, `${rest}.png`), fullPage: true });
      writeFileSync(join(out, `${rest}.aria.txt`), await page.locator("body").ariaSnapshot());
      writeFileSync(join(out, `${rest}.url`), `${page.url()}\n`);
      log(`  saved ${rest}.png ${rest}.aria.txt`);
    } else if (cmd === "errors") await ((await servedByNextDev()) ? nextErrors() : pageProblems());
    else throw new Error(`unknown step "${cmd}"`);
  } catch (error) {
    log(`  FAILED ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
    await page.screenshot({ path: join(out, `fail-${n + 1}.png`), fullPage: true }).catch(() => {});
    failed = true;
    break;
  }
}

if (state) await context.storageState({ path: state });
await context.close();
await browser.close();
process.exit(failed ? 1 : 0);
