import test from "node:test";
import assert from "node:assert/strict";
import { createNote, DEFAULT_HOME, displayTitle, emptyState, loadState, moveToTrash, noteTags, parseState, restoreNotebook, restoreTrash, saveState, STORAGE_KEY, updateNote, visibleNotes } from "../src/notes.mjs";
import * as notesModel from "../src/notes.mjs";

function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test("checked saves bind revisions to the displayed snapshot, not a later background read", () => {
  let raw = JSON.stringify({ ...emptyState(), notes: [createNote("one")] }), revision = "first";
  const native = { load: () => JSON.stringify({ ok: true, data: raw, revision }), saveChecked: (next, expected) => {
    if (expected !== revision) return JSON.stringify({ ok: false, conflict: true, error: "desktop changed" });
    raw = next; revision += "-next"; return JSON.stringify({ ok: true, revision });
  } };
  const original = loadState(null, native);
  revision = "desktop";
  const current = loadState(null, native);
  const draft = { ...original, home: DEFAULT_HOME };
  assert.throws(() => saveState(draft, null, native, original), error => error.conflict === true);
  assert.throws(() => saveState(draft, null, native, draft), error => error.conflict === true);
  const next = { ...current, home: DEFAULT_HOME };
  saveState(next, null, native, current);
  saveState({ ...next, theme: "dark" }, null, native, next);
  assert.equal(JSON.parse(raw).theme, "dark");
});

test("new checked bridge refuses missing load revisions and failed reads do not unlock old drafts", () => {
  let result = { ok: true, data: JSON.stringify(emptyState()), revision: "v1" };
  let called;
  const native = { load: () => JSON.stringify(result), saveChecked: (raw, expected) => { called = expected; return '{"ok":false,"error":"disk full"}'; } };
  const state = loadState(null, native);
  result = { ok: false, error: "read failed" };
  assert.throws(() => loadState(null, native), /read failed/);
  assert.throws(() => saveState(state, null, native, state), /disk full/);
  assert.equal(called, "v1");
  result = { ok: true, data: JSON.stringify(emptyState()) };
  assert.throws(() => loadState(null, native), /数据版本/);
});

test("fresh install has no fabricated notes", () => {
  assert.deepEqual(loadState(memoryStorage()), emptyState());
});

test("create, edit, restart and delete round-trip without losing Unicode", () => {
  const storage = memoryStorage();
  let state = emptyState();
  state.notes = [createNote("one", 100), createNote("two", 200)];
  state.notes = updateNote(state.notes, "one", { title: "灵感 ✨", content: "中文\n🙂 é", format: "markdown" }, 300);
  saveState(state, storage);
  assert.deepEqual(loadState(storage), state);
  assert.equal(state.notes[0].createdAt, 100);
  assert.equal(state.notes[0].updatedAt, 300);
  assert.equal(state.notes[1].content, "");
  state.notes = state.notes.filter(note => note.id !== "one");
  saveState(state, storage);
  assert.deepEqual(loadState(storage).notes.map(note => note.id), ["two"]);
});

test("search title and body, order pinned first without mutating source", () => {
  const notes = [
    { ...createNote("a", 100), title: "Meeting" },
    { ...createNote("b", 200), content: "meeting 中文", pinned: true },
    { ...createNote("c", 300), content: "other" },
  ];
  assert.deepEqual(visibleNotes(notes, " MEETING ").map(note => note.id), ["b", "a"]);
  assert.deepEqual(visibleNotes(notes, "中文", true).map(note => note.id), ["b"]);
  assert.deepEqual(visibleNotes(notes).map(note => note.id), ["b", "c", "a"]);
  assert.deepEqual(notes.map(note => note.id), ["a", "b", "c"]);
});

test("untitled notes use first nonempty content line", () => {
  assert.equal(displayTitle(createNote("a")), "无标题便签");
  assert.equal(displayTitle({ ...createNote("b"), content: "\n# 今日想法\n内容" }), "今日想法");
});

