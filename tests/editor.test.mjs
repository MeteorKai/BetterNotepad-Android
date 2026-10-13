import test, { before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import { createServer } from "vite";
import { EditorView } from "@codemirror/view";
import { undo, redo, deleteCharBackward, deleteCharForward } from "@codemirror/commands";
import { createNote, DEFAULT_HOME, emptyState } from "../src/notes.mjs";
import { imageBlocks } from "../src/images.mjs";
import { createHash } from "node:crypto";

const path = "/images/0123456789abcdef0123456789abcdef.jpg";
const marker = `![图片](${path})`;
let dom, compiler, App, createRoot, root, saved, requestId;

before(async () => {
  // A local, inert DOM test: no browser, emulator window, or HTTP server.
  dom = new JSDOM('<div id="root"></div>', { url: "https://app.betternotepad.local/", pretendToBeVisual: true });
  for (const name of ["window", "Window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Node", "Text", "MutationObserver", "DOMRect", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"]) {
    Object.defineProperty(globalThis, name, { value: dom.window[name], configurable: true, writable: true });
  }
  // jsdom does not lay out text; these stubs are not visual verification.
  dom.window.Range.prototype.getClientRects = () => [];
  dom.window.Range.prototype.getBoundingClientRect = () => new dom.window.DOMRect();
  dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  ({ createRoot } = await import("react-dom/client"));
  compiler = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, optimizeDeps: { noDiscovery: true, include: [] }, appType: "custom" });
  App = (await compiler.ssrLoadModule("/src/App.tsx")).default;
});

afterEach(async () => { if (root) await act(() => root.unmount()); root = null; delete document.elementFromPoint; delete window.PointerEvent; delete window.BetterNotepadUpdates; });
after(async () => { await compiler?.close(); dom?.window.close(); });

async function click(button) { assert.ok(button); await act(() => button.click()); }
async function type(input, value) {
  assert.ok(input);
  await act(() => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, value);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}
async function choose(select, value) {
  assert.ok(select);
  await act(() => { select.value = value; select.dispatchEvent(new window.Event("change", { bubbles: true })); });
}
async function restart() {
  await act(() => root.unmount()); root = createRoot(document.getElementById("root"));
  await act(() => root.render(React.createElement(App)));
}
const button = text => Array.from(document.querySelectorAll("button")).find(item => item.textContent === text);
const imageButton = () => document.querySelector(".insert-image");
const view = () => EditorView.findFromDOM(document.querySelector(".cm-editor"));

async function mount(content = "前文后文", format = "text", failSave = false, restored = null) {
  saved = restored ?? JSON.stringify({ ...emptyState(), notes: [
    { ...createNote("one", 1), title: "测试便签", content, format },
    { ...createNote("old", 1), title: "原有便签", content: "不能丢失" },
  ] });
  requestId = null;
  window.BetterNotepad = {
    load: () => JSON.stringify({ ok: true, data: saved }),
    save: raw => { if (failSave) return '{"ok":false,"error":"测试保存失败"}'; saved = raw; return '{"ok":true}'; },
    pickImage: id => { requestId = id; },
  };
  root = createRoot(document.getElementById("root"));
  await act(() => root.render(React.createElement(App)));
  await click(document.querySelector('[aria-label^="打开便签：测试便签"]'));
  assert.ok(view());
}

async function selectImage(result = { path }) {
  await click(imageButton());
  assert.match(requestId, /^[a-f0-9]{32}$/);
  await act(() => window.betterNotepadImageResult({ requestId, ...result }));
}

const bulkButton = () => document.querySelector('[aria-label="批量删除便签"]');
const bulkDelete = () => document.querySelector('[aria-label^="删除选中的便签"]');
const selectAll = () => document.querySelector('[aria-label="全选当前列表"], [aria-label="取消全选当前列表"]');
const card = title => Array.from(document.querySelectorAll(".note-card")).find(item => item.querySelector("h2").textContent === title);
const bulkState = () => ({ ...emptyState(), theme: "dark", home: { title: "我的小本子", subtitle: "保留的文案" }, notes: [
  { ...createNote("one", 1), title: "测试便签", content: `原正文\n${marker}`, format: "markdown" },
  { ...createNote("old", 2), title: "原有便签", content: "不能丢失", pinned: true },
  { ...createNote("other", 3), title: "杂记", content: "其他内容" },
] });
async function startBulk(state = bulkState(), failSave = false) {
  await mount("", "text", failSave, JSON.stringify(state));
  await click(document.querySelector('[aria-label="返回便签主页"]'));
  await click(bulkButton());
}

const taggedState = () => ({ ...bulkState(), notes: [
  { ...bulkState().notes[0], tags: ["工作"], todos: [{ id: "task1", text: "预订机票", done: false }] },
  { ...bulkState().notes[1], tags: ["生活"] }, { ...bulkState().notes[2], tags: ["工作", "none"] },
  { ...createNote("plain", 4), title: "未分类便签" },
] });

test("updates stay in settings and an empty repository never starts a request", async () => {
  let requests = 0;
  window.BetterNotepadUpdates = {
    info: () => JSON.stringify({ version: "0.1.20", configured: false }),
    check: () => requests++, download() {}, install() {}, cancel() {},
  };
  await mount();
  await click(document.querySelector('[aria-label="返回便签主页"]'));
  assert.ok(!button("检查更新"));
  await click(document.querySelector('[aria-label="打开设置"]'));
  assert.match(document.querySelector(".update-card").textContent, /当前版本：0.1.20/);
  const before = saved;
  await click(button("检查更新"));
  assert.match(document.querySelector('.update-card [role="alert"]').textContent, /更新源尚未配置/);
  assert.equal(requests, 0); assert.equal(saved, before);
});

async function startUpdates(failSave = false) {
  const calls = [], cancelled = [];
  window.BetterNotepadUpdates = {
    info: () => JSON.stringify({ version: "0.1.20", repository: "fixture/notes", configured: true }),
    check: id => calls.push(["check", id]), download: id => calls.push(["download", id]), install: id => calls.push(["install", id]),
    cancel: id => cancelled.push(id),
  };
  await mount("", "text", failSave, JSON.stringify(taggedState()));
  if (failSave) await type(document.querySelector('[aria-label="便签标题"]'), "尚未保存的新标题");
  await click(document.querySelector('[aria-label="返回便签主页"]'));
  await click(document.querySelector('[aria-label="打开设置"]'));
  const respond = async result => { await act(() => window.betterNotepadUpdateResult({ requestId: calls.at(-1)[1], ...result })); };
  return { calls, cancelled, respond };
}
const release = { version: "0.1.21", size: 4 * 1024 * 1024, notes: "新版说明\n<script>bad()</script>" };

test("updater checks only on tap, ignores unrelated results and can retry check errors", async () => {
  const { calls, respond } = await startUpdates(); const before = saved;
  assert.equal(calls.length, 0);
  await click(button("检查更新")); assert.equal(calls.length, 1); assert.equal(button("检查更新").disabled, true);
  await act(() => window.betterNotepadUpdateResult({ requestId: "wrong", phase: "current", message: "不应显示" }));
  assert.match(document.querySelector(".update-card").textContent, /正在检查/);
  await respond({ phase: "error", message: "更新请求超时，请重试。" });
  assert.match(document.querySelector('.update-card [role="alert"]').textContent, /超时/);
  assert.doesNotMatch(document.querySelector(".update-card").textContent, /已是最新/);
  await click(button("检查更新")); assert.equal(calls.length, 2);
  await respond({ phase: "current", message: "当前已是最新版本。" });
  assert.match(document.querySelector(".update-card").textContent, /已是最新/); assert.ok(!button("下载更新")); assert.equal(saved, before);
});

test("updater escapes release notes, downloads explicitly and reports installer launch without claiming success", async () => {
  const { calls, respond } = await startUpdates(); const before = saved;
  await click(button("检查更新")); await respond({ phase: "available", release, ready: false });
  assert.ok(!document.querySelector(".update-card script")); assert.match(document.querySelector(".update-release").textContent, /<script>/);
  assert.equal(calls.length, 1); await click(button("下载更新")); assert.equal(calls.at(-1)[0], "download");
  await respond({ phase: "downloading", progress: 64 }); assert.equal(document.querySelector(".update-card progress").value, 64);
  assert.equal(button("下载更新").disabled, true);
  await respond({ phase: "ready", ready: true, message: "下载和校验完成" }); assert.ok(button("安装更新"));
  assert.equal(calls.length, 2); await click(button("安装更新")); assert.equal(calls.at(-1)[0], "install");
  await respond({ phase: "permission", ready: true, message: "允许安装应用，返回后点击继续安装。" });
  assert.ok(button("继续安装")); assert.equal(calls.length, 3);
  await click(button("继续安装")); await respond({ phase: "installer", ready: true, message: "已打开系统安装界面，请确认安装。" });
  assert.match(document.querySelector(".update-card").textContent, /请确认安装/); assert.doesNotMatch(document.querySelector(".update-card").textContent, /更新成功/);
  assert.ok(button("安装更新")); assert.equal(saved, before);
});

test("cancelled downloads ignore late callbacks and leaving settings cancels the pending job", async () => {
  const { calls, cancelled, respond } = await startUpdates(); const before = saved;
  await click(button("检查更新")); await respond({ phase: "available", release }); await click(button("下载更新"));
  const old = calls.at(-1)[1]; await click(button("取消更新")); assert.equal(cancelled.at(-1), old);
  await act(() => window.betterNotepadUpdateResult({ requestId: old, phase: "ready", ready: true })); assert.ok(!button("安装更新"));
  await click(button("下载更新")); const pending = calls.at(-1)[1];
  await click(document.querySelector('[aria-label="返回便签主页"]')); assert.equal(cancelled.at(-1), pending);
  assert.ok(!window.betterNotepadUpdateResult); assert.equal(saved, before);
  await click(document.querySelector('[aria-label="打开设置"]')); assert.ok(!button("下载更新"));
});

test("invalid cached update returns to download and an unsaved notebook blocks installation", async () => {
  const { respond } = await startUpdates(true); const before = saved;
  await click(button("检查更新")); await respond({ phase: "available", release });
  assert.equal(button("下载更新").disabled, true); assert.match(document.querySelector(".update-card").textContent, /重试保存/);
  window.BetterNotepad.save = raw => { saved = raw; return '{"ok":true}'; }; await click(button("重试保存"));
  await click(button("下载更新")); await respond({ phase: "ready", ready: true });
  await click(button("安装更新")); await respond({ phase: "error", ready: false, message: "安装包已改变，请重新下载。" });
  assert.ok(!button("安装更新")); assert.ok(button("下载更新")); assert.deepEqual(JSON.parse(saved).trash, JSON.parse(before).trash);
});

test("browser update entry explains native-only behavior", async () => {
  await mount(); await click(document.querySelector('[aria-label="返回便签主页"]')); await click(document.querySelector('[aria-label="打开设置"]'));
  await click(button("检查更新")); assert.match(document.querySelector('.update-card [role="alert"]').textContent, /Android 应用/);
});

async function checkedMount() {
  await mount("", "text", false, JSON.stringify(taggedState()));
  const stats = { reads: 0, writes: 0, fail: false };
  const revision = () => createHash("sha256").update(saved).digest("hex");
  window.BetterNotepad.load = () => { stats.reads++; return JSON.stringify({ ok: true, data: saved, revision: revision() }); };
  window.BetterNotepad.saveChecked = (raw, expected) => {
    stats.writes++;
    if (expected !== revision()) return JSON.stringify({ ok: false, conflict: true, error: "便签已在桌面更新" });
    if (stats.fail) return JSON.stringify({ ok: false, error: "测试写入失败" });
    saved = raw; return JSON.stringify({ ok: true, revision: revision() });
  };
  await restart(); await click(card("测试便签"));
  return stats;
}
function desktopDone() {
  const data = JSON.parse(saved); data.notes[0].todos[0].done = true; data.notes[0].updatedAt++;
  saved = JSON.stringify(data);
}

test("widget entry stays in settings, invokes native configuration and explains browser limitations", async () => {
  await mount();
  assert.ok(!button("添加桌面小组件"));
  await click(document.querySelector('[aria-label="返回便签主页"]'));
  assert.ok(!button("添加桌面小组件"));
  await click(document.querySelector('[aria-label="打开设置"]'));
  const baseline = saved;
  await click(button("添加桌面小组件"));
  assert.match(document.querySelector(".data-error").textContent, /Android/);
  let opens = 0; window.BetterNotepad.configureWidget = () => opens++;
  await click(button("添加桌面小组件"));
  assert.equal(opens, 1); assert.equal(saved, baseline);
  assert.ok(document.querySelector(".settings-page"));
  assert.match(document.querySelector(".settings-page").textContent, /支持小部件应用 → 全部 → 安卓小部件/);
  assert.match(document.querySelector(".settings-page").textContent, /请求不等于添加成功/);
});

test("widget intent opens its note after ready, handles warm launches and ignores removed notes", async () => {
  const stats = await checkedMount();
  let ready = 0;
  window.BetterNotepad.ready = () => { ready++; window.betterNotepadResume("old"); };
  await restart();
  assert.equal(ready, 1);
  assert.equal(document.querySelector('[aria-label="便签标题"]').value, "原有便签");
  await act(() => { assert.equal(window.betterNotepadResume("one"), true); });
  assert.equal(document.querySelector('[aria-label="便签标题"]').value, "测试便签");
  await act(() => { assert.equal(window.betterNotepadResume("removed"), true); });
  assert.ok(!document.querySelector(".note-page"));
  assert.equal(stats.writes, 0);
});

