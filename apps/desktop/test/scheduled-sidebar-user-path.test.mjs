import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { repositoryRoot, resolveElectronBinary } from "../../../scripts/e2e/boot.mjs";

const root = repositoryRoot();
const { build } = createRequire(join(root, "packages/agent-runtime/package.json"))("esbuild");
const fixture = String.raw`
import React from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { catalogs, flattenCatalog } from "@pi-desktop/i18n";
import { IPC } from "@pi-desktop/shared";
import { api } from "../../apps/desktop/src/lib/api";
import { Sidebar } from "../../apps/desktop/src/components/Sidebar";
import { SettingsPage } from "../../apps/desktop/src/features/settings/SettingsPage";
import { ScheduledPage } from "../../apps/desktop/src/pages/ScheduledPage";
import { rememberScheduledReturn } from "../../apps/desktop/src/features/scheduled/scheduled-return";
import { useAppStore } from "../../apps/desktop/src/stores/app-store";

await i18n.use(initReactI18next).init({ lng: "en", fallbackLng: "en", keySeparator: false,
  resources: { en: { translation: flattenCatalog(catalogs.en) } }, interpolation: { escapeValue: false } });
document.documentElement.dataset.theme = "light";
document.documentElement.dataset.platform = "win32";
const timestamp = "2026-10-29T00:00:00Z";
const task = (id, title, enabled = true) => ({ id, title, enabled, prompt: "Read the fixture project.",
  cadence: "manual", mode: "agent", createdAt: timestamp, updatedAt: timestamp, permissionMode: "ask" });
let tasks = [task("a", "Nightly checks"), task("b", "Review PRs", false), task("c", "Nightly checks")];
const runs = [{ id: "run-a", taskId: "a", sessionId: "automation-session", status: "running",
  startedAt: timestamp, endedAt: null, errorCode: null }];
let storedSettings = { theme: "light", language: "en", defaultMode: "agent", sidebarRunningIndicators: true };
const calls = [];
let failList = false;
let deferList = false;
let releaseList;
window.piDesktop = { platform: "win32", on() { return () => {}; }, async invoke(channel, ...args) {
  calls.push({ channel, args });
  let data;
  switch (channel) {
    case IPC.invoke.settingsGet: data = storedSettings; break;
    case IPC.invoke.settingsSet: storedSettings = structuredClone(args[0]); break;
    case IPC.invoke.scheduledList:
      if (failList) throw new Error("Fixture task list unavailable");
      if (deferList) await new Promise((resolve) => { releaseList = resolve; });
      data = { tasks: structuredClone(tasks) }; break;
    case IPC.invoke.scheduledListRuns:
      data = { runs: args[0]?.taskId ? [] : runs }; break;
    case IPC.invoke.projectList: data = { projects: [] }; break;
    case IPC.invoke.providersList: data = { providers: [] }; break;
    case IPC.invoke.pluginScenicThemesDestinations: data = []; break;
    case IPC.invoke.systemFontsList: data = []; break;
    default: throw new Error("Unexpected fixture IPC: " + channel);
  }
  return { ok: true, data };
} };
useAppStore.setState({ settings: storedSettings, settingsTab: "general", page: "chat", providers: [],
  sessions: [{ id: "automation-session", title: "Hidden automation transcript", scheduledRun: true,
    projectPath: "/fixture", createdAt: timestamp, updatedAt: timestamp }],
  openProjectPaths: ["/fixture"], openProjects: [{ path: "/fixture", name: "Fixture project" }],
  activeProjectPath: "/fixture", runningSessions: { "automation-session": true } });
let remountSidebar;
function Surface() {
  const page = useAppStore((state) => state.page);
  const [sidebarKey, setSidebarKey] = React.useState(0);
  remountSidebar = () => setSidebarKey((key) => key + 1);
  if (page === "settings") return <SettingsPage />;
  return <div style={{display: "flex", height: "100vh"}}>
    <Sidebar key={sidebarKey} onToggleSidebar={() => {}} sidebarToggleShortcut="" sidebarWidth={275}
      onWidthChange={() => {}} onWidthCommit={() => {}} onResizeCollapse={() => {}} />
    <main style={{flex: 1, minWidth: 0, overflow: "auto"}}>
      {page === "scheduled" ? <ScheduledPage /> : null}
    </main>
  </div>;
}
let view = createRoot(document.getElementById("root"));
flushSync(() => view.render(<Surface />));
const frame = () => new Promise(requestAnimationFrame);
async function settle() { await frame(); await frame(); }
function check(value, message) { if (!value) throw new Error(message); return value; }
async function until(predicate, message) {
  const deadline = performance.now() + 6000;
  while (!predicate()) { check(performance.now() < deadline, message); await frame(); }
  return predicate();
}
const group = () => document.querySelector('[data-sidebar-scheduled-group="tasks"]');
const row = (id) => document.querySelector('[data-sidebar-scheduled-task="' + id + '"] button');
const toggle = () => [...document.querySelectorAll('button[role="switch"]')]
  .find((node) => node.getAttribute("aria-label") === "Show scheduled tasks");
const click = (node) => flushSync(() => check(node, "Missing control").click());
const open = async (id, title) => {
  click(row(id));
  await until(() => document.getElementById("scheduled-detail-title")?.textContent === title,
    "Task shortcut did not select " + id);
  check(useAppStore.getState().page === "scheduled", "Shortcut did not navigate");
};

window.scheduledSidebarProbe = async () => {
  await settle();
  check(!group(), "Default-off sidebar has a task group");
  check(!calls.some((call) => call.channel === IPC.invoke.scheduledList), "Disabled group fetched tasks");
  click(document.querySelector('[data-nav="settings"]'));
  await until(toggle, "Sidebar settings did not open");
  check(toggle().getAttribute("aria-checked") === "false", "Default must be off");
  failList = true;
  click(toggle());
  await until(() => useAppStore.getState().settings.sidebarScheduledTasks === true, "Setting did not enable");
  click(document.querySelector('[data-nav="back-to-app"]'));
  await until(() => group()?.querySelector('[role="alert"]'), "Loading failure is not visible");
  check(storedSettings.sidebarScheduledTasks === true, "Enabled preference was not persisted");
  failList = false;
  click(group().querySelector('[role="alert"] button'));
  await until(() => row("b"), "Retry did not load tasks");
  check(group().querySelectorAll('[data-sidebar-scheduled-task]').length === 3, "Task identity or count changed");
  check(row("b").textContent.includes("Disabled"), "Paused task shortcut missing");
  check(!document.querySelector('[data-sidebar-session-row="automation-session"]'), "Run transcript leaked into conversations");
  check(group().querySelector('.project-run-badge.running'), "Running task count missing");

  click(document.getElementById("sidebar-scheduled-label"));
  check(document.getElementById("sidebar-scheduled-tasks").inert, "Collapsed tasks remain keyboard reachable");
  flushSync(remountSidebar);
  await until(() => row("b"), "Remounted group did not load");
  check(document.getElementById("sidebar-scheduled-label").getAttribute("aria-expanded") === "false", "Collapse was not persisted");
  click(document.getElementById("sidebar-scheduled-label"));
  await open("b", "Review PRs");
  await open("a", "Nightly checks");
  await open("b", "Review PRs");
  click([...document.querySelectorAll('.scheduled-rail-list button')]
    .find((node) => node.textContent.includes("Nightly checks")));
  await until(() => document.getElementById("scheduled-detail-title")?.textContent === "Nightly checks", "Task column did not select");
  await open("b", "Review PRs");
  check(calls.some((call) => call.channel === IPC.invoke.scheduledListRuns && call.args[0]?.taskId === "b"), "History was not scoped to task b");
  rememberScheduledReturn({ taskId: "b", taskTitle: "Review PRs", runId: null, sessionId: "prior-result" });
  flushSync(() => useAppStore.getState().setPage("chat"));
  await settle();
  click(document.querySelector('[data-nav="scheduled"]'));
  await until(() => document.getElementById("scheduled-detail-title")?.textContent === "Review PRs", "Footer did not restore the remembered task");
  await open("a", "Nightly checks");

  flushSync(() => useAppStore.setState({ settings: { ...useAppStore.getState().settings, sidebarRunningIndicators: false } }));
  await settle();
  check(!group().querySelector('.project-run-badge, .project-run-rail'), "Running indicators ignored their setting");

  tasks = [task("b", "Renamed review", false), task("d", "New task")];
  window.dispatchEvent(new Event("focus"));
  await until(() => row("d") && row("b")?.textContent.includes("Renamed review"), "Task edits were not refreshed");
  check(!row("a") && !row("c"), "Deleted tasks remain in sidebar");

  deferList = true;
  window.dispatchEvent(new Event("focus"));
  await until(() => releaseList, "Pending list was not started");
  click(document.querySelector('[data-nav="settings"]'));
  await until(toggle, "Settings did not reopen");
  click(toggle());
  await until(() => useAppStore.getState().settings.sidebarScheduledTasks === false, "Setting did not disable");
  deferList = false;
  releaseList();
  await settle();
  check(!group(), "An obsolete read restored the disabled group");
  check(storedSettings.sidebarScheduledTasks === false, "Disabled preference was not persisted");
  flushSync(() => useAppStore.setState({ settings: null }));
  const reloaded = await api.getSettings();
  flushSync(() => useAppStore.setState({ settings: reloaded }));
  await settle();
  check(!group() && toggle()?.getAttribute("aria-checked") === "false", "Reload did not preserve disabled choice");
  click(document.querySelector('[data-nav="back-to-app"]'));
  await settle();
  check(!group(), "Disabled group reappeared after leaving settings");
  check(!calls.some((call) => [IPC.invoke.scheduledExecute, IPC.invoke.scheduledRun].includes(call.channel)), "Navigation executed a task");
  flushSync(() => view.unmount());
  return { passed: true, persisted: storedSettings.sidebarScheduledTasks };
};

window.scheduledSidebarPreview = async () => {
  tasks = [task("a", "Nightly checks"), task("b", "Review PRs", false)];
  useAppStore.setState({ settings: { ...storedSettings, sidebarScheduledTasks: true,
    sidebarRunningIndicators: true }, page: "scheduled" });
  view = createRoot(document.getElementById("root"));
  flushSync(() => view.render(<Surface />));
  await until(() => row("a"), "Preview tasks did not load");
  await open("a", "Nightly checks");
  await settle();
};
`;

