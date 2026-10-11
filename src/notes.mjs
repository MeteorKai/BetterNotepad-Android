import { bodyText } from "./images.mjs";

export const THEMES = ["warm", "light", "dark"];
export const STORAGE_KEY = "betternotepad.android.v1";
export const DEFAULT_HOME = { title: "我的便签", subtitle: "把一闪而过的灵感，留在这里。" };

export function emptyState() {
  return { version: 1, theme: "warm", notes: [] };
}

export function parseState(raw) {
  if (raw === null) return emptyState();
  const state = JSON.parse(raw);
  if (state?.version !== 1 || !THEMES.includes(state.theme) || !Array.isArray(state.notes)) {
    throw new Error("便签数据格式不受支持，原文件未被修改。");
  }
  if (state.home !== undefined && (!state.home || typeof state.home.title !== "string" ||
      !state.home.title.trim() || state.home.title.length > 40 ||
      typeof state.home.subtitle !== "string" || state.home.subtitle.length > 80)) {
    throw new Error("主页设置数据损坏，原文件未被修改。");
  }
  if (state.manualOrder !== undefined && typeof state.manualOrder !== "boolean") {
    throw new Error("便签排列数据损坏，原文件未被修改。");
  }
  const ids = new Set();
  if (state.trash !== undefined && !Array.isArray(state.trash)) {
    throw new Error("回收站数据损坏，原文件未被修改。");
  }
  for (const note of [...state.notes, ...(state.trash ?? [])]) {
    if (!note || typeof note.id !== "string" || !note.id || ids.has(note.id) ||
        typeof note.title !== "string" || typeof note.content !== "string" ||
        typeof note.pinned !== "boolean" || !["text", "markdown"].includes(note.format) ||
        !Number.isFinite(note.createdAt) || !Number.isFinite(note.updatedAt)) {
      throw new Error("便签数据损坏，原文件未被修改。");
    }
    ids.add(note.id);
    if (note.tags !== undefined && (!Array.isArray(note.tags) || note.tags.length > 8 ||
        new Set(note.tags).size !== note.tags.length || note.tags.some(tag => typeof tag !== "string" ||
          !tag.trim() || tag !== tag.trim() || tag.length > 20 || /[\u0000-\u001f\u007f]/.test(tag)))) {
      throw new Error("标签数据损坏，原文件未被修改。");
    }
    if (note.todos !== undefined && (!Array.isArray(note.todos) ||
        new Set(note.todos.map(item => item?.id)).size !== note.todos.length || note.todos.some(item =>
          !item || typeof item.id !== "string" || !item.id || typeof item.text !== "string" || typeof item.done !== "boolean"))) {
      throw new Error("待办清单数据损坏，原文件未被修改。");
    }
  }
  if ((state.trash ?? []).some(note => !Number.isFinite(note.deletedAt))) {
    throw new Error("回收站数据损坏，原文件未被修改。");
  }
  return state;
}

export function moveToTrash(state, ids, now = Date.now()) {
  const selected = new Set(ids);
  return { ...state, notes: state.notes.filter(note => !selected.has(note.id)),
    trash: [...state.notes.filter(note => selected.has(note.id)).map(note => ({ ...note, deletedAt: now })), ...(state.trash ?? [])] };
}

export function restoreTrash(state, id) {
  const found = (state.trash ?? []).find(note => note.id === id);
  if (!found) return state;
  const { deletedAt, ...note } = found;
  return { ...state, notes: [note, ...state.notes], trash: state.trash.filter(note => note.id !== id) };
}

// Merge never overwrites an existing note, including one already in the bin.
// Conflicting IDs become independent copies; replacement also restores settings.
export function restoreNotebook(current, incoming, mode, newId) {
  if (mode === "replace") return incoming;
  if (mode !== "merge") throw new Error("请选择恢复方式。");
  const ids = new Set([...current.notes, ...(current.trash ?? [])].map(note => note.id));
  const copy = note => {
    let id = note.id;
    while (ids.has(id)) id = newId();
    ids.add(id);
    return { ...note, id };
  };
  return { ...current, notes: [...incoming.notes.map(copy), ...current.notes],
    trash: [...(incoming.trash ?? []).map(copy), ...(current.trash ?? [])] };
}

export function createNote(id, now = Date.now()) {
  return { id, title: "", content: "", format: "text", pinned: false, createdAt: now, updatedAt: now };
}

export function updateNote(notes, id, changes, now = Date.now()) {
  return notes.map(note => note.id === id ? { ...note, ...changes, id, updatedAt: now } : note);
}

export function displayTitle(note) {
  return note.title.trim() || bodyText(note.content).split(/\r?\n/).find(line => line.trim())?.replace(/^#+\s*/, "").trim().slice(0, 40) || note.todos?.find(item => item.text.trim())?.text.trim().slice(0, 40) || "无标题便签";
}

export function noteTags(notes) {
  return [...new Set(notes.flatMap(note => note.tags ?? []))].sort((a, b) => a.localeCompare(b, "zh-CN"));
}

export function swapNotes(state, source, target) {
  const notes = visibleNotes(state.notes, "", false, "all", state.manualOrder);
  const from = notes.findIndex(note => note.id === source), to = notes.findIndex(note => note.id === target);
  if (from < 0 || to < 0 || from === to || notes[from].pinned !== notes[to].pinned) return state;
  const next = [...notes];
  [next[from], next[to]] = [next[to], next[from]];
  return { ...state, notes: next, manualOrder: true };
}

// Filter values are separate from labels so a real tag named "none" stays usable.
export function visibleNotes(notes, query = "", pinnedOnly = false, tagFilter = "all", manualOrder = false) {
  const q = query.trim().toLocaleLowerCase();
  return notes.filter(note => (!pinnedOnly || note.pinned) &&
    (tagFilter === "all" || (tagFilter === "none" ? !note.tags?.length : note.tags?.includes(tagFilter.slice(4)))) &&
    (!q || `${note.title}\n${note.content}\n${(note.tags ?? []).join(" ")}\n${(note.todos ?? []).map(item => item.text).join("\n")}`.toLocaleLowerCase().includes(q)))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || (manualOrder ? 0 : b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)));
}

// Android uses an AtomicFile in private app storage; browser preview uses localStorage.
const revisions = new WeakMap();
export function loadState(storage, native) {
  if (!native) return parseState(storage.getItem(STORAGE_KEY));
  const result = JSON.parse(native.load());
  if (!result.ok) throw new Error(result.error);
  const state = parseState(result.data);
  if (native.saveChecked) {
    if (typeof result.revision !== "string") throw new Error("无法确认本机数据版本，请重新打开应用。");
    revisions.set(native, result.revision);
    revisions.set(state, result.revision);
  }
  return state;
}

export function saveState(state, storage, native, baseline = native) {
  const raw = JSON.stringify(state);
  if (!native) return storage.setItem(STORAGE_KEY, raw);
  const expected = revisions.get(baseline) ?? "";
  if (native.saveChecked) revisions.set(state, expected);
  const result = JSON.parse(native.saveChecked ? native.saveChecked(raw, expected) : native.save(raw));
  if (!result.ok) { const error = new Error(result.error); error.conflict = !!result.conflict; throw error; }
  if (native.saveChecked) { revisions.set(native, result.revision); revisions.set(state, result.revision); }
}