test("returning from desktop reloads checked tasks without resetting unchanged body or cursor", async () => {
  const stats = await checkedMount(); const editor = view();
  await act(() => editor.dispatch({ selection: { anchor: 2 } }));
  desktopDone();
  await act(() => { assert.equal(window.betterNotepadResume(null), true); });
  assert.equal(view(), editor); assert.equal(view().state.selection.main.anchor, 2);
  assert.equal(document.querySelector('.todo-check input').checked, true);
  await act(() => view().dispatch({ changes: { from: 0, insert: "新增正文\n" } }));
  assert.equal(JSON.parse(saved).notes[0].todos[0].done, true);
  assert.match(JSON.parse(saved).notes[0].content, /^新增正文/);
  assert.equal(stats.writes, 1);
  const data = JSON.parse(saved); data.notes[0].content = "来自另一页面的新正文"; saved = JSON.stringify(data);
  await act(() => window.betterNotepadResume(null));
  assert.notEqual(view(), editor); assert.equal(view().state.doc.toString(), data.notes[0].content);
});

test("raced desktop changes reject stale writes and keep drafts until an explicit confirmed reload", async () => {
  const stats = await checkedMount(); desktopDone(); const committed = saved;
  await act(() => view().dispatch({ changes: { from: 0, insert: "未保存草稿\n" } }));
  assert.equal(saved, committed); assert.equal(stats.writes, 1);
  assert.match(document.querySelector('[role="alert"]').textContent, /桌面更新/);
  assert.ok(!button("重试保存"));
  const reads = stats.reads;
  await act(() => { assert.equal(window.betterNotepadResume("old"), false); });
  assert.equal(stats.reads, reads); assert.match(view().state.doc.toString(), /^未保存草稿/);
  await act(() => view().dispatch({ changes: { from: 0, insert: "继续保留\n" } }));
  assert.equal(stats.writes, 1); assert.equal(saved, committed);
  await click(button("重新读取")); assert.ok(document.querySelector('[aria-labelledby="reload-title"]').open);
  await click(button("保留当前草稿")); assert.match(view().state.doc.toString(), /^继续保留/);
  await click(button("重新读取"));
  await act(() => { assert.equal(window.betterNotepadBack(), true); });
  assert.match(view().state.doc.toString(), /^继续保留/);
  await click(button("重新读取")); await click(button("确认重新读取"));
  assert.equal(saved, committed); assert.ok(!document.querySelector('[role="alert"]'));
  assert.equal(document.querySelector('.todo-check input').checked, true);
  assert.equal(view().state.doc.toString(), JSON.parse(committed).notes[0].content);
  await type(document.querySelector('[aria-label="便签标题"]'), "重新读取后编辑");
  assert.equal(JSON.parse(saved).notes[0].title, "重新读取后编辑");
  assert.equal(JSON.parse(saved).notes[0].todos[0].done, true);
});

test("failed-save drafts do not advance revision when resume arrives, so retry cannot overwrite desktop tasks", async () => {
  const stats = await checkedMount(); stats.fail = true;
  await type(document.querySelector('[aria-label="便签标题"]'), "草稿标题");
  desktopDone(); const committed = saved; const reads = stats.reads;
  await act(() => { assert.equal(window.betterNotepadResume(null), false); });
  assert.equal(stats.reads, reads); assert.equal(document.querySelector('[aria-label="便签标题"]').value, "草稿标题");
  assert.ok(button("添加桌面小组件") === undefined);
  stats.fail = false; await click(button("重试保存"));
  assert.equal(saved, committed); assert.ok(!button("重试保存"));
  await click(document.querySelector('[aria-label="返回便签主页"]'));
  await click(document.querySelector('[aria-label="打开设置"]'));
  assert.ok(button("添加桌面小组件").disabled);
});

test("resume skips pending image import and backup previews rather than invalidating in-flight operations", async () => {
  const stats = await checkedMount();
  await click(imageButton()); const reads = stats.reads;
  await act(() => { assert.equal(window.betterNotepadResume(null), false); });
  assert.equal(stats.reads, reads);
  await act(() => window.betterNotepadImageResult({ requestId, path }));
  assert.equal(imageBlocks(JSON.parse(saved).notes[0].content).length, 2);
  await click(document.querySelector('[aria-label="返回便签主页"]'));
  await click(document.querySelector('[aria-label="打开设置"]'));
  const bridge = backupBridge();
  await click(button("从备份恢复"));
  await bridge.result({ phase: "preview", notes: 1, trash: 0, images: 0, createdAt: 1 });
  const afterPreview = stats.reads;
  await act(() => { assert.equal(window.betterNotepadResume(null), false); });
  assert.equal(stats.reads, afterPreview); assert.ok(button("合并恢复"));
  await click(button("取消恢复"));
});

test("resume read failures block stale writes and failed reload retains the draft and confirmation", async () => {
  const stats = await checkedMount(); const committed = saved;
  const originalLoad = window.BetterNotepad.load;
  window.BetterNotepad.load = () => '{"ok":false,"error":"测试读取失败"}';
  await act(() => { assert.equal(window.betterNotepadResume(null), false); });
  await type(document.querySelector('[aria-label="便签标题"]'), "暂存文字");
  assert.equal(saved, committed); assert.equal(stats.writes, 0);
  await click(button("重新读取")); await click(button("确认重新读取"));
  assert.ok(document.querySelector('[aria-labelledby="reload-title"]').open);
  assert.equal(document.querySelector('[aria-label="便签标题"]').value, "暂存文字");
  window.BetterNotepad.load = originalLoad;
  await click(button("确认重新读取"));
  assert.equal(saved, committed); assert.equal(document.querySelector('[aria-label="便签标题"]').value, "测试便签");
});

test("backup merge reads desktop changes made while the file picker was open", async () => {
  await checkedMount();
  await click(document.querySelector('[aria-label="返回便签主页"]'));
  await click(document.querySelector('[aria-label="打开设置"]'));
  const bridge = backupBridge(); await click(button("从备份恢复"));
  desktopDone();
  await bridge.result({ phase: "preview", notes: 1, trash: 1, images: 1, createdAt: 1 });
  await click(button("合并恢复"));
  const submitted = JSON.parse(bridge.submitted);
  assert.equal(submitted.notes.find(note => note.id === "one").todos[0].done, true);
  await bridge.result({ phase: "restored" });
  assert.equal(JSON.parse(saved).notes.find(note => note.id === "one").todos[0].done, true);
});

test("note tags trim, reuse, reject duplicates and persist without rewriting the body", async () => {
  await mount("原文字\n" + marker, "markdown", false, JSON.stringify(taggedState()));
  const original = JSON.parse(saved).notes[0], editor = view();
  await click(document.querySelector('[aria-label="管理便签标签"]'));
  assert.ok(document.querySelector(".tag-dialog[open]"));
  await type(document.querySelector('[aria-label="新标签"]'), "  学习  "); await click(button("添加"));
  await click(document.querySelector('[aria-label="添加标签：生活"]'));
  assert.deepEqual(JSON.parse(saved).notes[0].tags, ["工作", "学习", "生活"]);
  await type(document.querySelector('[aria-label="新标签"]'), "学习"); await click(button("添加"));
  assert.match(document.querySelector('.tag-dialog [role="alert"]').textContent, /已经添加/);
  await click(document.querySelector('[aria-label="移除标签：工作"]'));
  await act(() => { assert.equal(window.betterNotepadBack(), true); });
  assert.ok(!document.querySelector(".tag-dialog")); assert.ok(view() === editor);
  assert.equal(view().state.doc.toString(), original.content);
  assert.deepEqual(JSON.parse(saved).notes[0].tags, ["学习", "生活"]);
  const persisted = saved; await restart(); await click(card("测试便签"));
  assert.equal(saved, persisted); assert.match(document.querySelector(".note-tags").textContent, /学习生活/);
});

test("tag length/count and failed save are explicit rather than silently losing edits", async () => {
  const state = taggedState(); state.notes[0].tags = Array.from({ length: 8 }, (_, i) => `标签${i}`);
  await mount("", "text", false, JSON.stringify(state));
  await click(document.querySelector('[aria-label="管理便签标签"]'));
  const baseline = saved;
  await type(document.querySelector('[aria-label="新标签"]'), "多一个"); await click(button("添加"));
  assert.match(document.querySelector('.tag-dialog [role="alert"]').textContent, /最多.*8/); assert.equal(saved, baseline);
  await type(document.querySelector('[aria-label="新标签"]'), "长".repeat(21)); await click(button("添加"));
  assert.match(document.querySelector('.tag-dialog [role="alert"]').textContent, /20/); assert.equal(saved, baseline);
  await click(document.querySelector('[aria-label="移除标签：标签0"]'));
  window.BetterNotepad.save = () => '{"ok":false,"error":"disk full"}';
  const retained = saved;
  await type(document.querySelector('[aria-label="新标签"]'), "新标签"); await click(button("添加"));
  assert.equal(saved, retained); assert.match(document.querySelector('.tag-dialog [role="alert"]').textContent, /尚未保存/);
  await click(button("完成"));
  window.BetterNotepad.save = raw => { saved = raw; return '{"ok":true}'; };
  await click(button("重试保存")); assert.ok(JSON.parse(saved).notes[0].tags.includes("新标签"));
});

const point = (x = 40, y = 140, identifier = 1) => ({ clientX: x, clientY: y, identifier });
async function touch(element, type, touches, changedTouches = touches) {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, { touches: { value: touches }, changedTouches: { value: changedTouches } });
  await act(() => element.dispatchEvent(event)); return event;
}
async function notePointer(element, type, position = point(), options = {}) {
  const event = new window.MouseEvent(type, { bubbles: true, cancelable: true, ...position, button: 0, buttons: type === "pointerup" ? 0 : 1 });
  Object.defineProperties(event, { pointerId: { value: options.id ?? 1 }, pointerType: { value: options.kind ?? "touch" }, isPrimary: { value: options.primary ?? true } });
  await act(() => element.dispatchEvent(event)); return event;
}
function noteGeometry() {
  // Inert jsdom rectangles, not real WebView layout or touchscreen verification.
  document.elementFromPoint = (x, y) => {
    if (x < 0 || y < 100 || x >= 300 || x % 150 >= 130 || (y - 100) % 160 >= 140) return null;
    return document.querySelectorAll('.notes-grid [data-note-id]')[Math.floor((y - 100) / 160) * 2 + Math.floor(x / 150)]?.querySelector("h2") ?? null;
  };
}
const cardOrder = () => Array.from(document.querySelectorAll('.notes-grid [data-note-id]'), item => item.dataset.noteId);
const arrangeNotes = () => document.querySelector('[aria-label="排列便签"]');
const dragHandle = title => card(title)?.querySelector('[data-note-handle]');
const shiftNote = offset => document.querySelector(`[aria-label="将选中便签${offset < 0 ? "前" : "后"}移"]`);
const sortableState = () => ({ ...bulkState(), notes: [
  { ...bulkState().notes[0], createdAt: 10, updatedAt: 10, tags: ["工作", "生活"] },
  { ...bulkState().notes[1], pinned: false, createdAt: 20, updatedAt: 20 },
  { ...bulkState().notes[2], createdAt: 30, updatedAt: 30, tags: ["工作"] },
  { ...createNote("extra", 40), title: "额外便签", content: "末篇" },
] });
async function homeSortMount(state = sortableState(), fail = false) {
  await mount("", "text", fail, JSON.stringify(state));
  await click(document.querySelector('[aria-label="返回便签主页"]')); noteGeometry(); return state;
}
async function enableNoteSort() { const arrange = arrangeNotes(); assert.ok(arrange && !arrange.disabled); await click(arrange); return arrange; }

test("tags are restored to ordinary management and removal without any arrangement controls", async () => {
  await mount("", "text", false, JSON.stringify(sortableState()));
  const baseline = saved, tag = document.querySelector('[aria-label="修改便签标签：工作"]');
  assert.ok(!document.querySelector('[aria-label="排列便签标签"]'));
  assert.equal((await touch(tag, "touchstart", [point()])).defaultPrevented, false);
  await touch(tag, "touchend", [], [point(190)]); assert.equal(saved, baseline);
  await click(tag); assert.ok(document.querySelector('.tag-dialog[open]'));
  assert.ok(!document.querySelector('[aria-label="排列便签标签"], .tag-drag-preview, .tag-order-actions'));
  await click(document.querySelector('[aria-label="移除标签：生活"]'));
  assert.deepEqual(JSON.parse(saved).notes[0].tags, ["工作"]);
});

test("normal home cards still scroll and open notes without starting any drag", async () => {
  await homeSortMount(); const baseline = saved;
  assert.ok(!document.querySelector('[data-note-handle]'));
  const start = await touch(card("额外便签"), "touchstart", [point()]);
  const move = await touch(card("额外便签"), "touchmove", [point(190)]);
  assert.equal(start.defaultPrevented, false); assert.equal(move.defaultPrevented, false);
  assert.equal(saved, baseline); assert.ok(!document.querySelector('.note-drag-preview'));
  await click(card("额外便签")); assert.equal(document.querySelector('[aria-label="便签标题"]').value, "额外便签");
});