test("corrupt or unknown data is rejected and never overwritten", () => {
  const storage = memoryStorage();
  for (const raw of ["{broken", JSON.stringify({ ...emptyState(), version: 2 }),
    JSON.stringify({ ...emptyState(), notes: [{ ...createNote("a"), content: 10 }] }),
    JSON.stringify({ ...emptyState(), notes: [createNote("a"), createNote("a")] })]) {
    storage.setItem(STORAGE_KEY, raw);
    assert.throws(() => loadState(storage));
    assert.equal(storage.getItem(STORAGE_KEY), raw);
  }
});

test("all themes survive restart", () => {
  const storage = memoryStorage();
  for (const theme of ["warm", "light", "dark"]) {
    saveState({ ...emptyState(), theme }, storage);
    assert.equal(loadState(storage).theme, theme);
  }
});

test("v1 notebooks without homepage settings load without rewriting old data", () => {
  const storage = memoryStorage();
  const original = { ...emptyState(), notes: [createNote("old", 100)] };
  const raw = JSON.stringify(original);
  storage.setItem(STORAGE_KEY, raw);
  assert.deepEqual(loadState(storage), original);
  assert.equal(storage.getItem(STORAGE_KEY), raw);
  assert.equal(loadState(storage).home, undefined);
});

test("homepage text survives restart without changing notes, theme or legacy metadata", () => {
  const storage = memoryStorage();
  const original = { ...emptyState(), theme: "dark", notes: [{ ...createNote("old", 100), content: "# 中文 🙂", format: "markdown" }] };
  const state = { ...original, home: { title: "我的小本子 ✨", subtitle: "写下今天的故事" } };
  saveState(state, storage);
  assert.deepEqual(loadState(storage), state);
  assert.deepEqual(loadState(storage).notes, original.notes);
  saveState({ ...state, home: { title: "我的便签", subtitle: "" } }, storage);
  assert.equal(loadState(storage).home.subtitle, "");
});

test("invalid homepage settings are rejected without overwriting the notebook", () => {
  const storage = memoryStorage();
  for (const home of [null, {}, { title: 1, subtitle: "文字" }, { title: " ", subtitle: "文字" },
    { title: "有效", subtitle: false }, { title: "长".repeat(41), subtitle: "文字" },
    { title: "有效", subtitle: "长".repeat(81) }]) {
    const raw = JSON.stringify({ ...emptyState(), home });
    storage.setItem(STORAGE_KEY, raw);
    assert.throws(() => loadState(storage), /主页设置数据损坏/);
    assert.equal(storage.getItem(STORAGE_KEY), raw);
  }
});

test("Android bridge takes precedence and reports failed reads/writes", () => {
  const storage = { getItem() { throw new Error("should not use browser storage"); } };
  let raw = null;
  const bridge = { load: () => JSON.stringify({ ok: true, data: raw }), save: value => { raw = value; return '{"ok":true}'; } };
  const state = { ...emptyState(), notes: [createNote("android")] };
  saveState(state, storage, bridge);
  assert.deepEqual(loadState(storage, bridge), state);
  assert.throws(() => saveState(state, null, { save: () => '{"ok":false,"error":"disk full"}' }), /disk full/);
  assert.throws(() => loadState(null, { load: () => '{"ok":false,"error":"read failed"}' }), /read failed/);
});

test("browser quota errors propagate rather than claiming data was saved", () => {
  assert.throws(() => saveState(emptyState(), { setItem() { throw new Error("quota exceeded"); } }), /quota exceeded/);
});

test("missing or invalid note fields are rejected", () => {
  for (const changes of [{ id: "" }, { format: "exe" }, { updatedAt: null }, { pinned: "yes" }]) {
    assert.throws(() => parseState(JSON.stringify({ ...emptyState(), notes: [{ ...createNote("a"), ...changes }] })));
  }
});

