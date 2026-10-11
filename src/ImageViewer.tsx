import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import Icon from "./Icon";

type Point = { x: number; y: number };
type Transform = Point & { scale: number };
const fit: Transform = { scale: 1, x: 0, y: 0 };
const clamp = (value: number, limit: number) => Math.max(-limit, Math.min(limit, value));

export default function ImageViewer({ path, onClose }: { path: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const [transform, setTransform] = useState(fit);
  const current = useRef(fit);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<{ center: Point; distance: number; transform: Transform } | null>(null);
  const start = useRef<Point | null>(null);
  const moved = useRef(false);
  const lastTap = useRef<{ time: number; point: Point } | null>(null);

  function apply(value: Transform) {
    const scale = Math.max(1, Math.min(4, value.scale));
    const xLimit = Math.max(0, ((image.current?.clientWidth ?? 0) * scale - (viewport.current?.clientWidth ?? 0)) / 2);
    const yLimit = Math.max(0, ((image.current?.clientHeight ?? 0) * scale - (viewport.current?.clientHeight ?? 0)) / 2);
    const next = { scale, x: clamp(value.x, xLimit), y: clamp(value.y, yLimit) };
    current.current = next; setTransform(next);
  }
  function zoom(scale: number, point?: Point) {
    const previous = current.current;
    const rect = viewport.current!.getBoundingClientRect();
    const x = point ? point.x - rect.left - rect.width / 2 : 0;
    const y = point ? point.y - rect.top - rect.height / 2 : 0;
    const bounded = Math.max(1, Math.min(4, scale)), ratio = bounded / previous.scale;
    apply({ scale: bounded, x: x - (x - previous.x) * ratio, y: y - (y - previous.y) * ratio });
    resetGesture();
  }
  function positions() {
    const values = [...pointers.current.values()];
    const a = values[0], b = values[1];
    return a ? { center: b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : a,
      distance: b ? Math.hypot(a.x - b.x, a.y - b.y) : 0 } : null;
  }
  function resetGesture() {
    const position = positions();
    gesture.current = position ? { ...position, transform: current.current } : null;
  }
  function down(event: PointerEvent<HTMLDivElement>) {
    if (!loaded || event.button > 0 || pointers.current.size >= 2) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = { x: event.clientX, y: event.clientY };
    if (!pointers.current.size) { start.current = point; moved.current = false; }
    else moved.current = true;
    pointers.current.set(event.pointerId, point); resetGesture();
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId) || !gesture.current) return;
    const point = { x: event.clientX, y: event.clientY };
    if (start.current && Math.hypot(point.x - start.current.x, point.y - start.current.y) > 6) moved.current = true;
    pointers.current.set(event.pointerId, point);
    const position = positions()!, base = gesture.current;
    const scale = Math.max(1, Math.min(4, base.transform.scale * (base.distance > 0 ? position.distance / base.distance : 1)));
    const rect = viewport.current!.getBoundingClientRect(), ratio = scale / base.transform.scale;
    apply({ scale,
      x: position.center.x - rect.left - rect.width / 2 - (base.center.x - rect.left - rect.width / 2 - base.transform.x) * ratio,
      y: position.center.y - rect.top - rect.height / 2 - (base.center.y - rect.top - rect.height / 2 - base.transform.y) * ratio });
  }
  function up(event: PointerEvent<HTMLDivElement>, cancelled = false) {
    if (!pointers.current.delete(event.pointerId)) return;
    if (!cancelled && !pointers.current.size && !moved.current) {
      const now = Date.now(), point = { x: event.clientX, y: event.clientY }, previous = lastTap.current;
      if (previous && now - previous.time < 300 && Math.hypot(previous.point.x - point.x, previous.point.y - point.y) < 25) {
        zoom(current.current.scale > 1 ? 1 : 2, point); lastTap.current = null;
      } else lastTap.current = { time: now, point };
    } else lastTap.current = null;
    resetGesture();
  }
  useEffect(() => {
    const element = dialog.current!; element.showModal();
    const resize = () => { pointers.current.clear(); gesture.current = null; lastTap.current = null; apply(fit); };
    window.addEventListener("resize", resize);
    return () => { element.close(); window.removeEventListener("resize", resize); };
  }, []);

  return <dialog ref={dialog} className="image-viewer" aria-label="图片大图查看" onCancel={event => { event.preventDefault(); onClose(); }}>
    <header><span>图片</span><button autoFocus className="icon-button" aria-label="关闭大图" onClick={onClose}><Icon name="close" /></button></header>
    <div className="image-viewport" ref={viewport} onPointerDown={down} onPointerMove={move} onPointerUp={event => up(event)} onPointerCancel={event => up(event, true)} onLostPointerCapture={event => up(event, true)}>
      <img ref={image} src={path} alt="便签图片大图" draggable={false} style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`, visibility: loaded ? "visible" : "hidden" }} onLoad={() => { setLoaded(true); apply(current.current); }} onError={() => { setError(true); setLoaded(false); }} />
      {!loaded && <p role={error ? "alert" : "status"}>{error ? "图片暂时无法读取，请关闭后重试。" : "正在读取图片…"}</p>}
    </div>
    <footer><button className="icon-button" aria-label="缩小图片" disabled={!loaded || transform.scale <= 1} onClick={() => zoom(current.current.scale - .5)}><Icon name="minus" /></button><span role="status">{Math.round(transform.scale * 100)}%</span><button className="icon-button" aria-label="放大图片" disabled={!loaded || transform.scale >= 4} onClick={() => zoom(current.current.scale + .5)}><Icon name="plus" /></button><button disabled={!loaded} onClick={() => { apply(fit); resetGesture(); }}>适应屏幕</button></footer>
    <p className="image-gesture-hint">双指缩放 · 放大后拖动 · 双击放大或复原</p>
  </dialog>;
}