test("the home arrangement button enables immediate handle dragging and persists one endpoint swap", async () => {
  const state = await homeSortMount(); assert.deepEqual(cardOrder(), ["extra", "other", "old", "one"]);
  const arrange = await enableNoteSort(), handle = dragHandle("额外便签");
  assert.equal(arrange.getAttribute("aria-pressed"), "true"); assert.ok(!bulkButton());
  let writes = 0; const save = window.BetterNotepad.save; window.BetterNotepad.save = raw => { writes++; return save(raw); };
  assert.equal((await touch(handle, "touchstart", [point()])).defaultPrevented, true);
  assert.match(document.querySelector('.note-drag-preview').textContent, /额外便签/);
  await touch(handle, "touchmove", [point(190, 300)]); assert.equal(writes, 0);
  await touch(handle, "touchend", [], [point(190, 300)]); assert.equal(writes, 1);
  assert.deepEqual(cardOrder(), ["one", "other", "old", "extra"]);
  for (const note of JSON.parse(saved).notes) assert.deepEqual(note, state.notes.find(item => item.id === note.id));
  assert.equal(JSON.parse(saved).manualOrder, true);
  const compatibility = new window.MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 });
  await act(() => card("额外便签").dispatchEvent(compatibility));
  assert.ok(compatibility.defaultPrevented); assert.ok(!document.querySelector('.note-page'));
  await click(arrange); await restart(); assert.deepEqual(cardOrder(), ["one", "other", "old", "extra"]);
  assert.equal(arrangeNotes().getAttribute("aria-pressed"), "false");
  await click(card("测试便签")); assert.ok(view()); assert.deepEqual(JSON.parse(saved).notes[0].tags, ["工作", "生活"]);
});

test("PointerEvents with duplicate legacy events commit only the pointer-owned card gesture", async () => {
  window.PointerEvent = window.MouseEvent; await homeSortMount(); await enableNoteSort();
  const handle = dragHandle("额外便签"); let writes = 0; const save = window.BetterNotepad.save;
  window.BetterNotepad.save = raw => { writes++; return save(raw); };
  await notePointer(handle, "pointerdown"); await touch(handle, "touchstart", [point()]);
  await touch(handle, "touchcancel", [], [point()]); assert.ok(document.querySelector('.note-drag-preview'));
  const event = await notePointer(document, "pointermove", point(40, 300)); assert.ok(event.defaultPrevented);
  await notePointer(document, "pointerup", point(40, 300)); await touch(handle, "touchend", [], [point(40, 300)]);
  assert.equal(writes, 1); assert.deepEqual(cardOrder(), ["old", "other", "extra", "one"]);
});

test("touch-first gestures survive duplicate pointer events and use their own identifier", async () => {
  await homeSortMount(); await enableNoteSort(); const handle = dragHandle("额外便签");
  await touch(handle, "touchstart", [point(40, 140, 7)]); await notePointer(handle, "pointerdown");
  await notePointer(handle, "pointercancel"); assert.ok(document.querySelector('.note-drag-preview'));
  await touch(document, "touchmove", [point(190, 300, 7)]);
  await touch(document, "touchend", [], [point(190, 300, 7)]); await notePointer(document, "pointerup", point(190, 300));
  assert.deepEqual(cardOrder(), ["one", "other", "old", "extra"]);
});

test("a WebView rejecting pointer capture cannot block document-tracked note swaps", async () => {
  await homeSortMount(); await enableNoteSort();
  card("额外便签").setPointerCapture = () => { throw new window.DOMException("rejected", "NotFoundError"); };
  await notePointer(dragHandle("额外便签"), "pointerdown");
  await notePointer(document, "pointermove", point(190, 140)); await notePointer(document, "pointerup", point(190, 140));
  assert.deepEqual(cardOrder(), ["other", "extra", "old", "one"]);
});

test("self, blank, outside-grid and foreign-list drops never save or open a note", async () => {
  await homeSortMount(); await enableNoteSort(); const baseline = saved;
  for (const destination of [point(), point(145), point(400), point(40, 700)]) {
    const handle = dragHandle("额外便签"); await touch(handle, "touchstart", [point()]);
    await touch(handle, "touchmove", [destination]); await touch(handle, "touchend", [], [destination]);
    assert.equal(saved, baseline); assert.ok(!document.querySelector('.note-page'));
  }
  const external = document.createElement("button"); external.dataset.noteId = "one"; document.body.append(external);
  try {
    document.elementFromPoint = () => external; await touch(dragHandle("额外便签"), "touchstart", [point()]);
    await touch(document, "touchend", [], [point(190)]); assert.equal(saved, baseline);
  } finally { external.remove(); }
});

test("sorting mode allows scrolling from card bodies and only handles claim the drag gesture", async () => {
  await homeSortMount(); await enableNoteSort(); const baseline = saved, item = card("杂记");
  assert.equal((await touch(item.querySelector("p"), "touchstart", [point(190)])).defaultPrevented, false);
  assert.equal((await touch(item, "touchmove", [point(190, 300)])).defaultPrevented, false);
  await touch(item, "touchend", [], [point(190, 300)]); assert.equal(saved, baseline);
  await click(item); assert.ok(!document.querySelector('.note-page'));
  assert.match(document.querySelector('.note-order-actions').textContent, /已选：杂记/);
});

test("fallback arrows reorder selected cards, enforce group boundaries and work without dragging", async () => {
  await homeSortMount(); await enableNoteSort(); assert.equal(shiftNote(-1).disabled, true);
  await click(card("原有便签")); await click(shiftNote(1));
  assert.deepEqual(cardOrder(), ["extra", "other", "one", "old"]); assert.equal(shiftNote(1).disabled, true);
  await click(shiftNote(-1)); assert.deepEqual(cardOrder(), ["extra", "other", "old", "one"]);
  await act(() => { assert.equal(window.betterNotepadBack(), true); });
  assert.ok(!document.querySelector('[data-note-handle]')); await restart();
  assert.deepEqual(cardOrder(), ["extra", "other", "old", "one"]); assert.equal(JSON.parse(saved).manualOrder, true);
});

test("category sorting swaps only visible notes and changing scope cancels the old gesture", async () => {
  await homeSortMount(); const filter = document.querySelector('[aria-label="按标签筛选便签"]');
  await choose(filter, "tag:工作"); assert.deepEqual(cardOrder(), ["other", "one"]); await enableNoteSort();
  await touch(dragHandle("杂记"), "touchstart", [point()]); await touch(document, "touchend", [], [point(190)]);
  assert.deepEqual(JSON.parse(saved).notes.map(note => note.id), ["extra", "one", "old", "other"]);
  await touch(dragHandle("测试便签"), "touchstart", [point()]); const committed = saved;
  await choose(filter, "all"); await touch(document, "touchend", [], [point(190)]);
  assert.equal(saved, committed); assert.equal(arrangeNotes().getAttribute("aria-pressed"), "false");
  assert.deepEqual(cardOrder(), ["extra", "one", "old", "other"]);
  await enableNoteSort(); await click(document.querySelector('[aria-label="搜索便签"]'));
  assert.ok(!arrangeNotes()); await type(document.querySelector('[aria-label="搜索便签"]'), "原正文");
  assert.deepEqual(cardOrder(), ["one"]);
});

test("pin groups retain priority, reject cross-group drops and can be independently arranged", async () => {
  const state = sortableState(); state.notes[1].pinned = true; state.notes[3].pinned = true;
  await homeSortMount(state); await enableNoteSort(); assert.deepEqual(cardOrder(), ["extra", "old", "other", "one"]);
  const baseline = saved; await touch(dragHandle("额外便签"), "touchstart", [point()]);
  await touch(document, "touchend", [], [point(40, 300)]); assert.equal(saved, baseline);
  await click(shiftNote(1)); assert.deepEqual(cardOrder(), ["old", "extra", "other", "one"]); assert.equal(shiftNote(1).disabled, true);
  await click(document.querySelector('[aria-label="只看已置顶便签"]')); assert.deepEqual(cardOrder(), ["old", "extra"]);
  await enableNoteSort(); await touch(dragHandle("原有便签"), "touchstart", [point()]);
  await touch(document, "touchend", [], [point(190)]); assert.deepEqual(cardOrder(), ["extra", "old"]);
  assert.equal(JSON.parse(saved).notes.find(note => note.id === "other").pinned, false);
});

test("fewer than two same-group notes disable arrangement and sorting never mixes with bulk deletion", async () => {
  const state = sortableState(); state.notes = state.notes.slice(0, 2); state.notes[1].pinned = true;
  await homeSortMount(state); assert.equal(arrangeNotes().disabled, true);
  await click(bulkButton()); assert.ok(!arrangeNotes()); await click(document.querySelector('[aria-label="退出批量选择"]'));
  await click(card("原有便签")); await click(document.querySelector('[aria-label="取消置顶"]'));
  await click(document.querySelector('[aria-label="返回便签主页"]')); assert.equal(arrangeNotes().disabled, false);
  await enableNoteSort(); assert.ok(!bulkButton()); assert.ok(!document.querySelector('[aria-label="新建便签"]'));
});

test("cancellation, extra fingers, width changes, lost capture and blur never commit a pending swap", async () => {
  await homeSortMount(); await enableNoteSort(); const baseline = saved, width = window.innerWidth;
  const cancellations = [
    () => touch(document, "touchcancel", [], [point()]),
    () => touch(document.body, "touchstart", [point(), point(190, 140, 2)]),
    () => act(() => window.dispatchEvent(new window.Event("blur"))),
    () => act(() => { window.innerWidth = width - 20; window.dispatchEvent(new window.Event("resize")); }),
  ];
  try {
    for (const cancel of cancellations) {
      await touch(dragHandle("额外便签"), "touchstart", [point()]); await touch(document, "touchmove", [point(190)]);
      await cancel(); await touch(document, "touchend", [], [point(190)]); assert.equal(saved, baseline);
      assert.ok(!document.querySelector('.note-drag-preview'));
    }
    await notePointer(dragHandle("额外便签"), "pointerdown"); await notePointer(document, "lostpointercapture");
    await notePointer(document, "pointerup", point(190)); assert.equal(saved, baseline);
  } finally { window.innerWidth = width; }
});

test("finishing or navigating away releases gesture listeners and does not carry sorting into editors", async () => {
  await homeSortMount(); const baseline = saved;
  for (let i = 0; i < 3; i++) {
    await enableNoteSort(); await touch(dragHandle("额外便签"), "touchstart", [point()]);
    await click(arrangeNotes()); await touch(document, "touchend", [], [point(190)]); assert.equal(saved, baseline);
  }
  await enableNoteSort(); await touch(dragHandle("额外便签"), "touchstart", [point()]);
  await act(() => { assert.equal(window.betterNotepadBack(), true); }); await touch(document, "touchend", [], [point(190)]);
  assert.equal(saved, baseline); await click(card("测试便签")); assert.ok(view());
  assert.ok(!document.querySelector('[data-note-handle], .note-order-actions'));
});

test("failed reorders retain a visible draft and retry saves it without modifying note metadata", async () => {
  const state = await homeSortMount(sortableState(), true), baseline = saved; await enableNoteSort();
  await click(shiftNote(1)); assert.equal(saved, baseline); assert.deepEqual(cardOrder(), ["other", "extra", "old", "one"]);
  assert.match(document.querySelector('.error-banner').textContent, /尚未保存/);
  window.BetterNotepad.save = raw => { saved = raw; return '{"ok":true}'; }; await click(button("重试保存"));
  const data = JSON.parse(saved); assert.equal(data.manualOrder, true);
  for (const note of data.notes) assert.deepEqual(note, state.notes.find(item => item.id === note.id));
  await restart(); assert.deepEqual(cardOrder(), ["other", "extra", "old", "one"]);
});

test("a raced desktop task update rejects stale reorder saves and confirmed reload keeps desktop data", async () => {
  await checkedMount(); await click(document.querySelector('[aria-label="返回便签主页"]')); noteGeometry(); await enableNoteSort();
  await click(card("未分类便签"));
  desktopDone(); const committed = saved; await click(shiftNote(1));
  assert.equal(saved, committed); assert.match(document.querySelector('.error-banner').textContent, /桌面/);
  assert.ok(!button("重试保存")); await click(button("重新读取")); await click(button("确认重新读取"));
  assert.equal(saved, committed); assert.equal(JSON.parse(saved).notes[0].todos[0].done, true);
  assert.equal(arrangeNotes().getAttribute("aria-pressed"), "false"); assert.ok(!document.querySelector('.error-banner'));
});

test("native resume with new data cancels active sorting and never commits its old snapshot", async () => {
  await checkedMount(); await click(document.querySelector('[aria-label="返回便签主页"]')); noteGeometry(); await enableNoteSort();
  await touch(dragHandle("未分类便签"), "touchstart", [point(190)]); desktopDone(); const committed = saved;
  await act(() => { assert.equal(window.betterNotepadResume(null), true); }); await touch(document, "touchend", [], [point(40, 300)]);
  assert.equal(saved, committed); assert.equal(arrangeNotes().getAttribute("aria-pressed"), "false");
  assert.ok(!document.querySelector('.note-drag-preview'));
});

