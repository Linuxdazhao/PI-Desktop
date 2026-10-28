import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import * as shared from "@pi-desktop/shared";

const element = (type, props) => ({ type, props: props ?? {} });
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes)
  : tree?.props ? [tree, ...Object.values(tree.props).flatMap(nodes)] : [];
const components = new Proxy({}, { get: (_, name) => name });

function loadSource(path, imports) {
  const module = { exports: {} };
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  runInNewContext(code, { module, exports: module.exports, require: name => {
    assert.ok(name in imports, `Unexpected import: ${name}`);
    return imports[name];
  } });
  return module.exports;
}

function fixture(initialProject = "/projects/project-a", global = []) {
  const states = [], writes = [], toasts = [];
  let cursor = 0, projectPath = initialProject;
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
      return [states[index], value => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
    },
    useCallback: fn => fn, useMemo: fn => fn(), useEffect() {}, useRef: current => ({ current }),
  };
  const common = {
    react, "react/jsx-runtime": { jsx: element, jsxs: element, Fragment: "fragment" },
    "react-i18next": { useTranslation: () => ({ t: key => key }) },
    "@pi-desktop/shared": shared, "../icons": components,
    "../ui": { ...Object.fromEntries(["Button", "Field", "HelpIcon", "Input", "TooltipButton",
      "SettingsToggle"].map(name => [name, name])), cx: (...parts) => parts.filter(Boolean).join(" ") },
  };
  // Use the real draft defaults, validation and serializer at the save boundary.
  const editor = loadSource("../src/components/extensions/McpEditorSheet.tsx", {
    ...common, "./ScopeControl": components,
    "./KeyValueRows": loadSource("../src/components/extensions/KeyValueRows.tsx", common),
    "./mcp-stdio-launcher": loadSource("../src/components/extensions/mcp-stdio-launcher.ts", {}),
  });
  const page = loadSource("../src/components/settings/AgentMcpPage.tsx", {
    ...common,
    "../../lib/api": { api: { upsertMcpServer: async input => { writes.push(JSON.parse(JSON.stringify(input))); } } },
    "../../stores/app-store": { useAppStore: select => select({ showToast: (...args) => toasts.push(args) }) },
    "../../hooks/use-host-collection": { useHostCollection: () => ({
      data: { global, project: [], statuses: [] }, setData() {}, reload: async () => {},
    }) },
    "../../hooks/use-row-busy": { useRowBusy: () => ({ isBusy: () => false }) },
    "../../lib/mcp-oauth-error": { mcpOAuthErrorTranslationKey: () => undefined },
    "./AgentCapabilityLayout": {
      ...Object.fromEntries(["AgentCapabilityPage", "AgentProjectPicker", "CapabilityButton",
        "CapabilityEmpty", "CapabilityGroupHeader", "CapabilityPanel", "CapabilityRow",
        "CapabilityRowMenu", "CapabilityToggle", "CapabilityToolbar"].map(name => [name, name])),
      matchesCapabilitySearch: () => true, projectDisplayName: path => path,
      useAgentProjects: () => ({ selectedProjectPath: projectPath,
        setSelectedProjectPath: value => { projectPath = value; },
        options: ["/projects/project-a", "/projects/project-b"].map(path => ({ path, name: path })),
      }), useArmedDelete: () => ({ armed: null, setArmed() {} }),
    },
    "../extensions/McpEditorSheet": { ...editor, McpEditorSheet: "McpEditorSheet" },
    "./McpMarketPanel": components,
    "../../features/settings/imports/AgentMcpImportPanel": components,
    "../../features/settings/import-workbench": components,
  });
  const render = () => { cursor = 0; return page.AgentMcpPage(); };
  const find = (type, predicate = () => true) => nodes(render()).find(node => node.type === type && predicate(node.props))?.props;
  return { find, writes, toasts,
    filter: value => find("CapabilityToolbar").onFilterChange(value),
    project: value => find("AgentProjectPicker").onChange(value),
    create: () => find("CapabilityButton", props => props.children?.includes("settings.addMcp")).onClick(),
    async save() {
      const sheet = find("McpEditorSheet");
      sheet.setDraft({ ...sheet.draft, id: "database", label: "Database", command: "npx" });
      const draft = find("McpEditorSheet").draft;
      assert.equal(editor.mcpDraftError(draft), null);
      find("McpEditorSheet").onSave();
      await new Promise(resolve => setImmediate(resolve));
    },
  };
}

for (const [filter, project, expected] of [
  ["all", "/projects/project-a", "project"],
  ["global", "/projects/project-a", "global"],
  ["project", "/projects/project-a", "project"],
  ["all", null, "global"],
]) {
  test(`create and save MCP under ${filter} with ${project ?? "no project"} uses ${expected}`, async () => {
    const f = fixture(project);
    f.filter(filter);
    const tooltip = expected === "project" ? "settings.capabilityCreateInProject" : "settings.capabilityCreateInGlobal";
    const actualTooltip = f.find("CapabilityButton", props => props.children?.includes("settings.addMcp")).title;
    f.create();
    const actualLevel = f.find("McpEditorSheet").managementLevel;
    await f.save();
    assert.equal(f.writes.length, 1);
    assert.equal(f.writes[0].level, expected);
    assert.equal(actualLevel, expected);
    assert.equal(actualTooltip, tooltip);
    assert.equal(f.writes[0].projectPath, expected === "project" ? project : undefined);
    assert.equal(f.writes[0].scope.mode, expected === "project" ? "projects" : "global");
    if (expected === "project") assert.deepEqual(f.writes[0].scope.projects, [project]);
  });
}

test("All follows the selected project for creation, imports and market installs", async () => {
  const f = fixture();
  f.project("/projects/project-b");
  assert.equal(f.find("AgentMcpImportPanel").level, "project");
  assert.equal(f.find("AgentMcpImportPanel").projectPath, "/projects/project-b");
  f.create();
  await f.save();
  assert.equal(f.writes[0].projectPath, "/projects/project-b");
  f.find("CapabilityButton", props => props.children?.includes("settings.mcpMarket.browse")).onClick();
  assert.equal(f.find("McpMarketPanel").level, "project");
  assert.equal(f.find("McpMarketPanel").projectPath, "/projects/project-b");
});

test("Project without a selected project refuses creation instead of saving globally", () => {
  const f = fixture(null);
  f.filter("project");
  f.create();
  assert.equal(f.find("McpEditorSheet"), undefined);
  assert.equal(f.writes.length, 0);
  assert.equal(f.toasts[0][0], "settings.selectProjectFirst");
});

test("editing an existing global MCP retains its owner under All with a project selected", async () => {
  const f = fixture("/projects/project-a", [{ id: "database", label: "Database", transport: "stdio", command: "npx", enabled: true }]);
  f.find("TooltipButton", props => props.ariaLabel === "settings.editMcpOf").onClick();
  assert.equal(f.find("McpEditorSheet").managementLevel, "global");
  await f.save();
  assert.equal(f.writes[0].level, "global");
  assert.equal(f.writes[0].projectPath, undefined);
});
