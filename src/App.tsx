import { useEffect, useRef, useState } from "react";
import { createNote, DEFAULT_HOME, displayTitle, emptyState, loadState, moveToTrash, noteTags, saveState, swapNotes, THEMES, updateNote, visibleNotes } from "./notes.mjs";
import { bodyText, imageBlocks, isImagePath } from "./images.mjs";
import type { Note, Notebook, Theme } from "./types";
import Icon from "./Icon";
import Editor from "./Editor";
import type { EditorHandle } from "./Editor";
import Settings from "./Settings";
import type { SettingsHandle } from "./Settings";
import TagEditor from "./TagEditor";
import NoteGrid from "./NoteGrid";
import Checklist from "./Checklist";
import ImageViewer from "./ImageViewer";

const themeNames = { warm: "暖色", light: "浅色", dark: "深色" };
const dateLabel = (time: number) => new Date(time).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");

function initialData(): { data: Notebook; error: string } {
  try { return { data: loadState(window.localStorage, window.BetterNotepad), error: "" }; }
  catch (error) { return { data: emptyState() as Notebook, error: String(error) }; }
}

export default function App() {
  const [initial] = useState(initialData);
  const [data, setData] = useState(initial.data);
  const [saveError, setSaveError] = useState("");
  const [syncFailed, setSyncFailed] = useState(false);
  const [confirmReload, setConfirmReload] = useState(false);
  const [editorVersion, setEditorVersion] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [page, setPage] = useState<"home" | "search" | "settings">("home");
  const [query, setQuery] = useState("");
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [tagFilter, setTagFilter] = useState("all");
  const [editingTags, setEditingTags] = useState(false);
  const [focusTodo, setFocusTodo] = useState<string | null>(null);
  const [viewImage, setViewImage] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [sorting, setSorting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState("");
  const editor = useRef<EditorHandle>(null);
  const settings = useRef<SettingsHandle>(null);
  const pendingImage = useRef<{ requestId: string; noteId: string; insert: (path: string | null) => boolean } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const searchField = useRef<HTMLInputElement>(null);
  const reloadDialog = useRef<HTMLDialogElement>(null);
  const resumeHandler = useRef<(noteId: string | null) => boolean>(() => false);
  const note = data.notes.find(item => item.id === activeId);
  const searching = page === "search";
  const home = data.home ?? DEFAULT_HOME;
  const tags = noteTags(data.notes) as string[];
  const notes = visibleNotes(data.notes, searching ? query : "", searching ? false : pinnedOnly, searching ? "all" : tagFilter, data.manualOrder) as Note[];
  const canReorder = notes.filter(item => item.pinned).length > 1 || notes.filter(item => !item.pinned).length > 1;
  const selected = new Set(selectedIds);
  const deleting = new Set(confirmDelete ?? []);
  const allSelected = notes.length > 0 && notes.every(item => selected.has(item.id));
  const deletingNotes = data.notes.filter(item => deleting.has(item.id));

  // Persist immediately, not in a delayed effect: an Android process may be
  // killed as soon as it is backgrounded. Never report success before writing.
  function commit(next: Notebook, keepDraftOnError = true) {
    try {
      if (syncFailed) throw new Error("请先重新读取便签，避免覆盖桌面上的修改。");
      saveState(next, window.localStorage, window.BetterNotepad, data);
      setData(next);
      setSaveError("");
      return true;
    } catch (error) {
      if (keepDraftOnError) setData(next);
      setSaveError(String(error));
      if ((error as { conflict?: boolean })?.conflict) setSyncFailed(true);
      return false;
    }
  }

  function edit(changes: Partial<Note>) {
    if (note) commit({ ...data, notes: updateNote(data.notes, note.id, changes) });
  }

  function addTodo() {
    if (!note) return;
    const id = newId();
    edit({ todos: [...(note.todos ?? []), { id, text: "", done: false }] });
    setFocusTodo(id);
  }

  function open(id: string) { finishSorting(); setActiveId(id); setFocusTodo(null); }
  function finishSelection() { setSelecting(false); setSelectedIds([]); }
  function finishSorting() { setSorting(false); }
  function reorder(source: string, target: string) {
    if (!sorting || !notes.some(item => item.id === source) || !notes.some(item => item.id === target)) return;
    const next = swapNotes(data, source, target) as Notebook;
    if (next !== data) commit(next);
  }
  function toggleSelection(id: string) {
    setSelectedIds(ids => ids.includes(id) ? ids.filter(item => item !== id) : [...ids, id]);
  }
  function requestDelete(ids: string[]) { setDeleteFailed(false); setConfirmDelete(ids); }
  function removeConfirmed() {
    if (!confirmDelete?.length) return;
    if (commit(moveToTrash(data, confirmDelete) as Notebook, false)) {
      setConfirmDelete(null);
      setActiveId(null);
      finishSelection();
    } else setDeleteFailed(true);
  }
  function create() {
    const id = newId();
    const newNote = { ...createNote(id), ...(tagFilter.startsWith("tag:") && !searching ? { tags: [tagFilter.slice(4)] } : {}) } as Note;
    if (commit({ ...data, notes: [newNote, ...data.notes] }, false)) open(newNote.id);
  }
  function back() {
    if (confirmReload) { setConfirmReload(false); return true; }
    if (viewImage) { setViewImage(null); return true; }
    if (editingTags) { setEditingTags(false); return true; }
    if (page === "settings" && settings.current?.back()) return true;
    if (confirmDelete) { setConfirmDelete(null); return true; }
    if (activeId) { setActiveId(null); return true; }
    if (selecting) { finishSelection(); return true; }
    if (sorting) { finishSorting(); return true; }
    if (page !== "home") { setPage("home"); return true; }
    return false;
  }

  function resume(noteId: string | null) {
    if (saveError || syncFailed || pendingImage.current || settings.current?.syncBlocked()) return false;
    try {
      const latest = loadState(window.localStorage, window.BetterNotepad) as Notebook;
      if (JSON.stringify(latest) !== JSON.stringify(data)) {
        if (note && latest.notes.find(item => item.id === note.id)?.content !== note.content) setEditorVersion(value => value + 1);
        finishSelection();
        finishSorting();
        if (activeId && !latest.notes.some(item => item.id === activeId)) setActiveId(null);
      }
      setData(latest);
      if (noteId) {
        setViewImage(null); setEditingTags(false); setConfirmDelete(null); finishSelection(); finishSorting(); setPage("home");
        if (latest.notes.some(item => item.id === noteId)) open(noteId); else setActiveId(null);
      }
      return true;
    } catch (error) { setSaveError(String(error)); setSyncFailed(true); return false; }
  }
  resumeHandler.current = resume;

  function reloadNotebook() {
    try {
      const latest = loadState(window.localStorage, window.BetterNotepad) as Notebook;
      setData(latest); setSaveError(""); setSyncFailed(false); setConfirmReload(false);
      setEditorVersion(value => value + 1); setViewImage(null); setEditingTags(false); setConfirmDelete(null); finishSelection(); finishSorting();
      if (activeId && !latest.notes.some(item => item.id === activeId)) setActiveId(null);
    } catch (error) { setSaveError(String(error)); setSyncFailed(true); }
  }

  function insertImage() {
    if (!note || !editor.current || pendingImage.current) return;
    setImageError("");
    if (!window.BetterNotepad?.pickImage) {
      setImageError("请在 Android 应用中使用插入图片，浏览器预览不支持本机图片。");
      return;
    }
    const request = { requestId: newId(), noteId: note.id, insert: editor.current.captureImageInsertion() };
    pendingImage.current = request;
    setImageBusy(true);
    try { window.BetterNotepad.pickImage(request.requestId); }
    catch {
      request.insert(null);
      pendingImage.current = null;
      setImageBusy(false);
      setImageError("无法打开图片选择器，请重试。");
    }
  }

  useEffect(() => {
    document.documentElement.dataset.theme = data.theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", data.theme === "dark" ? "#1c1a21" : data.theme === "light" ? "#f7f8fb" : "#f8f3eb");
  }, [data.theme]);

  useEffect(() => {
    window.betterNotepadBack = back;
    window.betterNotepadImageResult = result => {
      const request = pendingImage.current;
      if (!request || result.requestId !== request.requestId) return;
      pendingImage.current = null;
      setImageBusy(false);
      if (result.cancelled) { request.insert(null); return; }
      if (result.error || !isImagePath(result.path) || activeId !== request.noteId) {
        request.insert(null);
        setImageError(result.error || (activeId !== request.noteId ? "便签已切换，请重新选择图片。" : "图片读取失败，请重新选择。"));
        return;
      }
      if (!request.insert(result.path!)) setImageError("未能插入图片，请重试。");
    };
    return () => { delete window.betterNotepadBack; delete window.betterNotepadImageResult; };
  });

  useEffect(() => {
    if (confirmDelete) dialog.current?.showModal();
    else dialog.current?.close();
  }, [confirmDelete]);

  useEffect(() => {
    if (tagFilter.startsWith("tag:") && !tags.includes(tagFilter.slice(4))) { setTagFilter("all"); setSelectedIds([]); }
  }, [data.notes, tagFilter]);

  useEffect(() => {
    window.betterNotepadResume = id => resumeHandler.current(id);
    return () => { delete window.betterNotepadResume; };
  }, []);
  useEffect(() => { if (!saveError && !imageBusy) window.BetterNotepad?.ready?.(); }, [saveError, imageBusy]);
  useEffect(() => { if (confirmReload) reloadDialog.current?.showModal(); else reloadDialog.current?.close(); }, [confirmReload]);

  if (initial.error) return <main className="load-error">
    <Icon name="note" size={40} /><h1>便签暂时无法读取</h1>
    <p>为了保护你的内容，没有覆盖原来的数据。</p><p className="error-detail">{initial.error}</p>
    <button className="primary" onClick={() => location.reload()}>重新读取</button>
  </main>;

  return <div className={`app ${note ? "editing" : ""}`}>
    {saveError && <div className="error-banner" role="alert"><span>尚未保存：{saveError}</span>{!syncFailed && <button onClick={() => commit(data)}>重试保存</button>}<button onClick={() => setConfirmReload(true)}>重新读取</button></div>}
    {imageError && <div className="error-banner" role="alert"><span>{imageError}</span><button aria-label="关闭图片提示" onClick={() => setImageError("")}><Icon name="close" size={16} /></button></div>}
    {!note ? page === "settings" ? <Settings ref={settings} data={data} onCommit={next => commit(next, false)} onRestored={next => { setData(next); setSaveError(""); }} canBackup={!saveError} onBack={() => setPage("home")} onSave={home => {
      if (commit({ ...data, home })) setPage("home");
    }} /> : <main className={searching ? "search-page" : "home"}>
      {searching ? <>
        <header className="search-bar"><button className="icon-button back-button" aria-label="返回便签主页" onClick={() => { finishSelection(); setPage("home"); }}><Icon name="back" /></button>
          <label className="search-box"><Icon name="search" /><input ref={searchField} autoFocus aria-label="搜索便签" placeholder="搜索标题或正文" value={query} onChange={event => { setQuery(event.target.value); setSelectedIds([]); }} />{query && <button aria-label="清空搜索" onClick={() => { setQuery(""); setSelectedIds([]); searchField.current?.focus(); }}><Icon name="close" size={17} /></button>}</label>
        </header>
        <p className="search-summary" role="status">{query.trim() ? "找到" : "共有"} {notes.length} 篇便签 · 搜索标题、正文、标签和待办</p>
      </> : <>
      <header className="brand-bar"><div className="brand"><span className="brand-icon"><Icon name="note" size={20} /></span><span>BetterNotepad</span></div><div className="home-actions">
        <button className="icon-button theme-button" aria-label="搜索便签" onClick={() => { finishSelection(); finishSorting(); setQuery(""); setPage("search"); }}><Icon name="search" /></button>
        <button className="icon-button theme-button" aria-label="打开设置" onClick={() => { finishSelection(); finishSorting(); setPage("settings"); }}><Icon name="settings" /></button>
        <button className="icon-button theme-button" aria-label={`切换主题，当前${themeNames[data.theme]}`} onClick={() => commit({ ...data, theme: THEMES[(THEMES.indexOf(data.theme) + 1) % THEMES.length] as Theme })}><Icon name={data.theme === "dark" ? "moon" : data.theme === "light" ? "sun" : "palette"} /></button>
      </div></header>
      <section className="home-heading">
        <h1>{home.title}</h1>
        {home.subtitle && <p>{home.subtitle}</p>}
      </section>
      <nav className="filters" aria-label="便签筛选"><button className={!pinnedOnly ? "selected" : ""} aria-pressed={!pinnedOnly} onClick={() => { finishSorting(); setPinnedOnly(false); setSelectedIds([]); }}>全部便签 <span>{data.notes.length}</span></button><button className={pinnedOnly ? "selected" : ""} aria-pressed={pinnedOnly} aria-label="只看已置顶便签" onClick={() => { finishSorting(); setPinnedOnly(true); setSelectedIds([]); }}><Icon name="pin" size={15} /><span>{data.notes.filter(item => item.pinned).length}</span></button>
        {tags.length > 0 && <label className="tag-filter"><Icon name="tag" size={14} /><select aria-label="按标签筛选便签" value={tagFilter} onChange={event => { finishSorting(); setTagFilter(event.target.value); setSelectedIds([]); }}><option value="all">全部标签</option><option value="none">未分类</option>{tags.map(tag => <option key={tag} value={`tag:${tag}`}>{tag}</option>)}</select></label>}
      </nav>
      </>}
      {selecting ? <div className="selection-toolbar" aria-label="批量选择操作">
        <button aria-label="退出批量选择" onClick={finishSelection}>完成</button>
        <span className="selection-count" role="status">已选 {selectedIds.length} 篇</span>
        <button aria-label={allSelected ? "取消全选当前列表" : "全选当前列表"} aria-pressed={allSelected} disabled={!notes.length} onClick={() => setSelectedIds(allSelected ? [] : notes.map(item => item.id))}>{allSelected ? "取消全选" : "全选列表"}</button>
        <button className="danger" aria-label={`删除选中的便签，共 ${selectedIds.length} 篇`} disabled={!selectedIds.length} onClick={() => requestDelete(selectedIds)}><Icon name="trash" size={15} />删除</button>
      </div> : notes.length > 0 && <div className="list-actions">
        {!searching && <button className="note-sort-button" aria-label="排列便签" aria-pressed={sorting} disabled={!sorting && !canReorder} onClick={() => { finishSelection(); setSorting(!sorting); }}><Icon name={sorting ? "check" : "sort"} size={17} />{sorting ? "完成排列" : "排列"}</button>}
        {!sorting && <button aria-label="批量删除便签" title="批量删除便签" onClick={() => { finishSorting(); setSelecting(true); }}><Icon name="trash" size={15} /></button>}
      </div>}
      {notes.length ? <NoteGrid key={`${searching ? "search" : "home"}:${pinnedOnly}:${tagFilter}:${sorting}`} notes={notes} sorting={sorting} selecting={selecting} selected={selected} onClick={id => selecting ? toggleSelection(id) : open(id)} onSwap={reorder} /> : <section className="empty-state">
        <div className="paper-stack"><span /><span /><div><Icon name="note" size={38} /><i /><i /><i /></div></div>
        <h2>{searching ? query.trim() ? "没有找到这篇便签" : "还没有可搜索的便签" : tagFilter !== "all" ? "这个分类里还没有便签" : pinnedOnly ? "重要的想法，放在前面" : "第一篇，从一个想法开始"}</h2>
        <p>{searching ? "试试其他关键词，标题、正文、标签和待办都可以搜索。" : tagFilter !== "all" ? "试试其他标签，或在便签编辑页调整标签。" : pinnedOnly ? "在编辑页点击图钉，就能在这里找到它。" : "一段文字、一份清单，或今天的小小灵感。"}</p>
        {!searching && !pinnedOnly && !selecting && <button className="text-button" onClick={create}>写一篇便签 <Icon name="arrow" size={17} /></button>}
      </section>}
      {!searching && <>
      {!selecting && !sorting && <button className="new-note" onClick={create} aria-label="新建便签"><span className="new-note-icon"><Icon name="plus" size={23} /></span><span>写一篇便签</span></button>}
      </>}
    </main> : <main className={`note-page${note.todos?.length ? " has-todos" : ""}`}>
      <header className="editor-bar"><button className="icon-button back-button" aria-label={searching ? "返回搜索结果" : "返回便签主页"} onClick={() => setActiveId(null)}><Icon name="back" /></button><span className={`save-status ${saveError ? "failed" : ""}`} role="status" aria-label={saveError ? "尚未保存" : "已保存到本机"}><Icon name={saveError ? "close" : "check"} size={14} />{saveError ? "尚未保存" : ""}</span><div className="editor-actions"><button className={`icon-button pin-button ${note.pinned ? "is-pinned" : ""}`} aria-label={note.pinned ? "取消置顶" : "置顶便签"} aria-pressed={note.pinned} onClick={() => edit({ pinned: !note.pinned })}><Icon name="pin" /></button><button className="icon-button delete-button" aria-label="删除便签" onClick={() => requestDelete([note.id])}><Icon name="trash" /></button></div></header>
      <div className="note-title"><input aria-label="便签标题" placeholder="无标题便签" value={note.title} onChange={event => edit({ title: event.target.value })} /><div className="note-meta"><time>{dateLabel(note.createdAt)} 创建</time><span>·</span><span>{Array.from(bodyText(note.content)).length} 字{imageBlocks(note.content).length > 0 && ` · ${imageBlocks(note.content).length} 张图片`}</span></div>
        {!!note.tags?.length && <section className="note-tags" aria-label="便签标签">{note.tags.map(tag => <button key={tag} aria-label={`修改便签标签：${tag}`} onClick={() => setEditingTags(true)}>{tag}</button>)}</section>}
      </div>
      <div className="editor-tools">
        <button className="icon-button" aria-label="管理便签标签" title="标签" onClick={() => setEditingTags(true)}><Icon name="tag" size={18} /></button>
        <button className="icon-button" aria-label="添加待办清单事项" title="添加待办" onClick={addTodo}><Icon name="checklist" size={19} /></button>
        <button className="icon-button insert-image" aria-label={imageBusy ? "正在读取图片" : "插入图片"} aria-busy={imageBusy} title="插入图片" disabled={imageBusy} onClick={insertImage}><Icon name="plus" size={18} /></button>
      </div>
      <div className="editor-pane">
        {!!note.todos?.length && <Checklist key={`todos-${note.id}`} todos={note.todos} focusId={focusTodo} onAdd={addTodo} onChange={todos => edit({ todos })} />}
        <Editor ref={editor} key={`${note.id}-${editorVersion}`} content={note.content} onChange={content => edit({ content })} onViewImage={path => { if (isImagePath(path)) setViewImage(path); }} />
      </div>
      <footer className="editor-footer"><span className="editor-format"><Icon name="note" size={13} />文字 · 图片</span></footer>
    </main>}
    {note && editingTags && <TagEditor tags={note.tags ?? []} available={tags} saveError={saveError} onChange={tags => edit({ tags })} onClose={() => setEditingTags(false)} />}
    {viewImage && <ImageViewer key={viewImage} path={viewImage} onClose={() => setViewImage(null)} />}
    {confirmReload && <dialog ref={reloadDialog} className="confirm-dialog" aria-labelledby="reload-title" onCancel={event => { event.preventDefault(); setConfirmReload(false); }}>
      <h2 id="reload-title">重新读取本机便签？</h2><p>会放弃当前尚未保存的修改，使用最新保存的便签与桌面待办状态。本机文件不会被改动；如需保留草稿，请先取消并复制文字。</p>
      {confirmReload && saveError && <p className="delete-error">{saveError}</p>}
      <div><button autoFocus onClick={() => setConfirmReload(false)}>保留当前草稿</button><button onClick={reloadNotebook}>确认重新读取</button></div>
    </dialog>}
    <dialog ref={dialog} className="confirm-dialog" onCancel={event => { event.preventDefault(); setConfirmDelete(null); }} aria-labelledby="delete-title" aria-describedby="delete-description"><span className="dialog-icon"><Icon name="trash" size={24} /></span><h2 id="delete-title">{deletingNotes.length > 1 ? `删除这 ${deletingNotes.length} 篇便签？` : "删除这篇便签？"}</h2><p id="delete-description">{deletingNotes.length > 1 ? `选中的 ${deletingNotes.length} 篇便签` : `“${deletingNotes[0] ? displayTitle(deletingNotes[0]) : ""}”`} 将移入回收站，可在设置中恢复。</p>{confirmDelete && deleteFailed && <p className="delete-error" role="alert">删除未成功，便签仍然保留。请重试确认删除。</p>}<div><button autoFocus onClick={() => setConfirmDelete(null)}>保留便签</button><button className="danger" onClick={removeConfirmed}>确认删除</button></div></dialog>
  </div>;
}