test("delete and restore preserve text, images, legacy metadata and pin state across restart", () => {
  const image = "/images/0123456789abcdef0123456789abcdef.jpg";
  const source = { ...emptyState(), notes: [{ ...createNote("one", 100), content: `中文\n![图片](${image})`, pinned: true, format: "markdown" }, createNote("keep", 200)] };
  const deleted = moveToTrash(source, ["one"], 300);
  assert.deepEqual(source.notes.map(note => note.id), ["one", "keep"]);
  assert.deepEqual(deleted.notes, [source.notes[1]]);
  assert.deepEqual(deleted.trash, [{ ...source.notes[0], deletedAt: 300 }]);
  const loaded = parseState(JSON.stringify(deleted));
  assert.equal(visibleNotes(loaded.notes, "中文").length, 0);
  const restored = restoreTrash(loaded, "one");
  assert.deepEqual(restored.notes, source.notes);
  assert.deepEqual(restored.trash, []);
  assert.deepEqual(restoreTrash(loaded, "missing"), loaded);
});

test("repeated deletion only moves active notes and preserves existing bin contents without expiry", () => {
  const old = { ...createNote("old", 1), deletedAt: 2 };
  const source = { ...emptyState(), notes: [createNote("one", 3)], trash: [old] };
  const moved = moveToTrash(source, ["one", "old", "missing"], 4);
  assert.deepEqual(moveToTrash(moved, ["one"], 5), moved);
  assert.deepEqual(parseState(JSON.stringify(moved)).trash[1], old);
});

test("malformed bin data and IDs conflicting with active notes are rejected", () => {
  for (const trash of [null, {}, [createNote("bin")], [{ ...createNote("bin"), deletedAt: "yesterday" }],
    [{ ...createNote("one"), deletedAt: 3 }], [{ ...createNote("bin"), deletedAt: 3 }, { ...createNote("bin"), deletedAt: 4 }]]) {
    assert.throws(() => parseState(JSON.stringify({ ...emptyState(), notes: [createNote("one")], trash })));
  }
});

test("backup merge retains current settings and both active/bin ID conflicts as independent copies", () => {
  const current = { ...emptyState(), theme: "dark", home: { title: "本机", subtitle: "保留" }, notes: [createNote("one", 1)], trash: [{ ...createNote("two", 2), deletedAt: 3 }] };
  const incoming = { ...emptyState(), home: { title: "备份", subtitle: "" }, notes: [createNote("two", 4)], trash: [{ ...createNote("one", 5), deletedAt: 6 }] };
  let count = 0;
  const merged = restoreNotebook(current, incoming, "merge", () => `copy-${++count}`);
  assert.deepEqual(merged.notes, [{ ...incoming.notes[0], id: "copy-1" }, current.notes[0]]);
  assert.deepEqual(merged.trash, [{ ...incoming.trash[0], id: "copy-2" }, current.trash[0]]);
  assert.equal(merged.theme, current.theme);
  assert.deepEqual(merged.home, current.home);
  assert.deepEqual(parseState(JSON.stringify(merged)), merged);
  assert.deepEqual(restoreNotebook(current, incoming, "replace", () => assert.fail()), incoming);
  assert.throws(() => restoreNotebook(current, incoming, "invalid", () => assert.fail()));
  assert.equal(incoming.notes[0].id, "two");
});

test("tag and checklist metadata round-trip through save, bin recovery, merge and replacement", () => {
  const note = { ...createNote("one", 10), tags: ["工作", "生活 🙂"], todos: [
    { id: "task-1", text: "采购中文 🛒", done: false }, { id: "task-2", text: "已完成", done: true },
  ] };
  const state = { ...emptyState(), notes: [note] }, storage = memoryStorage();
  saveState(state, storage); assert.deepEqual(loadState(storage), state);
  const deleted = parseState(JSON.stringify(moveToTrash(state, [note.id], 20)));
  assert.deepEqual(restoreTrash(deleted, note.id).notes[0], note);
  const merged = restoreNotebook(state, state, "merge", () => "copy");
  assert.deepEqual(merged.notes[0].todos, note.todos); assert.deepEqual(merged.notes[0].tags, note.tags);
  assert.deepEqual(parseState(JSON.stringify(merged)), merged);
  assert.deepEqual(restoreNotebook(emptyState(), deleted, "replace", () => assert.fail()), deleted);
});

