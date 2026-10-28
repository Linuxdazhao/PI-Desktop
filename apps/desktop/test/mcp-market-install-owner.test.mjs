import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import ts from "typescript";
import * as shared from "@pi-desktop/shared";
import * as marketSnapshot from "../src/lib/market-snapshot.ts";

function fixture({ level, projectPath }) {
  const entry = { id: "fixture", name: "Fixture", transport: "stdio", command: "npx", args: ["-y", "@example/fixture@1.2.3"], env: { TOKEN: "${TOKEN}" }, requiredEnv: [{ name: "TOKEN" }] };
  let stateIndex = 0;
  const states = [], calls = [], toasts = [], installed = [];
  const source = readFileSync(new URL("../src/components/settings/McpMarketPanel.tsx", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const imports = {
    react: { ...React, useEffect() {}, useMemo: callback => callback(), useRef: value => ({ current: value }), useState(initial) {
      const index = stateIndex++;
      if (!(index in states)) states[index] = index === 4 ? entry : index === 5 ? { TOKEN: "fixture-value" } : typeof initial === "function" ? initial() : initial;
      return [states[index], next => { states[index] = typeof next === "function" ? next(states[index]) : next; }];
    } },
    "react/jsx-runtime": jsx, "react-dom": { createPortal: node => node },
    "react-i18next": { useTranslation: () => ({ t: key => key }) }, "@pi-desktop/shared": shared,
    "../../lib/market-snapshot": marketSnapshot,
    "../../lib/api": { api: { upsertMcpServer: async value => { calls.push(["upsert", value]); return { server: { id: value.id } }; } } },
    "../../stores/app-store": { useAppStore: () => (...values) => toasts.push(values) },
    "../icons": new Proxy({}, { get: () => () => null }), "../ui": { Field: () => null, Input: () => null, TooltipButton: () => null, cx: (...parts) => parts.filter(Boolean).join(" ") },
  };
  const exports = {};
  runInNewContext(code, { exports, module: { exports }, window: { localStorage: { getItem: () => null } }, document: { body: {} }, URL, require: id => { assert.ok(id in imports, id); return imports[id]; } });
  const tree = exports.McpMarketPanel({ level, projectPath, installedIds: [], onBack() {}, onInstalled: id => installed.push(id) });
  let action;
  function visit(node) { if (Array.isArray(node)) return node.forEach(visit); if (!node || typeof node !== "object") return;
    if (node.type === "button" && node.props.className === "mcpm-install" && node.props.children === "settings.mcpMarket.install") action = node.props;
    visit(node.props?.children);
  }
  visit(tree); assert.ok(action);
  return { action, calls, installed, toasts };
}
test("the rendered market action writes only to the selected existing MCP owner", async () => {
  for (const level of ["global", "project"]) {
    const f = fixture({ level, projectPath: level === "project" ? "/project-a" : undefined });
    f.action.onClick(); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(f.calls.map(row => row[0]), ["upsert"]);
    const value = f.calls[0][1]; assert.equal(value.level, level); assert.equal(value.command, "npx"); assert.equal(value.args[1], "@example/fixture@1.2.3"); assert.equal(value.env.TOKEN, "fixture-value");
    assert.equal(value.projectPath, level === "project" ? "/project-a" : undefined);
    assert.equal(value.scope.mode, level === "project" ? "projects" : "global");
    if (level === "project") assert.equal(value.scope.projects[0], "/project-a");
    assert.deepEqual(f.installed, ["fixture"]);
  }
});
test("a project install without a selected project never writes", async () => {
  const f = fixture({ level: "project" }); f.action.onClick(); await new Promise(resolve => setImmediate(resolve)); assert.equal(f.calls.length, 0);
});
