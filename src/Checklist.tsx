import { useEffect, useRef } from "react";
import type { Todo } from "./types";
import Icon from "./Icon";

export default function Checklist({ todos, focusId, onChange, onAdd }: {
  todos: Todo[]; focusId: string | null; onChange: (todos: Todo[]) => void; onAdd: () => void;
}) {
  const focus = useRef<HTMLInputElement | null>(null);
  useEffect(() => { focus.current?.focus(); }, [focusId]);
  return <section className="checklist" aria-label="待办清单">
    <header><h2>待办清单</h2><span role="status">{todos.filter(item => item.done).length} / {todos.length} 完成</span><button className="icon-button" aria-label="添加待办事项" onClick={onAdd}><Icon name="plus" size={17} /></button></header>
    {todos.map((item, index) => <div key={item.id} className={`todo-row${item.done ? " done" : ""}`}>
      <label className="todo-check"><input type="checkbox" aria-label={`${item.done ? "取消完成" : "完成"}待办：${item.text || `第 ${index + 1} 项`}`} checked={item.done} onChange={event => onChange(todos.map(todo => todo.id === item.id ? { ...todo, done: event.target.checked } : todo))} /><span aria-hidden="true"><Icon name="check" size={15} /></span></label>
      <input className="todo-text" ref={element => { if (item.id === focusId) focus.current = element; }} aria-label={`待办事项 ${index + 1}`} placeholder="输入待办事项" value={item.text} onChange={event => onChange(todos.map(todo => todo.id === item.id ? { ...todo, text: event.target.value } : todo))} onKeyDown={event => {
        if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); onAdd(); }
      }} />
      <button className="icon-button" aria-label={`删除待办：${item.text || `第 ${index + 1} 项`}`} onClick={() => onChange(todos.filter(todo => todo.id !== item.id))}><Icon name="close" size={15} /></button>
    </div>)}
  </section>;
}