test("edge dragging scrolls long lists and cancellation stops the animation loop", async () => {
  await homeSortMount(); await enableNoteSort();
  const original = { request: window.requestAnimationFrame, cancel: window.cancelAnimationFrame, scroll: window.scrollBy, y: window.scrollY };
  const callbacks = []; let cancelled = 0;
  window.requestAnimationFrame = callback => { callbacks.push(callback); return callbacks.length; };
  window.cancelAnimationFrame = () => cancelled++;
  window.scrollBy = (_, delta) => { window.scrollY += delta; };
  try {
    await touch(dragHandle("额外便签"), "touchstart", [point()]);
    await touch(document, "touchmove", [point(40, window.innerHeight - 10)]);
    await act(() => callbacks.shift()()); assert.equal(window.scrollY, original.y + 12);
    await touch(document, "touchcancel", [], [point()]); const stopped = window.scrollY;
    await act(() => callbacks.shift()()); assert.equal(window.scrollY, stopped); assert.ok(cancelled > 0);
  } finally {
    window.requestAnimationFrame = original.request; window.cancelAnimationFrame = original.cancel;
    window.scrollBy = original.scroll; window.scrollY = original.y;
  }
});

test("editing and adding a note preserve manual card order across restart", async () => {
  await homeSortMount(); await enableNoteSort(); await click(shiftNote(1)); await click(arrangeNotes());
  await click(card("测试便签")); await type(document.querySelector('[aria-label="便签标题"]'), "测试便签已编辑");
  await click(document.querySelector('[aria-label="返回便签主页"]')); assert.deepEqual(cardOrder(), ["other", "extra", "old", "one"]);
  await click(document.querySelector('[aria-label="新建便签"]')); const id = JSON.parse(saved).notes[0].id;
  await click(document.querySelector('[aria-label="返回便签主页"]')); assert.deepEqual(cardOrder(), [id, "other", "extra", "old", "one"]);
  await restart(); assert.deepEqual(cardOrder(), [id, "other", "extra", "old", "one"]);
});
test("tag filters clear hidden selections and bulk delete only the visible tagged notes", async () => {
  const original = taggedState(); await mount("", "text", false, JSON.stringify(original));
  await click(document.querySelector('[aria-label="返回便签主页"]'));
  const filter = document.querySelector('[aria-label="按标签筛选便签"]');
  await choose(filter, "tag:工作"); assert.equal(document.querySelectorAll(".note-card").length, 2);
  await click(bulkButton()); await click(card("测试便签"));
  await choose(filter, "tag:生活"); assert.equal(bulkDelete().disabled, true); assert.equal(document.querySelectorAll(".note-card").length, 1);
  await choose(filter, "none"); assert.equal(document.querySelector(".note-card h2").textContent, "未分类便签");
  await choose(filter, "tag:none"); assert.equal(document.querySelector(".note-card h2").textContent, "杂记");
  await choose(filter, "tag:工作"); await click(selectAll()); await click(bulkDelete()); await click(button("确认删除"));
  assert.deepEqual(JSON.parse(saved).notes.map(note => note.id), ["old", "plain"]);
  assert.deepEqual(JSON.parse(saved).trash.map(note => note.id), ["one", "other"]);
  assert.deepEqual(JSON.parse(saved).trash[0].todos, original.notes[0].todos);
  assert.equal(document.querySelector('[aria-label="按标签筛选便签"]').value, "all");
});

test("tag filters combine with pins, new notes inherit the category, and search covers tags/todos globally", async () => {
  await mount("", "text", false, JSON.stringify(taggedState())); await click(document.querySelector('[aria-label="返回便签主页"]'));
  await choose(document.querySelector('[aria-label="按标签筛选便签"]'), "tag:工作");
  await click(document.querySelector('[aria-label="只看已置顶便签"]')); assert.equal(document.querySelectorAll(".note-card").length, 0);
  await click(document.querySelector(".filters button:first-child"));
  await click(document.querySelector('[aria-label="新建便签"]'));
  assert.deepEqual(JSON.parse(saved).notes[0].tags, ["工作"]);
  await click(document.querySelector('[aria-label="返回便签主页"]'));
  await choose(document.querySelector('[aria-label="按标签筛选便签"]'), "tag:生活");
  await click(document.querySelector('button[aria-label="搜索便签"]'));
  const input = document.querySelector('input[aria-label="搜索便签"]');
  await type(input, "机票"); assert.equal(document.querySelector(".note-card h2").textContent, "测试便签");
  await type(input, "工作"); assert.equal(document.querySelectorAll(".note-card").length, 3);
  await act(() => { assert.equal(window.betterNotepadBack(), true); });
  assert.equal(document.querySelector('[aria-label="按标签筛选便签"]').value, "tag:生活");
});

test("checklist add/edit/Enter/check/remove keeps literal body, editor state and metadata separate", async () => {
  const content = "- [ ] 旧版字面文字\n" + marker;
  await mount(content, "markdown"); const editor = view();
  await click(document.querySelector('[aria-label="添加待办清单事项"]'));
  let first = document.querySelector('[aria-label="待办事项 1"]');
  assert.ok(document.activeElement === first);
  await type(first, "买菜");
  await act(() => first.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  const second = document.querySelector('[aria-label="待办事项 2"]'); assert.ok(document.activeElement === second);
  await type(second, "买票");
  await act(() => second.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true })));
  assert.equal(JSON.parse(saved).notes[0].todos.length, 2);
  await click(document.querySelector('[aria-label="完成待办：买菜"]'));
  assert.equal(JSON.parse(saved).notes[0].todos[0].done, true); assert.ok(document.querySelector(".todo-row.done"));
  assert.equal(JSON.parse(saved).notes[0].content, content); assert.equal(JSON.parse(saved).notes[0].format, "markdown");
  assert.ok(view() === editor); assert.equal(view().state.doc.toString(), content);
  await click(document.querySelector('[aria-label="删除待办：买菜"]')); await click(document.querySelector('[aria-label="删除待办：买票"]'));
  assert.deepEqual(JSON.parse(saved).notes[0].todos, []); assert.ok(!document.querySelector(".checklist"));
  assert.ok(view() === editor); assert.equal(view().state.doc.toString(), content);
});

test("checklist and tags survive restart, bin restore and show completion on home cards", async () => {
  const source = taggedState(); source.notes[0].todos[0].done = true;
  await mount("", "text", false, JSON.stringify(source)); const original = JSON.parse(saved).notes[0];
  await restart(); assert.match(card("测试便签").querySelector(".todo-progress").textContent, /1 \/ 1/);
  await click(card("测试便签")); assert.equal(document.querySelector('[aria-label="取消完成待办：预订机票"]').checked, true);
  await click(document.querySelector('[aria-label="删除便签"]')); await click(button("确认删除"));
  await openSettings(); await click(document.querySelector('[aria-label="打开回收站"]')); await click(document.querySelector('[aria-label="恢复便签：测试便签"]'));
  assert.deepEqual(JSON.parse(saved).notes[0], original);
  await restart(); await click(card("测试便签"));
  assert.equal(document.querySelector('[aria-label="待办事项 1"]').value, "预订机票"); assert.equal(document.querySelector('.todo-check input').checked, true);
});

test("failed checklist writes keep drafts visible and retry saves all task changes", async () => {
  await mount("原正文", "markdown", true); const original = saved;
  await click(document.querySelector('[aria-label="添加待办清单事项"]')); await type(document.querySelector('[aria-label="待办事项 1"]'), "保留的待办");
  await click(document.querySelector('[aria-label="完成待办：保留的待办"]'));
  assert.equal(saved, original); assert.match(document.querySelector('.error-banner').textContent, /尚未保存/);
  assert.equal(document.querySelector('[aria-label="待办事项 1"]').value, "保留的待办");
  window.BetterNotepad.save = raw => { saved = raw; return '{"ok":true}'; };
  await click(button("重试保存")); assert.equal(JSON.parse(saved).notes[0].todos[0].done, true);
  assert.equal(JSON.parse(saved).notes[0].content, "原正文"); assert.ok(!document.querySelector('.error-banner'));
});

async function prepareViewer(index = 0) {
  await click(document.querySelectorAll('.view-image')[index]);
  return loadViewerImage();
}
async function loadViewerImage() {
  const viewport = document.querySelector('.image-viewport'), image = viewport.querySelector('img');
  Object.defineProperties(viewport, { clientWidth: { value: 300, configurable: true }, clientHeight: { value: 400, configurable: true } });
  Object.defineProperties(image, { clientWidth: { value: 300, configurable: true }, clientHeight: { value: 400, configurable: true } });
  viewport.getBoundingClientRect = () => new window.DOMRect(0, 0, 300, 400); viewport.setPointerCapture = () => {};
  await act(() => image.dispatchEvent(new window.Event('load')));
  return { viewport, image };
}
async function pointer(element, type, id, x, y) {
  await act(() => {
    const event = new window.MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
    Object.defineProperties(event, { pointerId: { value: id }, pointerType: { value: 'touch' } });
    element.dispatchEvent(event);
  });
}

test("body images open a local-only modal, close/back/cancel preserve text and selection", async () => {
  await mount("前文\n" + marker + "\n后文"); const baseline = saved, editor = view();
  const originalSelection = editor.state.selection.main.from;
  await prepareViewer(); assert.equal(document.querySelector('.image-viewer img').getAttribute('src'), path);
  await act(() => { assert.equal(window.betterNotepadBack(), true); });
  assert.ok(!document.querySelector('.image-viewer')); assert.ok(document.querySelector('.note-page')); assert.ok(view() === editor);
  assert.equal(saved, baseline); assert.equal(editor.state.selection.main.from, originalSelection);
  await prepareViewer(); await click(document.querySelector('[aria-label="关闭大图"]'));
  await prepareViewer(); await act(() => document.querySelector('.image-viewer').dispatchEvent(new window.Event('cancel', { cancelable: true })));
  assert.ok(!document.querySelector('.image-viewer')); assert.equal(saved, baseline);
  const invalid = document.createElement('button'); invalid.className = 'view-image'; invalid.dataset.imagePath = 'https://example.test/remote.jpg'; document.querySelector('.editor-host').append(invalid);
  await click(invalid); assert.ok(!document.querySelector('.image-viewer'));
});

test("large image zoom buttons, pinch, bounded pan, double tap, cancellation and resize work without writes", async () => {
  await mount(marker); const baseline = saved; const { viewport, image } = await prepareViewer();
  const plus = document.querySelector('[aria-label="放大图片"]'), minus = document.querySelector('[aria-label="缩小图片"]');
  assert.equal(minus.disabled, true);
  for (let i = 0; i < 7; i++) await click(plus);
  assert.match(image.style.transform, /scale\(4\)/); assert.equal(plus.disabled, true);
  await pointer(viewport, 'pointerdown', 1, 150, 200); await pointer(viewport, 'pointermove', 1, 3000, 3000); await pointer(viewport, 'pointerup', 1, 3000, 3000);
  assert.match(image.style.transform, /translate\(450px, 600px\)/);
  await click(button('适应屏幕')); assert.match(image.style.transform, /translate\(0px, 0px\) scale\(1\)/);
  await pointer(viewport, 'pointerdown', 1, 100, 200); await pointer(viewport, 'pointerdown', 2, 200, 200);
  await pointer(viewport, 'pointermove', 2, 300, 200); assert.match(image.style.transform, /scale\(2\)/);
  await pointer(viewport, 'pointerup', 2, 300, 200); await pointer(viewport, 'pointermove', 1, 130, 200); await pointer(viewport, 'pointerup', 1, 130, 200);
  assert.match(image.style.transform, /translate\(80px, 0px\)/);
  await click(button('适应屏幕'));
  for (let i = 0; i < 2; i++) { await pointer(viewport, 'pointerdown', 1, 150, 200); await pointer(viewport, 'pointerup', 1, 150, 200); }
  assert.match(image.style.transform, /scale\(2\)/);
  await pointer(viewport, 'pointerdown', 1, 100, 200); await pointer(viewport, 'pointercancel', 1, 100, 200);
  const before = image.style.transform; await pointer(viewport, 'pointermove', 1, 300, 200); assert.equal(image.style.transform, before);
  await act(() => window.dispatchEvent(new window.Event('resize'))); assert.match(image.style.transform, /scale\(1\)/);
  assert.equal(saved, baseline);
});

test("failed large image loading disables zoom but keeps a working close control", async () => {
  await mount(marker); const baseline = saved;
  await click(document.querySelector('.view-image'));
  await act(() => document.querySelector('.image-viewer img').dispatchEvent(new window.Event('error')));
  assert.match(document.querySelector('.image-viewer [role="alert"]').textContent, /无法读取/);
  assert.equal(document.querySelector('[aria-label="放大图片"]').disabled, true);
  await click(document.querySelector('[aria-label="关闭大图"]')); assert.equal(saved, baseline);
});

const galleryPaths = [path, "/images/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png", "/images/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.jpg"];
const galleryContent = galleryPaths.map(value => `![图片](${value})`).join("\n正文\n");
const galleryImage = () => document.querySelector(".image-viewer img");
const galleryCounter = () => document.querySelector('[aria-label="图片序号"]').textContent;
async function swipeGallery(fromX, toX, fromY = 200, toY = fromY, endType = "pointerup") {
  const viewport = document.querySelector(".image-viewport");
  await pointer(viewport, "pointerdown", 1, fromX, fromY);
  await pointer(viewport, "pointermove", 1, toX, toY);
  await pointer(viewport, endType, 1, toX, toY);
}

