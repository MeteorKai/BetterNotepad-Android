import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";

export default function TagEditor({ tags, available, saveError, onChange, onClose }: {
  tags: string[]; available: string[]; saveError: string; onChange: (tags: string[]) => void; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    const element = dialog.current!; element.showModal();
    return () => element.close();
  }, []);
  function add(value: string) {
    const label = value.trim();
    if (!label || label.length > 20 || /[\u0000-\u001f\u007f]/.test(label)) { setError("请输入 1–20 个字符的标签。"); return; }
    if (tags.includes(label)) { setError("这个标签已经添加了。"); return; }
    if (tags.length >= 8) { setError("每篇便签最多添加 8 个标签。"); return; }
    onChange([...tags, label]); setText(""); setError("");
  }
  return <dialog ref={dialog} className="confirm-dialog tag-dialog" aria-labelledby="tag-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <h2 id="tag-title">便签标签</h2><p>点击已有标签即可添加，也可以输入新标签。修改后自动保存。</p>
    <section className="tag-chips" aria-label="当前便签标签">{tags.map(tag => <button key={tag} aria-label={`移除标签：${tag}`} onClick={() => { onChange(tags.filter(item => item !== tag)); setError(""); }}>{tag}<Icon name="close" size={13} /></button>)}</section>
    <form className="tag-form" onSubmit={event => { event.preventDefault(); add(text); }}>
      <input aria-label="新标签" placeholder="例如：工作、生活、学习" maxLength={20} value={text} onChange={event => setText(event.target.value)} />
      <button type="submit">添加</button>
    </form>
    {error && <p className="delete-error" role="alert">{error}</p>}
    {saveError && <p className="delete-error" role="alert">标签修改尚未保存，请点完成后重试保存。</p>}
    {available.some(tag => !tags.includes(tag)) && <section className="tag-suggestions"><h3>已有标签</h3><section className="tag-chips">{available.filter(tag => !tags.includes(tag)).map(tag => <button key={tag} aria-label={`添加标签：${tag}`} onClick={() => add(tag)}>{tag}</button>)}</section></section>}
    <div><button autoFocus onClick={onClose}>完成</button></div>
  </dialog>;
}
