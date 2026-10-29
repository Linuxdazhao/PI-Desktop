import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./helpers/ts-import-hooks.mjs", import.meta.url));
const renderer = await import("../src/lib/api.ts");
const { createProviderCatalogRuntime } = await import("../electron/main/runtime/provider-catalog.ts");
const main = createProviderCatalogRuntime({ getHost: () => null, modelsDevCatalog: {} });

test("scheduled sidebar defaults off, preserves explicit choices, and rejects invalid writes", () => {
  const previousWindow = globalThis.window;
  globalThis.window = { piDesktop: { platform: "darwin" } };
  try {
    for (const stored of [undefined, false, true]) {
      const settings = renderer.normalizeSettings({ theme: "light", sidebarScheduledTasks: stored });
      assert.equal(settings.sidebarScheduledTasks, stored === true);
      const written = renderer.validateSettingsWrite({ ...settings, fontScale: 1 });
      const persisted = main.validateSettingsWrite(structuredClone(written));
      assert.equal(persisted.sidebarScheduledTasks, stored === true);
    }
    for (const value of ["yes", 1, null, undefined, {}]) {
      assert.throws(
        () => renderer.validateSettingsWrite({ sidebarScheduledTasks: value }),
        /sidebarScheduledTasks is invalid/,
      );
    }
  } finally {
    globalThis.window = previousWindow;
  }
});

test("the scheduled group remembers folding without changing project metadata", async () => {
  const { loadScheduledSidebarCollapsed, saveScheduledSidebarCollapsed, SIDEBAR_PREFERENCES_KEY } =
    await import("../src/lib/sidebar-preferences.ts");
  const previousStorage = globalThis.localStorage;
  const values = new Map([[SIDEBAR_PREFERENCES_KEY, '{"projectMeta":{"/scheduled":{"collapsed":true}}}']]);
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  try {
    assert.equal(loadScheduledSidebarCollapsed(), false);
    saveScheduledSidebarCollapsed(true);
    assert.equal(loadScheduledSidebarCollapsed(), true);
    saveScheduledSidebarCollapsed(false);
    assert.equal(loadScheduledSidebarCollapsed(), false);
    assert.equal(values.get(SIDEBAR_PREFERENCES_KEY), '{"projectMeta":{"/scheduled":{"collapsed":true}}}');
    globalThis.localStorage.getItem = () => { throw new Error("storage unavailable"); };
    assert.equal(loadScheduledSidebarCollapsed(), false);
    globalThis.localStorage.setItem = () => { throw new Error("storage unavailable"); };
    assert.doesNotThrow(() => saveScheduledSidebarCollapsed(true));
  } finally {
    if (previousStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previousStorage;
  }
});
