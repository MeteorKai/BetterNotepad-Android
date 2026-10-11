import { useEffect, useRef, useState } from "react";
import { displayTitle } from "./notes.mjs";
import { bodyText, firstImage } from "./images.mjs";
import type { Note } from "./types";
import Icon from "./Icon";

type Point = { clientX: number; clientY: number };
type Drag = { source: string; target: string | null; x: number; y: number };
const dateLabel = (time: number) => new Date(time).toLocaleDateString("zh-CN", { month: "short", day: "numeric" });

export default function NoteGrid({ notes, sorting, selecting, selected, onClick, onSwap }: {
  notes: Note[]; sorting: boolean; selecting: boolean; selected: Set<string>;
  onClick: (id: string) => void; onSwap: (source: string, target: string) => void;
}) {
  const list = useRef<HTMLElement>(null);
  const latest = useRef({ notes, onSwap }); latest.current = { notes, onSwap };
  const suppressClick = useRef(0);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedNote = notes.find(note => note.id === selectedId) ?? notes[0];
  const group = notes.filter(note => note.pinned === selectedNote?.pinned);
  const index = group.findIndex(note => note.id === selectedNote?.id);
  function shift(offset: number) {
    const target = group[index + offset];
    if (selectedNote && target) onSwap(selectedNote.id, target.id);
  }

  useEffect(() => {
    if (!sorting) return;
    const element = list.current!;
    let width = window.innerWidth, frame = 0;
    let position: Point = { clientX: 0, clientY: 0 };
    let gesture: { kind: "touch" | "pointer"; id: number; source: string; button: HTMLButtonElement; snapshot: Pick<Note, "id" | "pinned">[] } | null = null;
    const unchanged = (snapshot: Pick<Note, "id" | "pinned">[]) => snapshot.length === latest.current.notes.length && snapshot.every((note, i) => latest.current.notes[i].id === note.id && latest.current.notes[i].pinned === note.pinned);
    function cardAt(target: EventTarget | null) {
      const button = target instanceof window.Element ? target.closest<HTMLButtonElement>("button[data-note-id]") : null;
      return button && element.contains(button) ? button : null;
    }
    function targetAt(point: Point) {
      const id = cardAt(document.elementFromPoint(point.clientX, point.clientY))?.dataset.noteId;
      const source = latest.current.notes.find(note => note.id === gesture?.source), target = latest.current.notes.find(note => note.id === id);
      return source && target && source.pinned === target.pinned ? target.id : null;
    }
    function cancel() {
      const ended = gesture; gesture = null;
      window.cancelAnimationFrame(frame);
      if (ended) suppressClick.current = Date.now() + 700;
      if (ended?.kind === "pointer" && ended.button.hasPointerCapture?.(ended.id)) ended.button.releasePointerCapture(ended.id);
      setDrag(null);
    }
    function scroll() {
      if (!gesture) return;
      if (!unchanged(gesture.snapshot)) { cancel(); return; }
      const delta = position.clientY < 64 ? -12 : position.clientY > window.innerHeight - 64 ? 12 : 0;
      if (delta) {
        const before = window.scrollY; window.scrollBy(0, delta);
        if (before !== window.scrollY) setDrag({ source: gesture.source, target: targetAt(position), x: position.clientX, y: position.clientY });
      }
      frame = window.requestAnimationFrame(scroll);
    }
    function begin(kind: "touch" | "pointer", id: number, point: Point, event: Event) {
      const handle = event.target instanceof window.Element ? event.target.closest("[data-note-handle]") : null;
      const button = handle && cardAt(handle);
      if (!button || latest.current.notes.length < 2) return;
      cancel(); suppressClick.current = 0; position = point;
      const source = button.dataset.noteId!;
      gesture = { kind, id, source, button, snapshot: latest.current.notes.map(({ id, pinned }) => ({ id, pinned })) };
      event.preventDefault();
      setSelectedId(source); setDrag({ source, target: null, x: point.clientX, y: point.clientY });
      // Document tracking also works when a WebView rejects optional capture.
      if (kind === "pointer") { try { button.setPointerCapture?.(id); } catch {} }
      frame = window.requestAnimationFrame(scroll);
    }
    function move(point: Point, event: Event) {
      if (!gesture) return;
      if (!unchanged(gesture.snapshot)) { cancel(); return; }
      event.preventDefault(); position = point;
      setDrag({ source: gesture.source, target: targetAt(point), x: point.clientX, y: point.clientY });
    }
    function finish(point: Point, event: Event) {
      const ended = gesture, target = ended && targetAt(point);
      if (ended) event.preventDefault();
      cancel();
      if (ended && target && target !== ended.source && unchanged(ended.snapshot)) latest.current.onSwap(ended.source, target);
    }
    function touchStart(event: TouchEvent) {
      if (event.touches.length !== 1) { cancel(); return; }
      if (gesture?.kind === "pointer") { event.preventDefault(); return; }
      const touch = event.touches[0]; begin("touch", touch.identifier, touch, event);
    }
    function touchMove(event: TouchEvent) {
      if (gesture?.kind !== "touch") return;
      if (event.touches.length !== 1 || event.touches[0].identifier !== gesture.id) { cancel(); return; }
      move(event.touches[0], event);
    }
    function touchEnd(event: TouchEvent) {
      if (gesture?.kind !== "touch") return;
      const touch = Array.from(event.changedTouches).find(item => item.identifier === gesture!.id);
      if (event.touches.length || !touch) { cancel(); return; }
      finish(touch, event);
    }
    function pointerDown(event: PointerEvent) {
      if (event.isPrimary === false || (gesture?.kind === "pointer" && gesture.id !== event.pointerId)) { cancel(); return; }
      if (gesture?.kind === "touch") return;
      if (event.button === 0) begin("pointer", event.pointerId, event, event);
    }
    function pointerMove(event: PointerEvent) {
      if (gesture?.kind !== "pointer" || gesture.id !== event.pointerId) return;
      if (!event.buttons) cancel(); else move(event, event);
    }
    function pointerUp(event: PointerEvent) { if (gesture?.kind === "pointer" && gesture.id === event.pointerId) finish(event, event); }
    function pointerCancel(event: PointerEvent) { if (gesture?.kind === "pointer" && gesture.id === event.pointerId) cancel(); }
    function touchCancel() { if (gesture?.kind === "touch") cancel(); }
    function resize() { if (width !== window.innerWidth) cancel(); width = window.innerWidth; }
    // The first event stream owns the gesture; duplicate events cannot restart it.
    document.addEventListener("touchstart", touchStart, { passive: false });
    document.addEventListener("touchmove", touchMove, { passive: false });
    document.addEventListener("touchend", touchEnd, { passive: false });
    document.addEventListener("touchcancel", touchCancel);
    document.addEventListener("pointerdown", pointerDown); document.addEventListener("pointermove", pointerMove);
    document.addEventListener("pointerup", pointerUp); document.addEventListener("pointercancel", pointerCancel);
    document.addEventListener("lostpointercapture", pointerCancel);
    window.addEventListener("blur", cancel); window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", cancel);
    return () => {
      const ended = gesture; gesture = null; window.cancelAnimationFrame(frame);
      if (ended?.kind === "pointer" && ended.button.hasPointerCapture?.(ended.id)) ended.button.releasePointerCapture(ended.id);
      document.removeEventListener("touchstart", touchStart); document.removeEventListener("touchmove", touchMove);
      document.removeEventListener("touchend", touchEnd); document.removeEventListener("touchcancel", touchCancel);
      document.removeEventListener("pointerdown", pointerDown); document.removeEventListener("pointermove", pointerMove);
      document.removeEventListener("pointerup", pointerUp); document.removeEventListener("pointercancel", pointerCancel);
      document.removeEventListener("lostpointercapture", pointerCancel);
      window.removeEventListener("blur", cancel); window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", cancel);
    };
  }, [sorting]);

  return <section className="note-list">
    {sorting && <div className="note-order-actions"><p role="status">拖动卡片右上角的三横杠交换位置，或点选后用箭头调整。置顶与普通便签分别排列。</p><div><span>已选：{selectedNote ? displayTitle(selectedNote) : "无"}</span>
      <button type="button" aria-label="将选中便签前移" disabled={index <= 0} onClick={() => shift(-1)}><Icon name="back" size={18} /></button>
      <button type="button" aria-label="将选中便签后移" disabled={index < 0 || index >= group.length - 1} onClick={() => shift(1)}><Icon name="arrow" size={18} /></button>
    </div></div>}
    <section ref={list} className={`notes-grid${sorting ? " is-sorting" : ""}`} aria-label="便签列表" onContextMenu={event => { if (sorting && event.target instanceof window.Element && event.target.closest("[data-note-handle]")) event.preventDefault(); }} onClickCapture={event => {
      if (event.detail && Date.now() < suppressClick.current) { event.preventDefault(); event.stopPropagation(); }
    }}>{notes.map(item => <button type="button" data-note-id={item.id} className={`note-card color-${item.id.charCodeAt(0) % 4}${item.pinned ? " pinned" : ""}${selecting && selected.has(item.id) ? " is-selected" : ""}${sorting && selectedNote?.id === item.id ? " sort-selected" : ""}${drag?.source === item.id ? " note-drag-source" : drag?.target === item.id ? " note-drop-target" : ""}`} key={item.id} onClick={() => sorting ? setSelectedId(item.id) : onClick(item.id)} aria-pressed={sorting ? selectedNote?.id === item.id : selecting ? selected.has(item.id) : undefined} aria-label={`${sorting ? "选择排列便签" : selecting ? selected.has(item.id) ? "取消选择便签" : "选择便签" : "打开便签"}：${displayTitle(item)}${item.pinned ? "，已置顶" : ""}`}>
      <div className="card-top"><span className="format-label"><Icon name="note" size={13} />便签</span><span className="card-badges">{item.pinned && <span className="pin-badge"><Icon name="pin" size={14} /></span>}{selecting && <span className={`selection-mark ${selected.has(item.id) ? "checked" : ""}`} aria-hidden="true">{selected.has(item.id) && <Icon name="check" size={14} />}</span>}{sorting && <span className="note-drag-handle" data-note-handle aria-label={`拖动便签：${displayTitle(item)}`}><Icon name="sort" size={19} /></span>}</span></div>
      <h2>{displayTitle(item)}</h2>
      {firstImage(item.content) && <img className="card-image" src={firstImage(item.content)} alt="便签图片缩略图" loading="lazy" />}
      <p>{bodyText(item.content).trim() || item.todos?.filter(todo => todo.text.trim()).slice(0, 3).map(todo => `${todo.done ? "✓" : "○"} ${todo.text}`).join("\n") || (firstImage(item.content) ? "图片便签" : "还没有内容，点击开始书写…")}</p>
      {!!item.tags?.length && <div className="card-tags">{item.tags.slice(0, 2).map(tag => <span key={tag}>{tag}</span>)}{item.tags.length > 2 && <span>+{item.tags.length - 2}</span>}</div>}
      {!!item.todos?.length && <span className="todo-progress">待办 {item.todos.filter(todo => todo.done).length} / {item.todos.length}</span>}
      <div className="card-bottom"><time dateTime={new Date(item.updatedAt).toISOString()}>{dateLabel(item.updatedAt)}</time><span className="card-open"><Icon name="arrow" size={15} /></span></div>
    </button>)}</section>
    {drag && <span className="note-drag-preview" aria-hidden="true" style={{ left: Math.min(Math.max(8, drag.x - 40), window.innerWidth - 188), top: Math.max(8, drag.y - 70) }}><span>{displayTitle(notes.find(note => note.id === drag.source)!)}</span><small>松手交换便签位置</small></span>}
  </section>;
}