test("tag filtering combines with pins, unclassified notes and search without modifying order", () => {
  const notes = [{ ...createNote("a", 1), tags: ["工作", "none"], todos: [{ id: "t", text: "Buy tickets", done: true }] },
    { ...createNote("b", 2), tags: ["工作", "学习"], pinned: true }, createNote("c", 3)];
  assert.deepEqual(visibleNotes(notes, "", false, "tag:工作").map(note => note.id), ["b", "a"]);
  assert.deepEqual(visibleNotes(notes, "", true, "tag:工作").map(note => note.id), ["b"]);
  assert.deepEqual(visibleNotes(notes, "", false, "none").map(note => note.id), ["c"]);
  assert.deepEqual(visibleNotes(notes, "", false, "tag:none").map(note => note.id), ["a"]);
  assert.deepEqual(visibleNotes(notes, "工作").map(note => note.id), ["b", "a"]);
  assert.deepEqual(visibleNotes(notes, "TICKETS").map(note => note.id), ["a"]);
  assert.equal(noteTags(notes).length, 3); assert.deepEqual(notes.map(note => note.id), ["a", "b", "c"]);
});

test("card swapping freezes the displayed order and only exchanges endpoints without changing note fields", () => {
  const state = { ...emptyState(), notes: [
    { ...createNote("a", 10), content: "原正文", tags: ["工作", "生活"] },
    { ...createNote("b", 20), todos: [{ id: "task", text: "保留", done: true }] }, createNote("c", 30),
  ] };
  const raw = JSON.stringify(state);
  const next = notesModel.swapNotes(state, "c", "a");
  assert.equal(next.manualOrder, true);
  assert.deepEqual(next.notes.map(note => note.id), ["a", "b", "c"]);
  assert.equal(JSON.stringify(state), raw);
  for (const note of next.notes) assert.equal(note, state.notes.find(item => item.id === note.id));
  assert.deepEqual(visibleNotes(next.notes, "", false, "all", next.manualOrder).map(note => note.id), ["a", "b", "c"]);
});

test("invalid card drops and cross-pin swaps leave the original notebook untouched", () => {
  const state = { ...emptyState(), notes: [createNote("a", 1), { ...createNote("pin", 2), pinned: true }] };
  for (const [source, target] of [["a", "a"], ["a", null], ["missing", "a"], ["a", "missing"], ["a", "pin"]]) {
    assert.equal(notesModel.swapNotes(state, source, target), state);
  }
  assert.equal(state.manualOrder, undefined);
});

test("manual order keeps pins first and global order in searches and category filters", () => {
  const state = { ...emptyState(), notes: [
    { ...createNote("a", 1), title: "中文", tags: ["工作"] },
    { ...createNote("p", 2), pinned: true }, { ...createNote("hidden", 3), tags: ["生活"] },
    { ...createNote("b", 4), content: "中文", tags: ["工作"] }, { ...createNote("q", 5), pinned: true },
  ] };
  const next = notesModel.swapNotes(state, "a", "b");
  const order = (q = "", pinned = false, tag = "all") => visibleNotes(next.notes, q, pinned, tag, next.manualOrder).map(note => note.id);
  assert.deepEqual(order(), ["q", "p", "a", "hidden", "b"]);
  assert.deepEqual(order("中文"), ["a", "b"]);
  assert.deepEqual(order("", false, "tag:工作"), ["a", "b"]);
  const pinned = notesModel.swapNotes(next, "q", "p");
  assert.deepEqual(visibleNotes(pinned.notes, "", true, "all", pinned.manualOrder).map(note => note.id), ["p", "q"]);
});

