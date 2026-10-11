import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { DEFAULT_HOME, displayTitle, loadState, parseState, restoreNotebook, restoreTrash } from "./notes.mjs";
import { bodyText, firstImage } from "./images.mjs";
import type { BackupResult, HomeSettings, Notebook } from "./types";
import Icon from "./Icon";
import UpdateSettings from "./UpdateSettings";

export interface SettingsHandle { back(): boolean; syncBlocked(): boolean }
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");

const Settings = forwardRef<SettingsHandle, {
  data: Notebook; onSave: (settings: HomeSettings) => void; onCommit: (data: Notebook) => boolean;
  onRestored: (data: Notebook) => void; canBackup: boolean; onBack: () => void;
}>(function Settings({ data, onSave, onCommit, onRestored, canBackup, onBack }, ref) {
  const [title, setTitle] = useState((data.home ?? DEFAULT_HOME).title);
  const [subtitle, setSubtitle] = useState((data.home ?? DEFAULT_HOME).subtitle);
  const [inTrash, setInTrash] = useState(false);
  const [erase, setErase] = useState<string[] | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<{ data: Notebook; info: BackupResult } | null>(null);
  const [replace, setReplace] = useState(false);
  const [reloadNeeded, setReloadNeeded] = useState(false);
  const pending = useRef<string | null>(null);
  const confirmation = useRef<HTMLDialogElement>(null);
  const restoreDialog = useRef<HTMLDialogElement>(null);
  const trash = [...(data.trash ?? [])].sort((a, b) => b.deletedAt - a.deletedAt);

  function discard() {
    if (pending.current) window.BetterNotepad?.discardBackup?.(pending.current);
    pending.current = null;
    setPreview(null); setReplace(false); setError("");
  }
  function back() {
    if (busy) return true; // Keep the page mounted until native I/O completes.
    if (erase) { setErase(null); setError(""); return true; }
    if (preview) { discard(); return true; }
    if (inTrash) { setInTrash(false); setError(""); return true; }
    return false;
  }
  useImperativeHandle(ref, () => ({ back, syncBlocked: () => !!busy || !!preview }));
  useEffect(() => {
    if (erase) confirmation.current?.showModal(); else confirmation.current?.close();
  }, [erase]);
  useEffect(() => {
    if (preview) restoreDialog.current?.showModal(); else restoreDialog.current?.close();
  }, [preview]);
  useEffect(() => { if (!busy && !preview) window.BetterNotepad?.ready?.(); }, [busy, preview]);

  useEffect(() => {
    window.betterNotepadBackupResult = result => {
      if (result.requestId !== pending.current) return;
      setBusy("");
      if (result.error || result.cancelled) {
        setError(result.error ?? ""); setMessage(result.cancelled ? "已取消，原内容未改动。" : "");
        // Keep a failed restore preview available for retry.
        if (!preview) { window.BetterNotepad?.discardBackup?.(result.requestId); pending.current = null; }
        return;
      }
      try {
        if (result.phase === "preview") {
          const staged = JSON.parse(window.BetterNotepad!.readBackup!(result.requestId));
          if (!staged.ok) throw new Error(staged.error);
          // The desktop can change tasks while the system picker is open.
          // Merge against the latest local notebook, never the pre-picker view.
          onRestored(loadState(window.localStorage, window.BetterNotepad) as Notebook);
          setPreview({ data: parseState(staged.data) as Notebook, info: result });
        } else if (result.phase === "restored") {
          const restored = loadState(window.localStorage, window.BetterNotepad) as Notebook;
          onRestored(restored);
          setTitle((restored.home ?? DEFAULT_HOME).title); setSubtitle((restored.home ?? DEFAULT_HOME).subtitle);
          setPreview(null); setReplace(false); pending.current = null;
          setMessage("恢复完成，便签和图片已保存到本机。"); setError("");
        } else if (result.phase === "exported") {
          pending.current = null; setMessage("备份已导出到你选择的位置。");
        }
      } catch (error) {
        setError(String(error));
        if (result.phase === "restored") {
          // Never allow an old in-memory notebook to overwrite a completed restore.
          setBusy("恢复已写入，请重新读取内容后继续使用。"); setReloadNeeded(true);
        } else {
          window.BetterNotepad?.discardBackup?.(result.requestId); pending.current = null; setPreview(null);
        }
      }
    };
    return () => { delete window.betterNotepadBackupResult; };
  });
  useEffect(() => () => {
    if (pending.current) window.BetterNotepad?.discardBackup?.(pending.current);
  }, []);

  function backup(action: "export" | "open") {
    setError(""); setMessage("");
    const native = window.BetterNotepad;
    if (!native?.exportBackup || !native.openBackup || !native.readBackup || !native.restoreBackup) {
      setError("请在 Android 应用中备份或恢复，浏览器预览不支持本机文件。"); return;
    }
    const id = newId(); pending.current = id;
    setBusy(action === "export" ? "请选择备份保存位置，完成后请稍候…" : "请选择 BetterNotepad 备份文件，读取时请稍候…");
    try { if (action === "export") native.exportBackup(id); else native.openBackup(id); }
    catch { pending.current = null; setBusy(""); setError("无法打开文件选择器，请重试。"); }
  }
  function restore(mode: "merge" | "replace") {
    if (!preview || !pending.current || busy) return;
    setError(""); setBusy("正在恢复便签和图片，请勿退出应用…");
    try {
      const next = restoreNotebook(data, preview.data, mode, newId) as Notebook;
      window.BetterNotepad!.restoreBackup!(pending.current, JSON.stringify(next));
    } catch (error) { setBusy(""); setError(String(error)); }
  }
  function permanentlyDelete() {
    if (!erase) return;
    const ids = new Set(erase);
    if (onCommit({ ...data, trash: (data.trash ?? []).filter(note => !ids.has(note.id)) })) {
      setErase(null); setError(""); setMessage("已彻底删除。");
    } else setError("未能彻底删除，回收站内容仍然保留，请重试。");
  }

  return <main className="settings-page">
    <header className="page-bar"><button className="icon-button back-button" aria-label={inTrash ? "返回设置" : "返回便签主页"} disabled={!!busy} onClick={() => { if (!back()) onBack(); }}><Icon name="back" /></button><h1>{inTrash ? "回收站" : "设置"}</h1></header>
    {busy && <p className="data-message" role="status" aria-live="polite">{busy}</p>}
    {reloadNeeded && <button className="primary" onClick={() => location.reload()}>重新读取恢复内容</button>}
    {message && <p className="data-message" role="status">{message}</p>}
    {error && !erase && !preview && <p className="data-error" role="alert">{error}</p>}
    {inTrash ? <>
      <section className="settings-card"><h2>{trash.length} 篇已删除便签</h2><p>不会自动清理。恢复时保留正文、图片和置顶状态；彻底删除后无法撤销。</p>
        {trash.length > 0 && <button className="data-button danger" onClick={() => { setError(""); setErase(trash.map(note => note.id)); }}>清空回收站</button>}
      </section>
      {trash.length ? <section className="trash-list" aria-label="回收站便签">{trash.map(note => <article className="trash-card" key={note.id}>
        {firstImage(note.content) && <img src={firstImage(note.content)} alt="已删除便签的图片" loading="lazy" />}
        <h2>{displayTitle(note)}</h2><p>{bodyText(note.content).trim() || note.todos?.filter(todo => todo.text.trim()).slice(0, 3).map(todo => `${todo.done ? "✓" : "○"} ${todo.text}`).join("\n") || (firstImage(note.content) ? "图片便签" : "没有正文")}</p>
        <time>{new Date(note.deletedAt).toLocaleString("zh-CN")} 删除</time>
        <div><button className="data-button" aria-label={`恢复便签：${displayTitle(note)}`} onClick={() => {
          if (onCommit(restoreTrash(data, note.id) as Notebook)) { setError(""); setMessage("便签已恢复到主页。"); }
          else setError("恢复未成功，便签仍在回收站，请重试。");
        }}>恢复</button><button className="data-button danger" aria-label={`彻底删除便签：${displayTitle(note)}`} onClick={() => { setError(""); setErase([note.id]); }}>彻底删除</button></div>
      </article>)}</section> : <p className="data-empty">回收站是空的。删除的便签会先保留在这里。</p>}
    </> : <fieldset className="settings-sections" disabled={!!busy}>
      <UpdateSettings canInstall={canBackup} />
      <section className="settings-card"><h2>桌面小组件</h2><p>选择一篇便签放在桌面，查看正文、图片和勾选待办。可添加多个，每个显示不同便签；在小组件上点齿轮可更换便签。</p>
        <button className="data-button" disabled={!canBackup} onClick={() => {
          setError(""); setMessage("");
          if (!window.BetterNotepad?.configureWidget) { setError("请在 Android 应用中添加桌面小组件。"); return; }
          try { window.BetterNotepad.configureWidget(); } catch { setError("无法打开小组件设置，请重试。"); }
        }}>添加桌面小组件</button>
        <small>也可长按桌面空白处，从小组件列表添加 BetterNotepad。小米桌面请找「支持小部件应用 → 全部 → 安卓小部件」，不是小米小部件商店。应用内请求不等于添加成功，请在桌面确认。</small>
      </section>
      <section className="settings-card"><h2>备份与恢复</h2><p>将便签、正文图片、回收站和已保存的设置打包为 ZIP。请保存到应用外，卸载或清除应用数据后仍可用它恢复。备份未加密，请妥善保管。</p>
        <div className="data-actions"><button className="data-button" disabled={!canBackup} onClick={() => backup("export")}>导出备份</button><button className="data-button" disabled={!canBackup} onClick={() => backup("open")}>从备份恢复</button></div>
        {!canBackup && <p className="data-error">请先重试保存未保存的内容，再进行备份或恢复。</p>}
      </section>
      <button className="settings-card settings-link" aria-label="打开回收站" onClick={() => { setInTrash(true); setMessage(""); setError(""); }}><Icon name="trash" /><span><strong>回收站</strong><small>{trash.length} 篇便签 · 恢复或彻底删除</small></span><Icon name="arrow" size={18} /></button>
      <form className="settings-card" onSubmit={event => {
        event.preventDefault(); onSave({ title: title.trim() || DEFAULT_HOME.title, subtitle: subtitle.trim() });
      }}>
        <h2>主页文案</h2><p>修改标题和副标题，保存后在主页显示。</p>
        <label>主页标题<input aria-label="主页标题" value={title} maxLength={40} placeholder={DEFAULT_HOME.title} onChange={event => setTitle(event.target.value)} /><small>最多 40 个字符，留空使用默认标题。</small></label>
        <label>主页副标题<input aria-label="主页副标题" value={subtitle} maxLength={80} placeholder={DEFAULT_HOME.subtitle} onChange={event => setSubtitle(event.target.value)} /><small>最多 80 个字符，留空则不显示副标题。</small></label>
        <button className="primary" type="submit">保存设置</button>
      </form>
    </fieldset>}
    <dialog ref={confirmation} className="confirm-dialog" aria-labelledby="erase-title" onCancel={event => { event.preventDefault(); setErase(null); setError(""); }}>
      <h2 id="erase-title">彻底删除 {erase?.length ?? 0} 篇便签？</h2><p>便签和仅由它们使用的图片将被移除，此操作无法撤销。已有的外部备份不受影响。</p>
      {erase && error && <p className="delete-error" role="alert">{error}</p>}
      <div><button autoFocus onClick={() => { setErase(null); setError(""); }}>保留便签</button><button className="danger" onClick={permanentlyDelete}>确认彻底删除</button></div>
    </dialog>
    <dialog ref={restoreDialog} className="confirm-dialog" aria-labelledby="restore-title" onCancel={event => { event.preventDefault(); if (!busy) discard(); }}>
      <h2 id="restore-title">{replace ? "确认替换本机内容？" : "恢复备份"}</h2>
      {preview && <><p>备份时间：{new Date(preview.info.createdAt!).toLocaleString("zh-CN")}<br />{preview.info.notes} 篇便签 · {preview.info.trash} 篇回收站便签 · {preview.info.images} 张图片</p>
        <p>{replace ? "将替换当前全部便签、回收站和设置，无法撤销。建议先取消并导出本机备份。" : "合并保留本机内容和设置，ID 冲突的便签保存为新副本；替换则完全使用备份中的内容和设置。"}</p></>}
      {preview && error && <p className="delete-error" role="alert">{error}</p>}
      {busy && <p role="status">{busy}</p>}
      {reloadNeeded && <button onClick={() => location.reload()}>重新读取恢复内容</button>}
      <div><button autoFocus disabled={!!busy} onClick={discard}>取消恢复</button>{replace ? <button className="danger" disabled={!!busy} onClick={() => restore("replace")}>确认替换</button> : <button disabled={!!busy} onClick={() => restore("merge")}>合并恢复</button>}</div>
      {!replace && <button className="replace-backup" disabled={!!busy} onClick={() => { setReplace(true); setError(""); }}>改为替换本机内容</button>}
    </dialog>
  </main>;
});
export default Settings;