test("image gallery opens the clicked occurrence and swipes in the current note's body order without saving", async () => {
  await mount(galleryContent + "\n![外部](https://example.test/a.jpg)");
  const baseline = saved, editor = view(), selection = editor.state.selection.main.from;
  await prepareViewer(1);
  assert.equal(galleryImage().getAttribute("src"), galleryPaths[1]);
  assert.equal(galleryCounter(), "图片 2 / 3");
  await swipeGallery(240, 80);
  assert.equal(galleryImage().getAttribute("src"), galleryPaths[2]);
  assert.equal(galleryCounter(), "图片 3 / 3");
  await loadViewerImage(); await swipeGallery(80, 240);
  assert.equal(galleryImage().getAttribute("src"), galleryPaths[1]);
  assert.equal(galleryCounter(), "图片 2 / 3");
  await act(() => { assert.equal(window.betterNotepadBack(), true); });
  assert.equal(saved, baseline);
  assert.equal(editor.state.selection.main.from, selection);
  assert.equal(view(), editor);
});

test("image gallery clamps both ends, disables boundary controls, and keeps single-image viewers simple", async () => {
  await mount(galleryContent); await prepareViewer();
  assert.equal(document.querySelector('[aria-label="上一张图片"]').disabled, true);
  await swipeGallery(80, 240); assert.equal(galleryCounter(), "图片 1 / 3");
  await click(document.querySelector('[aria-label="下一张图片"]'));
  await click(document.querySelector('[aria-label="下一张图片"]'));
  assert.equal(galleryCounter(), "图片 3 / 3");
  assert.equal(document.querySelector('[aria-label="下一张图片"]').disabled, true);
  await loadViewerImage(); await swipeGallery(240, 80); assert.equal(galleryCounter(), "图片 3 / 3");
  await click(document.querySelector('[aria-label="关闭大图"]'));
  await prepareViewer(1); assert.equal(galleryCounter(), "图片 2 / 3");
  await click(document.querySelector('[aria-label="上一张图片"]')); assert.equal(galleryCounter(), "图片 1 / 3");
  await act(() => root.unmount()); root = null;
  await mount(marker); await prepareViewer();
  assert.equal(galleryCounter(), "图片 1 / 1");
  assert.equal(document.querySelector('[aria-label="下一张图片"]'), null);
  assert.equal(document.querySelector('[aria-label="上一张图片"]'), null);
  await swipeGallery(240, 80); assert.equal(galleryImage().getAttribute("src"), path);
});

test("short, vertical and diagonal drags do not accidentally change gallery images", async () => {
  await mount(galleryContent); await prepareViewer(1);
  for (const [x, y] of [[220, 200], [220, 80], [160, 120]]) {
    await swipeGallery(240, x, 200, y);
    assert.equal(galleryCounter(), "图片 2 / 3");
    assert.match(galleryImage().style.transform, /scale\(1\)/);
  }
});

test("zoomed dragging stays on the current image and navigation resets zoom and pan", async () => {
  await mount(galleryContent); await prepareViewer(1);
  await click(document.querySelector('[aria-label="放大图片"]'));
  await swipeGallery(240, 80);
  assert.equal(galleryCounter(), "图片 2 / 3");
  assert.match(galleryImage().style.transform, /scale\(1\.5\)/);
  await click(document.querySelector('[aria-label="下一张图片"]'));
  assert.match(galleryImage().style.transform, /translate\(0px, 0px\) scale\(1\)/);
  assert.equal(document.querySelector('[aria-label="放大图片"]').disabled, true);
  await loadViewerImage(); await swipeGallery(80, 240);
  assert.equal(galleryCounter(), "图片 2 / 3");
  const { viewport } = await loadViewerImage();
  await pointer(viewport, "pointerdown", 1, 80, 200);
  await pointer(viewport, "pointermove", 1, 240, 200);
  await click(button("适应屏幕"));
  await pointer(viewport, "pointerup", 1, 240, 200);
  assert.equal(galleryCounter(), "图片 2 / 3");
});

test("pinching and the remaining finger after a pinch never become a gallery swipe", async () => {
  await mount(galleryContent); const { viewport } = await prepareViewer(1);
  await pointer(viewport, "pointerdown", 1, 100, 200);
  await pointer(viewport, "pointerdown", 2, 200, 200);
  await pointer(viewport, "pointermove", 2, 300, 200);
  assert.match(galleryImage().style.transform, /scale\(2\)/);
  await pointer(viewport, "pointermove", 2, 150, 200);
  assert.match(galleryImage().style.transform, /scale\(1\)/);
  await pointer(viewport, "pointerup", 2, 150, 200);
  await pointer(viewport, "pointermove", 1, 240, 200);
  await pointer(viewport, "pointerup", 1, 240, 200);
  assert.equal(galleryCounter(), "图片 2 / 3");
});

test("cancelled, lost-capture and resized gestures cannot change gallery images", async () => {
  await mount(galleryContent); const { viewport } = await prepareViewer(1);
  for (const end of ["pointercancel", "lostpointercapture"]) {
    await swipeGallery(240, 80, 200, 200, end);
    await pointer(viewport, "pointerup", 1, 80, 200);
    assert.equal(galleryCounter(), "图片 2 / 3");
  }
  await pointer(viewport, "pointerdown", 1, 240, 200);
  await pointer(viewport, "pointermove", 1, 80, 200);
  await act(() => window.dispatchEvent(new window.Event("resize")));
  await pointer(viewport, "pointerup", 1, 80, 200);
  assert.equal(galleryCounter(), "图片 2 / 3");
  await swipeGallery(240, 80); assert.equal(galleryCounter(), "图片 3 / 3");
});

test("missing or loading gallery images can be skipped and old image callbacks cannot affect their replacement", async () => {
  await mount(galleryContent); await click(document.querySelector(".view-image"));
  const viewport = document.querySelector(".image-viewport"); viewport.setPointerCapture = () => {};
  const old = galleryImage();
  await act(() => old.dispatchEvent(new window.Event("error")));
  assert.match(document.querySelector(".image-viewer [role=alert]").textContent, /无法读取/);
  await swipeGallery(240, 80);
  assert.equal(galleryCounter(), "图片 2 / 3");
  assert.equal(document.querySelector(".image-viewer [role=alert]"), null);
  assert.match(document.querySelector(".image-viewer [role=status]").textContent + document.querySelector(".image-viewport").textContent, /正在读取/);
  await act(() => old.dispatchEvent(new window.Event("load")));
  assert.equal(document.querySelector('[aria-label="放大图片"]').disabled, true);
  await swipeGallery(240, 80); assert.equal(galleryCounter(), "图片 3 / 3");
  await loadViewerImage(); assert.equal(document.querySelector('[aria-label="放大图片"]').disabled, false);
});

test("duplicate image paths retain their individual positions instead of opening the first duplicate", async () => {
  await mount(`${marker}\n${marker}\n![图片](${galleryPaths[2]})`);
  await prepareViewer(1); assert.equal(galleryCounter(), "图片 2 / 3");
  await swipeGallery(240, 80);
  assert.equal(galleryImage().getAttribute("src"), galleryPaths[2]);
  await loadViewerImage(); await swipeGallery(80, 240); await loadViewerImage(); await swipeGallery(80, 240);
  assert.equal(galleryCounter(), "图片 1 / 3");
  assert.equal(galleryImage().getAttribute("src"), path);
});

test("gallery reads the live editor draft and viewing never discards or saves a failed notebook write", async () => {
  await mount(marker, "text", true); const baseline = saved, editor = view();
  const insert = `\n![图片](${galleryPaths[1]})\n![图片](${galleryPaths[2]})`;
  await act(() => editor.dispatch({ changes: { from: editor.state.doc.length, insert }, userEvent: "input.type" }));
  const draft = editor.state.doc.toString();
  await prepareViewer(1); assert.equal(galleryCounter(), "图片 2 / 3");
  await swipeGallery(240, 80); assert.equal(galleryImage().getAttribute("src"), galleryPaths[2]);
  await click(document.querySelector('[aria-label="关闭大图"]'));
  assert.equal(view().state.doc.toString(), draft);
  assert.equal(saved, baseline);
  assert.match(document.querySelector(".save-status").textContent, /尚未保存/);
});

async function openSettings() {
  if (document.querySelector(".note-page")) await click(document.querySelector('[aria-label="返回便签主页"]'));
  await click(document.querySelector('[aria-label="打开设置"]'));
}
const openDialog = () => document.querySelector("dialog[open]");
function backupBridge(incoming = { ...emptyState(), notes: [{ ...createNote("one", 10), title: "来自备份", content: marker }], trash: [{ ...createNote("bin", 11), title: "备份回收站", deletedAt: 12 }] }) {
  let id, submitted;
  const discarded = [];
  Object.assign(window.BetterNotepad, {
    exportBackup: request => { id = request; }, openBackup: request => { id = request; },
    readBackup: () => JSON.stringify({ ok: true, data: JSON.stringify(incoming) }),
    restoreBackup: (request, raw) => { assert.equal(request, id); submitted = raw; },
    discardBackup: request => discarded.push(request),
  });
  return {
    get id() { return id; }, get submitted() { return submitted; }, discarded,
    async result(fields) { await act(() => window.betterNotepadBackupResult({ requestId: id, ...fields })); },
    async preview() { await click(button("从备份恢复")); await this.result({ phase: "preview", notes: incoming.notes.length, trash: incoming.trash?.length ?? 0, images: 1, createdAt: 1000 }); },
    async complete() { saved = submitted; await this.result({ phase: "restored" }); },
  };
}

test("recycle bin is settings-only, retains deleted images through restart and restores original metadata", async () => {
  const original = bulkState();
  await mount("", "text", false, JSON.stringify(original));
  await click(document.querySelector('[aria-label="删除便签"]')); await click(button("确认删除"));
  assert.ok(!document.querySelector('[aria-label="打开回收站"]'));
  assert.deepEqual(JSON.parse(saved).trash.map(({ deletedAt, ...note }) => note), [original.notes[0]]);
  const persisted = saved;
  await act(() => root.unmount()); root = createRoot(document.getElementById("root"));
  await act(() => root.render(React.createElement(App)));
  await openSettings(); await click(document.querySelector('[aria-label="打开回收站"]'));
  assert.equal(document.querySelectorAll(".trash-card").length, 1);
  assert.equal(document.querySelector(".trash-card img").getAttribute("src"), path);
  assert.equal(saved, persisted);
  await click(document.querySelector('[aria-label="恢复便签：测试便签"]'));
  assert.deepEqual(JSON.parse(saved).notes[0], original.notes[0]);
  assert.deepEqual(JSON.parse(saved).trash, []);
  await act(() => { assert.equal(window.betterNotepadBack(), true); });
  assert.equal(document.querySelector(".page-bar h1").textContent, "设置");
  await act(() => { assert.equal(window.betterNotepadBack(), true); });
  await click(card("测试便签"));
  assert.equal(view().state.doc.toString(), original.notes[0].content);
  assert.equal(document.querySelector(".inline-image img").getAttribute("src"), path);
});

test("permanent deletion and empty-bin require confirmation and preserve active notes", async () => {
  const state = { ...bulkState(), trash: [{ ...createNote("bin1", 1), title: "已删一", deletedAt: 3 }, { ...createNote("bin2", 2), title: "已删二", deletedAt: 4 }] };
  await mount("", "text", false, JSON.stringify(state)); await openSettings();
  await type(document.querySelector('[aria-label="主页标题"]'), "未保存文案");
  await click(document.querySelector('[aria-label="打开回收站"]'));
  const baseline = saved;
  await click(document.querySelector('[aria-label="彻底删除便签：已删一"]'));
  assert.match(openDialog().textContent, /无法撤销/);
  await act(() => { assert.equal(window.betterNotepadBack(), true); });
  assert.ok(!openDialog()); assert.equal(saved, baseline);
  await click(document.querySelector('[aria-label="彻底删除便签：已删一"]')); await click(button("确认彻底删除"));
  assert.deepEqual(JSON.parse(saved).trash, [state.trash[1]]);
  await click(button("清空回收站"));
  await act(() => openDialog().dispatchEvent(new window.Event("cancel", { cancelable: true })));
  assert.equal(JSON.parse(saved).trash.length, 1);
  await click(button("清空回收站")); await click(button("确认彻底删除"));
  assert.deepEqual(JSON.parse(saved).trash, []);
  assert.deepEqual(JSON.parse(saved).notes, state.notes);
  await click(document.querySelector('[aria-label="返回设置"]'));
  assert.equal(document.querySelector('[aria-label="主页标题"]').value, "未保存文案");
});

test("failed bin restore and erasure never hide data and both support retry", async () => {
  const state = { ...bulkState(), trash: [{ ...createNote("bin", 1), title: "保留我", content: marker, deletedAt: 2 }] };
  await mount("", "text", true, JSON.stringify(state)); await openSettings(); await click(document.querySelector('[aria-label="打开回收站"]'));
  const baseline = saved;
  await click(document.querySelector('[aria-label="恢复便签：保留我"]'));
  assert.equal(saved, baseline); assert.equal(document.querySelectorAll(".trash-card").length, 1);
  await click(button("清空回收站")); await click(button("确认彻底删除"));
  assert.equal(saved, baseline); assert.ok(openDialog()); assert.match(openDialog().textContent, /仍然保留/);
  window.BetterNotepad.save = raw => { saved = raw; return '{"ok":true}'; };
  await click(button("确认彻底删除")); assert.deepEqual(JSON.parse(saved).trash, []);
});

