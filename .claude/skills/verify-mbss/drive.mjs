#!/usr/bin/env node
// Drives the running stack in headless Chromium, one step per argument, and
// writes what it saw into --out. Steps run in order; the first failure takes a
// screenshot named fail-<n>, and the script exits 1.
//
//   node drive.mjs --out <dir> [--state <file>] [--mobile] <step>...
//
// Steps (role names are ARIA roles, names are accessible names, exact match):
//   goto:<url>                    open a URL, record the HTTP status; fails on 5xx
//   click:<role>:<name>           click the first matching element
//   tryclick:<role>:<name>        click it if it shows within 5s, else go on
//                                 (for popups that come only sometimes)
//   fill:<role>:<name>=<value>    type into a textbox, searchbox or combobox
//   press:<key>                   press a key on the page (Enter, Escape, /)
//   see:<role>:<name>             wait until such an element is visible
//   text:<text>                   wait until this text is visible anywhere
//   shot:<label>                  save <label>.png, <label>.aria.txt, <label>.url
//   errors                        ask next dev (/_next/mcp get_errors) for the
//                                 open page's errors; fails if there are any
//
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
if (!out || args.length === 0) {
  console.error("usage: node drive.mjs --out <dir> [--state <file>] [--mobile] <step>...");
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
  ...(mobile ? devices["Pixel 7"] : { viewport: { width: 1280, height: 900 } }),
  storageState: state && existsSync(state) ? state : undefined,
});
const page = await context.newPage();
page.on("console", (m) => m.type() === "error" && log(`  console.error ${m.text()}`));
page.on("pageerror", (e) => log(`  pageerror ${e.message}`));
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
      const response = await page.goto(rest, { waitUntil: "load", timeout: 120_000 });
      log(`  status ${response?.status()} ${page.url()}`);
      // 4xx can be the point of a step (a 404 page); 5xx never is.
      if ((response?.status() ?? 0) >= 500) throw new Error(`server error ${response?.status()}`);
    } else if (cmd === "click") await byRole(rest).click();
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
    } else if (cmd === "press") await page.keyboard.press(rest);
    else if (cmd === "see") await byRole(rest).waitFor({ state: "visible", timeout: 30_000 });
    else if (cmd === "text")
      await page.getByText(rest).first().waitFor({ state: "visible", timeout: 30_000 });
    else if (cmd === "shot") {
      await page.screenshot({ path: join(out, `${rest}.png`), fullPage: true });
      writeFileSync(join(out, `${rest}.aria.txt`), await page.locator("body").ariaSnapshot());
      writeFileSync(join(out, `${rest}.url`), `${page.url()}\n`);
      log(`  saved ${rest}.png ${rest}.aria.txt`);
    } else if (cmd === "errors") await nextErrors();
    else throw new Error(`unknown step "${cmd}"`);
  } catch (error) {
    log(`  FAILED ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
    await page.screenshot({ path: join(out, `fail-${n + 1}.png`), fullPage: true }).catch(() => {});
    failed = true;
    break;
  }
}

if (state) await context.storageState({ path: state });
await browser.close();
process.exit(failed ? 1 : 0);
