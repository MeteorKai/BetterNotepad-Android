import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { createNote, emptyState } from "../src/notes.mjs";

let compiler, App;
before(async () => {
  // Compile locally without starting an HTTP server or opening a browser.
  compiler = await createServer({
    server: { middlewareMode: true, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    appType: "custom",
  });
  App = (await compiler.ssrLoadModule("/src/App.tsx")).default;
});
after(async () => { delete globalThis.window; await compiler?.close(); });

function render(raw, native) {
  globalThis.window = { localStorage: { getItem: () => raw }, BetterNotepad: native };
  return renderToStaticMarkup(React.createElement(App));
}

test("fresh home renders a notebook, not desktop document tabs", () => {
  const html = render(null);
  assert.match(html, /我的便签/);
  assert.match(html, /第一篇，从一个想法开始/);
  assert.match(html, /aria-label="新建便签"/);
  assert.doesNotMatch(html, /role="tab"|class="editor-bar"|class="note-card/);
});

test("home has search and settings buttons rather than a permanent search field", () => {
  const html = render(null);
  assert.match(html, /<button[^>]+aria-label="搜索便签"/);
  assert.match(html, /<button[^>]+aria-label="打开设置"/);
  assert.doesNotMatch(html, /<input[^>]+aria-label="搜索便签"/);
});

test("saved homepage title and subtitle render as escaped text", () => {
  const html = render(JSON.stringify({ ...emptyState(), home: { title: "<script>private</script>", subtitle: "记下今天的小事" } }));
  assert.match(html, /&lt;script&gt;private&lt;\/script&gt;/);
  assert.match(html, /记下今天的小事/);
  assert.doesNotMatch(html, /<script>private<\/script>/);
});

test("saved notes render as separate, escaped home cards", () => {
  const state = { ...emptyState(), notes: [
    { ...createNote("one"), title: "手机便签", content: "第一篇正文" },
    { ...createNote("two"), title: "<script>private</script>", content: "第二篇正文", pinned: true },
  ] };
  const html = render(JSON.stringify(state));
  assert.equal((html.match(/class="note-card/g) || []).length, 2);
  assert.match(html, /第一篇正文/);
  assert.match(html, /第二篇正文/);
  assert.match(html, /&lt;script&gt;private&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>private<\/script>/);
});

test("cards use the same note label for text and legacy Markdown, retaining pins and saved data", () => {
  const raw = JSON.stringify({ ...emptyState(), notes: [
    { ...createNote("one"), title: "重要想法", pinned: true, format: "markdown" },
    { ...createNote("two"), title: "日常记录" },
  ] });
  const html = render(raw);
  assert.match(html, /class="note-card color-\d pinned"/);
  assert.match(html, /aria-label="打开便签：重要想法，已置顶"/);
  assert.match(html, /class="pin-badge"/);
  assert.doesNotMatch(html, /Markdown|文字便签/);
  assert.equal((html.match(/class="format-label"/g) || []).length, 2);
  assert.equal(window.localStorage.getItem(), raw);
});

test("theme controls describe the currently saved theme", () => {
  for (const [theme, label] of [["warm", "暖色"], ["light", "浅色"], ["dark", "深色"]]) {
    const html = render(JSON.stringify({ ...emptyState(), theme }));
    assert.match(html, new RegExp(`切换主题，当前${label}`));
    assert.match(html, /aria-hidden="true"/);
  }
});

test("image cards show a private thumbnail instead of exposing image markup", () => {
  const path = "/images/0123456789abcdef0123456789abcdef.jpg";
  const html = render(JSON.stringify({ ...emptyState(), notes: [
    { ...createNote("picture"), content: `![图片](${path})\n一段文字` },
  ] }));
  assert.match(html, new RegExp(`class="card-image" src="${path}"`));
  assert.match(html, /一段文字/);
  assert.doesNotMatch(html, /!\[图片\]/);
});

test("corrupt saved data renders recovery information, not an editable empty notebook", () => {
  const html = render("{broken");
  assert.match(html, /便签暂时无法读取/);
  assert.match(html, /没有覆盖原来的数据/);
  assert.doesNotMatch(html, /aria-label="新建便签"/);
});

test("native load failures are visible on launch", () => {
  const html = render(null, { load: () => '{"ok":false,"error":"本机读取失败"}' });
  assert.match(html, /本机读取失败/);
  assert.match(html, /重新读取/);
});

test("tag labels and task-only cards escape user text and show progress", () => {
  const raw = JSON.stringify({ ...emptyState(), notes: [
    { ...createNote("tasks"), tags: ["<b>生活</b>"], todos: [
      { id: "todo", text: "<script>private</script>", done: true },
    ] },
  ] });
  const html = render(raw);
  assert.match(html, /&lt;b&gt;生活&lt;\/b&gt;/);
  assert.match(html, /&lt;script&gt;private&lt;\/script&gt;/);
  assert.match(html, /按标签筛选便签/);
  assert.match(html, /待办 1 \/ 1/);
  assert.doesNotMatch(html, /<b>生活<\/b>|<script>private<\/script>/);
  assert.equal(window.localStorage.getItem(), raw);
});