test("scheduled shortcuts support settings, retry, task navigation, refresh, folding and disable", {
  timeout: 60_000,
  skip: process.platform === "linux" && !process.env.DISPLAY ? "Electron requires a display" : false,
}, async () => {
  const temp = await mkdtemp(join(tmpdir(), "pi-scheduled-sidebar-ui-"));
  const evidence = process.env.PI_SCHEDULED_SIDEBAR_EVIDENCE_DIR;
  if (evidence) await mkdir(evidence, { recursive: true });
  try {
    await build({
      stdin: { contents: fixture, resolveDir: join(root, "scripts/e2e"), loader: "tsx" },
      outfile: join(temp, "renderer.js"), bundle: true, platform: "browser", format: "esm", jsx: "automatic",
      define: { "process.env.NODE_ENV": '"production"', "import.meta.env.DEV": "false" },
      alias: {
        "@pi-desktop/i18n": join(root, "packages/i18n/src"),
        "@pi-desktop/shared": join(root, "packages/shared/src"),
        react: join(root, "apps/desktop/node_modules/react"),
        "react-dom": join(root, "apps/desktop/node_modules/react-dom"),
        i18next: join(root, "apps/desktop/node_modules/i18next"),
        "react-i18next": join(root, "apps/desktop/node_modules/react-i18next"),
      },
      nodePaths: [join(root, "apps/desktop/node_modules")],
      loader: { ".png": "file", ".svg": "file", ".woff2": "file" },
      plugins: [{ name: "url-assets", setup(plugin) {
        plugin.onResolve({ filter: /\?url$/ }, ({ path, resolveDir }) => ({ path: join(resolveDir, path.slice(0, -4)), namespace: "url-asset" }));
        plugin.onLoad({ filter: /.*/, namespace: "url-asset" }, async ({ path }) => ({ contents: await readFile(path), loader: "file" }));
      } }],
    });
    const renderer = join(root, "apps/desktop/out/renderer");
    const rendererHtml = await readFile(join(renderer, "index.html"), "utf8");
    const styles = [...rendererHtml.matchAll(/href="([^" ]+\.css)"/g)].map((match) => match[1]);
    assert.ok(styles.length, "Build the desktop renderer before running this UI test");
    await cp(join(renderer, "assets"), join(temp, "assets"), { recursive: true });
    await writeFile(join(temp, "index.html"), '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data:; font-src \'self\' data:">' + styles.map((path) => '<link rel="stylesheet" href="' + path + '">').join("") + '<link rel="stylesheet" href="renderer.css"><div id="root"></div><script type="module" src="renderer.js"></script>');
    await writeFile(join(temp, "main.cjs"), `
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
app.setPath("userData", path.join(__dirname, "profile"));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1200, height: 800,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  win.webContents.on("console-message", (event) => console.error(event.message));
  try {
    await win.loadFile(path.join(__dirname, "index.html"));
    console.log("SCHEDULED_SIDEBAR_PROBE " + JSON.stringify(await win.webContents.executeJavaScript("window.scheduledSidebarProbe()")));
    const evidence = ${JSON.stringify(evidence ?? null)};
    if (evidence) {
      await win.webContents.executeJavaScript("window.scheduledSidebarPreview()");
      const fs = require("node:fs/promises");
      for (const theme of ["light", "dark"]) {
        await win.webContents.executeJavaScript("(async () => { document.documentElement.dataset.theme = '" + theme + "'; await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); await Promise.all(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity).map((animation) => animation.finished.catch(() => {}))); })()");
        await fs.writeFile(path.join(evidence, theme + ".png"), (await win.webContents.capturePage()).toPNG());
      }
    }
    app.exit(0);
  } catch (error) { console.error(error?.stack ?? error); app.exit(1); }
});`);
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(resolveElectronBinary(root).electronBinary, [join(temp, "main.cjs")], { env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding("utf8");
      stream.on("data", (chunk) => { output += chunk; });
    }
    const timer = setTimeout(() => child.kill("SIGKILL"), 45_000);
    let code;
    try {
      code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    } finally { clearTimeout(timer); }
    assert.equal(code, 0, output.slice(-6000));
    const line = output.split(/\r?\n/).find((value) => value.startsWith("SCHEDULED_SIDEBAR_PROBE "));
    assert.ok(line, output.slice(-6000));
    assert.deepEqual(JSON.parse(line.slice("SCHEDULED_SIDEBAR_PROBE ".length)), { passed: true, persisted: false });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