test("backup export waits for a matching native completion and cancels without writes", async () => {
  await mount(); await openSettings();
  const baseline = saved, bridge = backupBridge();
  await click(button("导出备份"));
  assert.match(bridge.id, /^[a-f0-9]{32}$/);
  assert.ok(document.querySelector("fieldset").disabled);
  await act(() => { assert.equal(window.betterNotepadBack(), true); });
  await act(() => window.betterNotepadBackupResult({ requestId: "unknown", phase: "exported" }));
  assert.ok(document.querySelector("fieldset").disabled);
  await bridge.result({ cancelled: true });
  assert.equal(saved, baseline); assert.equal(document.querySelector("fieldset").disabled, false);
  await click(button("导出备份")); await bridge.result({ error: "测试写入失败" });
  assert.match(document.querySelector('.settings-page [role="alert"]').textContent, /测试写入失败/);
  assert.equal(saved, baseline);
  await click(button("导出备份")); await bridge.result({ phase: "exported" });
  assert.match(document.querySelector(".data-message").textContent, /已导出/); assert.equal(saved, baseline);
});

test("backup preview is non-destructive, hardware/dialog back cancels and invalid files are rejected", async () => {
  await mount(); await openSettings();
  const baseline = saved, bridge = backupBridge();
  await bridge.preview();
  assert.match(openDialog().textContent, /1 篇便签.*1 篇回收站便签.*1 张图片/);
  assert.equal(saved, baseline);
  await act(() => { assert.equal(window.betterNotepadBack(), true); });
  assert.ok(!openDialog()); assert.equal(bridge.discarded.at(-1), bridge.id);
  await bridge.preview();
  await act(() => openDialog().dispatchEvent(new window.Event("cancel", { cancelable: true })));
  assert.ok(!openDialog()); assert.equal(saved, baseline);
  window.BetterNotepad.readBackup = () => '{"ok":true,"data":"{broken"}';
  await bridge.preview();
  assert.ok(!openDialog()); assert.ok(document.querySelector('.settings-page [role="alert"]'));
  assert.equal(saved, baseline);
});

test("merge restore preserves existing settings, resolves note IDs and retries a failed native commit", async () => {
  await mount("", "text", false, JSON.stringify(bulkState())); await openSettings();
  const baseline = saved, original = JSON.parse(saved), bridge = backupBridge();
  await bridge.preview(); await click(button("合并恢复"));
  const submitted = JSON.parse(bridge.submitted);
  assert.equal(submitted.notes.length, 4); assert.equal(submitted.trash.length, 1);
  assert.notEqual(submitted.notes[0].id, "one");
  assert.deepEqual(submitted.notes.slice(1), original.notes);
  assert.deepEqual(submitted.home, original.home); assert.equal(submitted.theme, "dark");
  assert.equal(saved, baseline);
  await act(() => { assert.equal(window.betterNotepadBack(), true); });
  assert.ok(openDialog());
  await bridge.result({ error: "恢复未完成，原内容未改动。" });
  assert.equal(saved, baseline); assert.match(openDialog().textContent, /未改动/);
  await click(button("合并恢复")); await bridge.complete();
  assert.ok(!openDialog()); assert.equal(JSON.parse(saved).notes.length, 4);
  assert.match(document.querySelector(".data-message").textContent, /恢复完成/);
  await click(document.querySelector('[aria-label="返回便签主页"]'));
  assert.equal(document.querySelectorAll(".note-card").length, 4);
});

test("replace restore has a separate destructive confirmation and uses backup settings and bin", async () => {
  await mount(); await openSettings();
  const incoming = { ...emptyState(), theme: "light", home: { title: "恢复的标题", subtitle: "" }, notes: [createNote("fresh", 100)], trash: [{ ...createNote("gone", 101), deletedAt: 102 }] };
  const bridge = backupBridge(incoming), baseline = saved;
  await bridge.preview(); await click(button("改为替换本机内容"));
  assert.match(openDialog().textContent, /替换当前全部便签.*无法撤销/);
  assert.equal(bridge.submitted, undefined); assert.equal(saved, baseline);
  await click(button("确认替换")); assert.deepEqual(JSON.parse(bridge.submitted), incoming);
  await bridge.complete();
  assert.equal(document.documentElement.dataset.theme, "light");
  assert.equal(document.querySelector('[aria-label="主页标题"]').value, incoming.home.title);
  await click(document.querySelector('[aria-label="打开回收站"]')); assert.equal(document.querySelectorAll(".trash-card").length, 1);
  assert.deepEqual(JSON.parse(saved), incoming);
});

test("backup refuses unsupported browser/native versions and unsaved drafts without opening files", async () => {
  await mount(); await openSettings();
  await click(button("导出备份")); assert.match(document.querySelector('.settings-page [role="alert"]').textContent, /Android 应用/);
  await act(() => root.unmount()); root = null;
  await mount("", "text", true); await type(document.querySelector('[aria-label="便签标题"]'), "未保存修改");
  await openSettings();
  assert.equal(button("导出备份").disabled, true); assert.equal(button("从备份恢复").disabled, true);
});

test("a completed restore with a failed reload blocks stale edits and offers a fresh read", async () => {
  await mount(); await openSettings();
  const bridge = backupBridge(); await bridge.preview(); await click(button("合并恢复"));
  saved = bridge.submitted;
  window.BetterNotepad.load = () => '{"ok":false,"error":"测试重新读取失败"}';
  await bridge.result({ phase: "restored" });
  assert.ok(openDialog()); assert.ok(button("合并恢复").disabled);
  assert.ok(button("取消恢复").disabled);
  assert.ok(button("重新读取恢复内容"));
  await act(() => { assert.equal(window.betterNotepadBack(), true); });
  assert.equal(saved, bridge.submitted);
});

test("bulk selection toggles cards without opening editors or saving, and supports select-all and exit", async () => {
  await startBulk();
  const baseline = saved;
  assert.equal(bulkDelete().disabled, true);
  assert.ok(!document.querySelector('[aria-label="新建便签"]'));
  await click(card("测试便签"));
  assert.equal(card("测试便签").getAttribute("aria-pressed"), "true");
  assert.equal(card("测试便签").classList.contains("is-selected"), true);
  assert.equal(card("测试便签").querySelector(".selection-mark").classList.contains("checked"), true);
  assert.ok(!document.querySelector(".note-page"));
  assert.match(document.querySelector(".selection-count").textContent, /1/);
  await click(card("测试便签"));
  assert.equal(card("测试便签").getAttribute("aria-pressed"), "false");
  assert.equal(bulkDelete().disabled, true);
  await click(selectAll());
  assert.equal(document.querySelectorAll(".note-card.is-selected").length, 3);
  assert.equal(selectAll().getAttribute("aria-pressed"), "true");
  await click(selectAll());
  assert.equal(document.querySelectorAll(".note-card.is-selected").length, 0);
  await click(document.querySelector('[aria-label="退出批量选择"]'));
  assert.ok(bulkButton());
  assert.ok(document.querySelector('[aria-label="新建便签"]'));
  assert.ok(!document.querySelector(".selection-toolbar"));
  assert.equal(card("测试便签").hasAttribute("aria-pressed"), false);
  assert.equal(saved, baseline);
});

test("bulk confirmation shows the count and cancels safely through keep, dialog cancel and Android back", async () => {
  await startBulk();
  const baseline = saved;
  await click(card("原有便签")); await click(card("杂记"));
  await click(bulkDelete());
  let confirm = document.querySelector("dialog");
  assert.equal(confirm.open, true);
  assert.match(confirm.querySelector("h2").textContent, /2 篇/);
  assert.match(confirm.querySelector("#delete-description").textContent, /2 篇便签.*回收站.*设置中恢复/);
  await click(button("保留便签"));
  assert.equal(confirm.open, false);
  assert.equal(document.querySelectorAll(".note-card.is-selected").length, 2);
  await click(bulkDelete());
  await act(() => confirm.dispatchEvent(new window.Event("cancel", { cancelable: true })));
  assert.equal(confirm.open, false);
  await click(bulkDelete());
  await act(() => { assert.equal(window.betterNotepadBack(), true); });
  assert.equal(confirm.open, false);
  assert.ok(document.querySelector(".selection-toolbar"));
  await act(() => { assert.equal(window.betterNotepadBack(), true); });
  assert.ok(!document.querySelector(".selection-toolbar"));
  assert.equal(saved, baseline);
});

test("bulk delete writes once, preserves unselected notes and settings, updates counts and survives restart", async () => {
  const original = bulkState();
  await startBulk(original);
  let writes = 0;
  window.BetterNotepad.save = raw => { writes++; saved = raw; return '{"ok":true}'; };
  await click(card("原有便签")); await click(card("杂记"));
  await click(bulkDelete()); await click(button("确认删除"));
  const state = JSON.parse(saved);
  assert.equal(writes, 1);
  assert.deepEqual(state.notes, [original.notes[0]]);
  assert.deepEqual(state.trash.map(({ deletedAt, ...note }) => note), original.notes.slice(1));
  assert.ok(state.trash.every(note => Number.isFinite(note.deletedAt)));
  assert.deepEqual(state.home, original.home);
  assert.equal(state.theme, original.theme);
  assert.equal(state.version, 1);
  assert.equal(document.querySelectorAll(".note-card").length, 1);
  assert.equal(document.querySelector(".card-image").getAttribute("src"), path);
  assert.deepEqual(Array.from(document.querySelectorAll(".filters span"), item => item.textContent), ["1", "0"]);
  assert.equal(document.querySelector("dialog").open, false);
  assert.ok(!document.querySelector(".selection-toolbar"));
  const persisted = saved;
  await act(() => root.unmount()); root = null;
  await mount("", "text", false, persisted);
  await click(document.querySelector('[aria-label="返回便签主页"]'));
  assert.equal(document.querySelectorAll(".note-card").length, 1);
  assert.ok(bulkButton());
  assert.equal(saved, persisted);
});

test("bulk select-all can delete the entire notebook and restore an empty usable home", async () => {
  await startBulk();
  await click(selectAll()); await click(bulkDelete());
  assert.match(document.querySelector("dialog h2").textContent, /3 篇/);
  await click(button("确认删除"));
  assert.deepEqual(JSON.parse(saved).notes, []);
  assert.equal(JSON.parse(saved).trash.length, 3);
  assert.ok(document.querySelector(".empty-state"));
  assert.ok(document.querySelector('[aria-label="新建便签"]'));
  assert.ok(!bulkButton());
  await act(() => root.unmount());
  root = createRoot(document.getElementById("root"));
  await act(() => root.render(React.createElement(App)));
  assert.equal(document.querySelectorAll(".note-card").length, 0);
  assert.ok(document.querySelector(".empty-state"));
});

test("pinned filtering clears hidden selections and select-all deletes only the current pinned list", async () => {
  const original = bulkState();
  await startBulk(original); await click(card("测试便签"));
  await click(document.querySelector('.filters button[aria-label="只看已置顶便签"]'));
  assert.equal(document.querySelectorAll(".note-card").length, 1);
  assert.equal(bulkDelete().disabled, true);
  await click(selectAll()); await click(bulkDelete());
  assert.match(document.querySelector("#delete-description").textContent, /原有便签/);
  await click(button("确认删除"));
  assert.deepEqual(JSON.parse(saved).notes, [original.notes[0], original.notes[2]]);
  assert.equal(document.querySelectorAll(".note-card").length, 0);
  assert.match(document.querySelector(".empty-state").textContent, /放在前面/);
});

test("search changes clear selections and bulk deletion preserves the query and all unmatched notes", async () => {
  const original = bulkState();
  await startBulk(original);
  await click(card("杂记"));
  await click(document.querySelector('button[aria-label="搜索便签"]'));
  assert.ok(!document.querySelector(".selection-toolbar"));
  const input = document.querySelector('input[aria-label="搜索便签"]');
  await type(input, "便签");
  await click(bulkButton()); await click(selectAll());
  assert.equal(document.querySelectorAll(".note-card.is-selected").length, 2);
  await type(input, "不能丢失");
  assert.equal(bulkDelete().disabled, true);
  assert.equal(document.querySelectorAll(".note-card").length, 1);
  await click(selectAll()); await click(bulkDelete()); await click(button("确认删除"));
  assert.equal(input.value, "不能丢失");
  assert.deepEqual(JSON.parse(saved).notes, [original.notes[0], original.notes[2]]);
  assert.ok(!document.querySelector(".selection-toolbar"));
  assert.equal(document.querySelectorAll(".note-card").length, 0);
  await click(document.querySelector('[aria-label="清空搜索"]'));
  assert.equal(document.querySelectorAll(".note-card").length, 2);
});

test("failed bulk deletion preserves all stored and visible notes, keeps selection and supports retry", async () => {
  await startBulk(bulkState(), true);
  const baseline = saved;
  await click(selectAll()); await click(bulkDelete()); await click(button("确认删除"));
  assert.equal(saved, baseline);
  assert.equal(document.querySelectorAll(".note-card").length, 3);
  assert.equal(document.querySelectorAll(".note-card.is-selected").length, 3);
  assert.equal(document.querySelector("dialog").open, true);
  assert.match(document.querySelector("dialog [role='alert']").textContent, /便签仍然保留/);
  window.BetterNotepad.save = raw => { saved = raw; return '{"ok":true}'; };
  await click(button("确认删除"));
  assert.deepEqual(JSON.parse(saved).notes, []);
  assert.equal(document.querySelector("dialog").open, false);
  assert.ok(!document.querySelector('[role="alert"]'));
});