test("manual order survives saves, edits, insertion, bin restore, and backup replacement", () => {
  const source = { ...emptyState(), notes: [createNote("a", 1), createNote("b", 2), createNote("c", 3)] };
  const ordered = notesModel.swapNotes(source, "a", "c"), storage = memoryStorage();
  saveState(ordered, storage); assert.deepEqual(loadState(storage), ordered);
  const edited = { ...loadState(storage), notes: updateNote(ordered.notes, "c", { content: "编辑不打乱顺序" }, 100) };
  assert.deepEqual(visibleNotes(edited.notes, "", false, "all", edited.manualOrder).map(note => note.id), ["a", "b", "c"]);
  const added = { ...edited, notes: [createNote("new", 200), ...edited.notes] };
  assert.deepEqual(visibleNotes(added.notes, "", false, "all", added.manualOrder).map(note => note.id), ["new", "a", "b", "c"]);
  const deleted = moveToTrash(added, ["b"], 300);
  assert.equal(deleted.manualOrder, true);
  const restored = restoreTrash(deleted, "b");
  assert.deepEqual(visibleNotes(restored.notes, "", false, "all", restored.manualOrder).map(note => note.id), ["b", "new", "a", "c"]);
  assert.deepEqual(restoreNotebook(source, ordered, "replace", () => "copy"), ordered);
  const merged = restoreNotebook(ordered, { ...emptyState(), notes: [createNote("incoming", 400)] }, "merge", () => "copy");
  assert.equal(merged.manualOrder, true);
  assert.deepEqual(visibleNotes(merged.notes, "", false, "all", merged.manualOrder).map(note => note.id), ["incoming", "a", "b", "c"]);
});

test("manual order is optional for old notebooks and invalid values never rewrite storage", () => {
  const storage = memoryStorage();
  for (const value of [null, "true", 1, [], {}]) {
    const raw = JSON.stringify({ ...emptyState(), manualOrder: value }); storage.setItem(STORAGE_KEY, raw);
    assert.throws(() => loadState(storage), /排列数据/); assert.equal(storage.getItem(STORAGE_KEY), raw);
  }
  assert.deepEqual(parseState(JSON.stringify(emptyState())), emptyState());
  assert.equal(parseState(JSON.stringify({ ...emptyState(), manualOrder: false })).manualOrder, false);
});

test("todo-only notes derive a title but existing literal Markdown body still takes priority", () => {
  const note = { ...createNote("a"), todos: [{ id: "one", text: "", done: false }, { id: "two", text: "  购物清单  ", done: true }] };
  assert.equal(displayTitle(note), "购物清单");
  assert.equal(displayTitle({ ...note, title: "标题" }), "标题");
  assert.equal(displayTitle({ ...note, content: "- [ ] 旧的字面正文" }), "- [ ] 旧的字面正文");
});

test("malformed tag and todo fields in active or recycled notes are rejected before writing", () => {
  const invalid = [{ tags: null }, { tags: ["工作", "工作"] }, { tags: [" "] }, { tags: [" 工作"] },
    { tags: ["过长".repeat(11)] }, { tags: Array.from({ length: 9 }, (_, i) => String(i)) }, { tags: [1] }, { tags: ["控制\n字符"] },
    { todos: null }, { todos: [null] }, { todos: [{ id: "a", text: 1, done: false }] },
    { todos: [{ id: "a", text: "中文", done: "yes" }] }, { todos: [{ id: "", text: "", done: false }] },
    { todos: [{ id: "a", text: "一", done: false }, { id: "a", text: "二", done: true }] }];
  for (const changes of invalid) {
    const note = { ...createNote("one"), ...changes };
    assert.throws(() => parseState(JSON.stringify({ ...emptyState(), notes: [note] })));
    assert.throws(() => parseState(JSON.stringify({ ...emptyState(), trash: [{ ...note, deletedAt: 1 }] })));
  }
});