test("single-note deletion still confirms its title, cancels and deletes only the active note", async () => {
  await mount();
  const baseline = saved;
  await click(document.querySelector('[aria-label="删除便签"]'));
  assert.equal(document.querySelector("dialog h2").textContent, "删除这篇便签？");
  assert.match(document.querySelector("#delete-description").textContent, /测试便签/);
  await click(button("保留便签"));
  assert.equal(saved, baseline);
  assert.ok(document.querySelector(".note-page"));
  await click(document.querySelector('[aria-label="删除便签"]')); await click(button("确认删除"));
  assert.deepEqual(JSON.parse(saved).notes, [JSON.parse(baseline).notes[1]]);
  assert.ok(!document.querySelector(".note-page"));
  assert.equal(document.querySelectorAll(".note-card").length, 1);
});

test("pin and unpin update the button, stored note and homepage even while focus stays on the button", async () => {
  await mount();
  const original = JSON.parse(saved);
  const pin = document.querySelector('[aria-label="置顶便签"]');
  assert.equal(pin.classList.contains("pin-button"), true);
  assert.equal(pin.getAttribute("aria-pressed"), "false");
  await act(() => pin.focus());
  await click(pin);
  assert.equal(pin.getAttribute("aria-label"), "取消置顶");
  assert.equal(pin.getAttribute("aria-pressed"), "true");
  assert.equal(pin.classList.contains("is-pinned"), true);
  assert.equal(JSON.parse(saved).notes[0].pinned, true);
  await click(pin);
  assert.ok(document.activeElement === pin);
  assert.equal(pin.getAttribute("aria-label"), "置顶便签");
  assert.equal(pin.getAttribute("aria-pressed"), "false");
  assert.equal(pin.classList.contains("is-pinned"), false);
  const state = JSON.parse(saved);
  assert.equal(state.notes[0].pinned, false);
  assert.deepEqual({ ...state.notes[0], updatedAt: original.notes[0].updatedAt }, original.notes[0]);
  assert.deepEqual(state.notes[1], original.notes[1]);
  await click(document.querySelector('[aria-label="返回便签主页"]'));
  assert.ok(!document.querySelector(".note-card.pinned, .pin-badge"));
  const persisted = saved;
  await act(() => root.unmount()); root = null;
  await mount("", "text", false, persisted);
  assert.equal(document.querySelector('[aria-label="置顶便签"]').getAttribute("aria-pressed"), "false");
  assert.ok(!document.querySelector(".is-pinned"));
  assert.equal(saved, persisted);
});

test("unpinning a note opened from the pinned filter removes it from that list", async () => {
  const state = { ...emptyState(), notes: [
    { ...createNote("one", 1), title: "测试便签", content: "原正文", pinned: true },
    { ...createNote("old", 1), title: "原有便签", content: "不能丢失" },
  ] };
  await mount("", "text", false, JSON.stringify(state));
  await click(document.querySelector('[aria-label="返回便签主页"]'));
  await click(document.querySelector('.filters button[aria-label="只看已置顶便签"]'));
  assert.equal(document.querySelectorAll(".note-card").length, 1);
  await click(document.querySelector('[aria-label="打开便签：测试便签，已置顶"]'));
  await click(document.querySelector('[aria-label="取消置顶"]'));
  await click(document.querySelector('[aria-label="返回便签主页"]'));
  assert.equal(document.querySelectorAll(".note-card").length, 0);
  assert.equal(document.querySelector(".filters .selected span").textContent, "0");
  assert.equal(JSON.parse(saved).notes[0].pinned, false);
});

test("homepage search button opens an autofocus field for both title and body, and can clear results", async () => {
  await mount();
  const baseline = saved;
  await click(document.querySelector('[aria-label="返回便签主页"]'));
  assert.ok(!document.querySelector('input[aria-label="搜索便签"]'));
  await click(document.querySelector('button[aria-label="搜索便签"]'));
  const input = document.querySelector('input[aria-label="搜索便签"]');
  assert.ok(document.activeElement === input);
  assert.equal(document.querySelectorAll(".note-card").length, 2);
  await type(input, "原有");
  assert.equal(document.querySelectorAll(".note-card").length, 1);
  assert.equal(document.querySelector(".note-card h2").textContent, "原有便签");
  await type(input, "前文");
  assert.equal(document.querySelector(".note-card h2").textContent, "测试便签");
  await type(input, "不存在的内容");
  assert.equal(document.querySelectorAll(".note-card").length, 0);
  assert.match(document.querySelector(".empty-state").textContent, /没有找到/);
  await click(document.querySelector('[aria-label="清空搜索"]'));
  assert.equal(input.value, "");
  assert.ok(document.activeElement === input);
  assert.equal(document.querySelectorAll(".note-card").length, 2);
  assert.equal(saved, baseline);
});

test("search covers all notes and retains its query when returning from an editor", async () => {
  await mount();
  await click(document.querySelector('[aria-label="返回便签主页"]'));
  await click(document.querySelector('.filters button[aria-label="只看已置顶便签"]'));
  assert.equal(document.querySelectorAll(".note-card").length, 0);
  await click(document.querySelector('button[aria-label="搜索便签"]'));
  await type(document.querySelector('input[aria-label="搜索便签"]'), "不能丢失");
  assert.equal(document.querySelectorAll(".note-card").length, 1);
  await click(document.querySelector('[aria-label="打开便签：原有便签"]'));
  assert.ok(document.querySelector('[aria-label="返回搜索结果"]'));
  await act(() => { assert.equal(window.betterNotepadBack(), true); });
  assert.equal(document.querySelector('input[aria-label="搜索便签"]').value, "不能丢失");
  assert.equal(document.querySelectorAll(".note-card").length, 1);
  await act(() => { assert.equal(window.betterNotepadBack(), true); });
  assert.ok(document.querySelector(".home"));
  assert.ok(!document.querySelector('input[aria-label="搜索便签"]'));
  assert.equal(document.querySelectorAll(".note-card").length, 0);
  await act(() => { assert.equal(window.betterNotepadBack(), false); });
});

test("settings save custom homepage text, survive restart and leave note data unchanged", async () => {
  await mount();
  const original = JSON.parse(saved);
  await click(document.querySelector('[aria-label="返回便签主页"]'));
  await click(document.querySelector('[aria-label="打开设置"]'));
  assert.equal(document.querySelector('[aria-label="主页标题"]').value, DEFAULT_HOME.title);
  assert.equal(document.querySelector('[aria-label="主页标题"]').maxLength, 40);
  assert.equal(document.querySelector('[aria-label="主页副标题"]').maxLength, 80);
  await type(document.querySelector('[aria-label="主页标题"]'), "  今天的小本子  ");
  await type(document.querySelector('[aria-label="主页副标题"]'), "  留住每一个灵感 🙂  ");
  await click(button("保存设置"));
  assert.equal(document.querySelector(".home-heading h1").textContent, "今天的小本子");
  assert.equal(document.querySelector(".home-heading p").textContent, "留住每一个灵感 🙂");
  assert.deepEqual(JSON.parse(saved).notes, original.notes);
  assert.equal(JSON.parse(saved).theme, original.theme);
  const persisted = saved;
  await act(() => root.unmount()); root = null;
  await mount("", "text", false, persisted);
  await click(document.querySelector('[aria-label="返回便签主页"]'));
  assert.equal(document.querySelector(".home-heading h1").textContent, "今天的小本子");
  assert.equal(document.querySelector(".home-heading p").textContent, "留住每一个灵感 🙂");
  assert.equal(saved, persisted);
});

test("leaving settings discards unsaved text and blank saved fields have explicit defaults", async () => {
  await mount();
  const baseline = saved;
  await click(document.querySelector('[aria-label="返回便签主页"]'));
  await click(document.querySelector('[aria-label="打开设置"]'));
  await type(document.querySelector('[aria-label="主页标题"]'), "不保存的标题");
  await act(() => { assert.equal(window.betterNotepadBack(), true); });
  assert.equal(document.querySelector(".home-heading h1").textContent, DEFAULT_HOME.title);
  assert.equal(saved, baseline);
  await click(document.querySelector('[aria-label="打开设置"]'));
  await type(document.querySelector('[aria-label="主页副标题"]'), "不保存的副标题");
  await click(document.querySelector('[aria-label="返回便签主页"]'));
  assert.equal(saved, baseline);
  await click(document.querySelector('[aria-label="打开设置"]'));
  await type(document.querySelector('[aria-label="主页标题"]'), "  ");
  await type(document.querySelector('[aria-label="主页副标题"]'), "  ");
  await click(button("保存设置"));
  assert.equal(document.querySelector(".home-heading h1").textContent, DEFAULT_HOME.title);
  assert.ok(!document.querySelector(".home-heading p"));
  assert.deepEqual(JSON.parse(saved).home, { title: DEFAULT_HOME.title, subtitle: "" });
});

test("failed settings writes preserve stored notes and retry saves the requested homepage text", async () => {
  await mount("前文后文", "text", true);
  const baseline = saved;
  await click(document.querySelector('[aria-label="返回便签主页"]'));
  await click(document.querySelector('[aria-label="打开设置"]'));
  await type(document.querySelector('[aria-label="主页标题"]'), "等待保存的标题");
  await click(button("保存设置"));
  assert.equal(saved, baseline);
  assert.ok(document.querySelector(".settings-page"));
  assert.match(document.querySelector('[role="alert"]').textContent, /尚未保存/);
  window.BetterNotepad.save = raw => { saved = raw; return '{"ok":true}'; };
  await click(button("重试保存"));
  assert.ok(!document.querySelector('[role="alert"]'));
  assert.equal(JSON.parse(saved).home.title, "等待保存的标题");
  assert.deepEqual(JSON.parse(saved).notes, JSON.parse(baseline).notes);
  await click(document.querySelector('[aria-label="返回便签主页"]'));
  assert.equal(document.querySelector(".home-heading h1").textContent, "等待保存的标题");
});

test("text and legacy Markdown notes share a direct editor with no format or preview controls", async () => {
  const content = `# 原有标题\n**原有内容**\n${marker}\n后文`;
  for (const format of ["text", "markdown"]) {
    await mount(content, format);
    const baseline = saved;
    assert.ok(!document.querySelector("select"), "格式选择应已移除");
    assert.ok(!document.querySelector(".view-switch"), "编辑/预览切换应已移除");
    assert.ok(!button("编辑"));
    assert.ok(!button("预览"));
    assert.doesNotMatch(document.querySelector(".note-page").textContent, /Markdown|纯文本/);
    assert.equal(view().state.doc.toString(), content);
    assert.match(document.querySelector(".cm-content").textContent, /# 原有标题[\s\S]*\*\*原有内容\*\*/);
    assert.equal(document.querySelector(".inline-image img").getAttribute("src"), path);
    assert.equal(saved, baseline);
    await act(() => root.unmount()); root = null;
  }
});

test("image insertion is an accessible, icon-only plus and keeps the selected cursor position", async () => {
  await mount();
  const editor = view();
  await act(() => { editor.dispatch({ selection: { anchor: 2 } }); editor.focus(); });
  const plus = document.querySelector(".insert-image");
  assert.equal(plus.textContent, "");
  assert.equal(plus.getAttribute("aria-label"), "插入图片");
  assert.equal(plus.querySelector("svg path").getAttribute("d"), "M12 5v14 M5 12h14");
  await act(() => plus.focus());
  await click(plus);
  assert.equal(plus.disabled, true);
  assert.equal(plus.getAttribute("aria-busy"), "true");
  assert.equal(plus.textContent, "");
  await act(() => window.betterNotepadImageResult({ requestId, path }));
  assert.equal(JSON.parse(saved).notes[0].content, `前文\n${marker}\n后文`);
});

test("picker inserts a visible image between text and saves it without changing note format", async () => {
  await mount();
  await act(() => view().dispatch({ selection: { anchor: 2 } }));
  await selectImage();
  const state = JSON.parse(saved);
  assert.equal(state.notes[0].content, `前文\n${marker}\n后文`);
  assert.equal(state.notes[0].format, "text");
  assert.equal(state.notes[1].content, "不能丢失");
  assert.equal(document.querySelector(".inline-image img").getAttribute("src"), path);
  assert.doesNotMatch(document.querySelector(".cm-content").textContent, /!\[图片\]/);
  assert.equal(imageButton().getAttribute("aria-busy"), "false");
});

test("insert, remove, undo and redo preserve surrounding text", async () => {
  await mount();
  await act(() => view().dispatch({ selection: { anchor: 2 } }));
  await selectImage();
  await act(() => undo(view()));
  assert.equal(JSON.parse(saved).notes[0].content, "前文后文");
  await act(() => redo(view()));
  assert.equal(imageBlocks(JSON.parse(saved).notes[0].content).length, 1);
  await click(document.querySelector(".remove-image"));
  await click(document.querySelector('dialog[open] .danger'));
  assert.equal(JSON.parse(saved).notes[0].content, "前文\n后文");
  await act(() => undo(view()));
  assert.equal(document.querySelectorAll(".inline-image img").length, 1);
});

test("cancelled, failed and invalid picker results leave the note unchanged", async () => {
  for (const result of [{ cancelled: true }, { error: "读取失败" }, { path: "https://example.org/a.jpg" }]) {
    await mount();
    const baseline = saved;
    await selectImage(result);
    assert.equal(saved, baseline);
    assert.equal(document.querySelectorAll(".inline-image").length, 0);
    await act(() => root.unmount()); root = null;
  }
});

test("late picker results never insert into a different note", async () => {
  await mount();
  const baseline = saved;
  await click(imageButton());
  await click(document.querySelector('[aria-label="返回便签主页"]'));
  await click(document.querySelector('[aria-label="打开便签：原有便签"]'));
  await act(() => window.betterNotepadImageResult({ requestId, path }));
  assert.equal(saved, baseline);
  assert.match(document.querySelector('[role="alert"]').textContent, /便签已切换/);
});

test("saved text and images reload directly, preserving legacy metadata and one-step back navigation", async () => {
  await mount("前文后文", "markdown");
  await act(() => view().dispatch({ selection: { anchor: 2 } }));
  await selectImage();
  const persisted = saved;
  await act(() => root.unmount()); root = null;
  await mount("", "markdown", false, persisted);
  assert.equal(document.querySelectorAll(".inline-image img").length, 1);
  assert.equal(view().state.doc.toString(), `前文\n${marker}\n后文`);
  assert.equal(JSON.parse(saved).notes[0].format, "markdown");
  assert.equal(saved, persisted);
  await act(() => { assert.equal(window.betterNotepadBack(), true); });
  assert.ok(!document.querySelector(".note-page"));
  assert.equal(document.querySelector(".card-image").getAttribute("src"), path);
  await click(document.querySelector('[aria-label="打开便签：测试便签"]'));
  assert.equal(document.querySelectorAll(".inline-image img").length, 1);
});

test("editing a legacy note preserves its literal source, image references and v1 format metadata", async () => {
  const original = `# 原有标题\n**原有正文**\n${marker}`;
  await mount(original, "markdown");
  await act(() => view().dispatch({ changes: { from: 0, insert: "新增文字\n" } }));
  const notes = JSON.parse(saved).notes;
  assert.equal(notes[0].content, "新增文字\n" + original);
  assert.equal(notes[0].format, "markdown");
  assert.equal(notes[1].content, "不能丢失");
  assert.equal(document.querySelector(".inline-image img").getAttribute("src"), path);
});

test("a failed notebook save does not claim that an inserted image was saved", async () => {
  await mount("前文后文", "text", true);
  const baseline = saved;
  await selectImage();
  assert.equal(saved, baseline);
  assert.match(document.querySelector(".save-status").textContent, /尚未保存/);
  assert.match(document.querySelector('[role="alert"]').textContent, /测试保存失败/);
});

test("remote image syntax and active HTML stay literal text; only private image markers render images", async () => {
  await mount(`${marker}\n![远程](https://example.org/a.jpg)\n<img src="data:image/png;base64,a"><img src="${path}" onerror="alert(1)"><svg><image href="${path}"></image></svg><script>alert(2)</script>`, "markdown");
  const content = document.querySelector(".cm-content");
  assert.equal(content.querySelectorAll("img").length, 1);
  assert.equal(content.querySelector("img").getAttribute("src"), path);
  assert.ok(!content.querySelector("script, svg, image, [onerror]"));
  assert.match(content.textContent, /https:\/\/example\.org/);
  assert.match(content.textContent, /<script>alert\(2\)<\/script>/);
});

test("backspace after an image does not reveal hidden image markup", async () => {
  await mount(`前文\n${marker}\n后文`);
  const editor = view();
  await act(() => editor.dispatch({ selection: { anchor: editor.state.doc.line(3).from } }));
  await act(() => deleteCharBackward(editor));
  assert.doesNotMatch(document.querySelector(".cm-content").textContent, /!\[图片\]/);
  await click(document.querySelector(".remove-image"));
  await click(document.querySelector('dialog[open] .danger'));
  assert.equal(JSON.parse(saved).notes[0].content, "前文\n后文");
});

test("backspace at an image boundary does not silently erase an adjacent picture", async () => {
  const other = "![图片](/images/ffffffffffffffffffffffffffffffff.png)";
  await mount(`${marker}\n${other}\n正文`);
  const editor = view(), baseline = saved;
  await act(() => editor.dispatch({ selection: { anchor: marker.length } }));
  await act(() => deleteCharBackward(editor));
  assert.equal(saved, baseline);
  assert.equal(imageBlocks(editor.state.doc.toString()).length, 2);
  assert.equal(editor.state.selection.main.from, marker.length);
});

test("removing a picture requires confirmation rather than a single accidental tap", async () => {
  await mount(`前文\n${marker}\n后文`);
  const baseline = saved;
  await click(document.querySelector(".remove-image"));
  assert.equal(saved, baseline);
  assert.match(document.querySelector('dialog[open]').textContent, /移除这张图片/);
});

test("image input gaps create a real writable line between adjacent pictures without rewriting their markers", async () => {
  const other = "![图片](/images/ffffffffffffffffffffffffffffffff.png)";
  await mount(`${marker}\n${other}\n后文`);
  await click(document.querySelector(".image-input-gap"));
  const editor = view(), position = marker.length + 1;
  assert.equal(editor.state.doc.toString(), `${marker}\n\n${other}\n后文`);
  assert.equal(editor.state.selection.main.from, position);
  const baseline = saved;
  await click(document.querySelector(".image-input-gap"));
  assert.equal(saved, baseline);
  await act(() => editor.dispatch({ changes: { from: position, insert: "中间文字" }, userEvent: "input.type" }));
  assert.equal(JSON.parse(saved).notes[0].content, `${marker}\n中间文字\n${other}\n后文`);
  assert.equal(document.querySelectorAll(".inline-image").length, 2);
  assert.equal(JSON.parse(saved).notes[1].content, "不能丢失");
  await restart(); await click(document.querySelector('[aria-label="打开便签：测试便签"]'));
  assert.equal(view().state.doc.toString(), `${marker}\n中间文字\n${other}\n后文`);
});

test("inline pictures render naturally without cards or visible input prompts while retaining accessible controls", async () => {
  await mount(`前文\n${marker}\n${marker}\n后文`);
  const pictures = document.querySelectorAll(".inline-image");
  assert.equal(pictures.length, 2);
  for (const picture of pictures) {
    assert.equal(picture.querySelector(".image-frame, .image-actions"), null);
    assert.doesNotMatch(picture.textContent, /图片已保护|点此输入文字/);
    const gap = picture.querySelector(".image-input-gap");
    assert.equal(gap.tagName, "BUTTON");
    assert.equal(gap.textContent, "");
    assert.equal(gap.getAttribute("aria-label"), "在这张图片下方输入文字");
    assert.equal(picture.querySelector(".view-image").getAttribute("aria-label"), "查看图片大图");
    assert.equal(picture.querySelector(".remove-image").getAttribute("aria-label"), "移除这张图片（需确认）");
  }
  assert.equal(view().state.doc.toString(), `前文\n${marker}\n${marker}\n后文`);
});

test("a gap between legacy same-line images accepts another inserted picture without losing either neighbor", async () => {
  const other = "![图片](/images/ffffffffffffffffffffffffffffffff.png)";
  await mount(`${marker}${other}`);
  await click(document.querySelector(".image-input-gap"));
  assert.equal(view().state.doc.toString(), `${marker}\n\n${other}`);
  await selectImage();
  assert.equal(imageBlocks(JSON.parse(saved).notes[0].content).length, 3);
  assert.equal(document.querySelectorAll(".inline-image").length, 3);
  assert.ok(view().state.doc.toString().startsWith(`${marker}\n`));
  assert.ok(view().state.doc.toString().endsWith(other));
});

test("cancel, Android back and dialog cancel all retain the picture and stay in its editor", async () => {
  await mount(marker);
  const baseline = saved;
  for (const action of ["button", "back", "cancel"]) {
    await click(document.querySelector(".remove-image"));
    const dialog = document.querySelector("dialog[open]");
    assert.equal(dialog.querySelector("img").getAttribute("src"), path);
    if (action === "button") await click(dialog.querySelector("button:not(.danger)"));
    else if (action === "back") await act(() => { assert.equal(window.betterNotepadBack(), true); });
    else await act(() => dialog.dispatchEvent(new window.Event("cancel", { cancelable: true })));
    assert.equal(saved, baseline);
    assert.ok(!document.querySelector("dialog[open]"));
    assert.ok(document.querySelector(".note-page .inline-image"));
  }
});

test("confirmed removal targets the second of identical pictures, preserves text, and has reversible history", async () => {
  await mount(`前文\n${marker}\n${marker}\n后文`);
  const baseline = saved;
  await click(document.querySelectorAll(".remove-image")[1]);
  assert.equal(saved, baseline);
  await act(() => view().dispatch({ changes: { from: 0, insert: "新增" }, userEvent: "input.type" }));
  await click(document.querySelector('dialog[open] .danger'));
  assert.equal(view().state.doc.toString(), `新增前文\n${marker}\n后文`);
  assert.equal(imageBlocks(JSON.parse(saved).notes[0].content).length, 1);
  await act(() => undo(view()));
  assert.equal(view().state.doc.toString(), `新增前文\n${marker}\n${marker}\n后文`);
  await act(() => redo(view()));
  assert.equal(view().state.doc.toString(), `新增前文\n${marker}\n后文`);
});

test("image protection also blocks forward delete, Android IME edits, cuts and replacement pastes", async () => {
  await mount(`前文\n${marker}\n后文`);
  const editor = view(), block = imageBlocks(editor.state.doc.toString())[0], baseline = saved;
  await act(() => editor.dispatch({ selection: { anchor: block.from } }));
  await act(() => deleteCharForward(editor));
  assert.equal(saved, baseline);
  assert.equal(editor.state.selection.main.from, block.from);
  for (const userEvent of ["delete.backward", "input.type.compose", "delete.cut", "input.paste"]) {
    await act(() => editor.dispatch({ changes: { from: block.from + 1, to: block.to - 1, insert: userEvent === "input.paste" ? "替换文字" : "" }, userEvent }));
    assert.equal(saved, baseline);
    assert.equal(editor.state.selection.main.from, block.from);
  }
  await act(() => editor.dispatch({ changes: [{ from: 0, to: 1, insert: "改" }, { from: editor.state.doc.length - 1, insert: "新" }], userEvent: "input.type" }));
  assert.equal(imageBlocks(JSON.parse(saved).notes[0].content).length, 1);
  assert.ok(view().state.doc.toString().startsWith("改文"));
  assert.ok(view().state.doc.toString().endsWith("后新文"));
});

test("a picker cannot silently replace a selected protected picture or report a successful insertion", async () => {
  await mount(marker);
  const baseline = saved;
  await act(() => view().dispatch({ selection: { anchor: 0, head: marker.length } }));
  await selectImage();
  assert.equal(saved, baseline);
  assert.equal(imageBlocks(view().state.doc.toString()).length, 1);
  assert.match(document.querySelector('[role="alert"]').textContent, /未能插入/);
  assert.equal(imageButton().disabled, false);
});

test("a failed save after confirmed image removal keeps the persisted note and reports the unsaved draft", async () => {
  await mount(marker, "text", true);
  const baseline = saved;
  await click(document.querySelector(".remove-image"));
  await click(document.querySelector('dialog[open] .danger'));
  assert.equal(saved, baseline);
  assert.equal(imageBlocks(view().state.doc.toString()).length, 0);
  assert.match(document.querySelector('[role="alert"]').textContent, /尚未保存/);
  await act(() => undo(view()));
  assert.equal(imageBlocks(view().state.doc.toString()).length, 1);
});

test("native note switching is deferred during image confirmation and cancel never deletes a different note", async () => {
  await mount(marker);
  const baseline = saved;
  window.BetterNotepad.ready = () => window.betterNotepadResume("old");
  await click(document.querySelector(".remove-image"));
  await act(() => { assert.equal(window.betterNotepadResume("old"), false); });
  assert.equal(document.querySelector('[aria-label="便签标题"]').value, "测试便签");
  await click(document.querySelector('dialog[open] button:not(.danger)'));
  assert.equal(saved, baseline);
  assert.equal(document.querySelector('[aria-label="便签标题"]').value, "原有便签");
  assert.ok(!document.querySelector("dialog[open]"));
});

test("a confirmation whose picture was already undone does not remove its surviving neighbor", async () => {
  const other = "![图片](/images/ffffffffffffffffffffffffffffffff.png)";
  await mount(other);
  await act(() => view().dispatch({ selection: { anchor: 0 } }));
  await selectImage();
  await click(document.querySelector(".remove-image"));
  await act(() => undo(view()));
  const baseline = saved;
  await click(document.querySelector('dialog[open] .danger'));
  assert.equal(saved, baseline);
  assert.equal(view().state.doc.toString(), other);
  assert.match(document.querySelector('[role="alert"]').textContent, /图片已变化/);
});

test("picker keeps its original insertion point when text changes during image import", async () => {
  await mount();
  const editor = view();
  await act(() => editor.dispatch({ selection: { anchor: 2 } }));
  await click(imageButton());
  await act(() => editor.dispatch({ changes: { from: 0, insert: "开头" }, selection: { anchor: 6 } }));
  await act(() => window.betterNotepadImageResult({ requestId, path }));
  assert.equal(JSON.parse(saved).notes[0].content, `开头前文\n${marker}\n后文`);
});

test("unknown picker callbacks are ignored and do not unlock an in-progress import", async () => {
  await mount();
  const baseline = saved;
  await click(imageButton());
  await act(() => window.betterNotepadImageResult({ requestId: "f".repeat(32), path }));
  assert.equal(saved, baseline);
  assert.equal(imageButton().disabled, true);
  await act(() => window.betterNotepadImageResult({ requestId, cancelled: true }));
  assert.equal(imageButton().disabled, false);
});
