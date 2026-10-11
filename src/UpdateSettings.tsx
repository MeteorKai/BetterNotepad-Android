import { useEffect, useRef, useState } from "react";
import type { UpdateResult } from "./types";

export default function UpdateSettings({ canInstall }: { canInstall: boolean }) {
  const [info] = useState<{ version: string; repository?: string; configured: boolean } | null>(() => {
    try { return JSON.parse(window.BetterNotepadUpdates?.info() ?? "null"); } catch { return null; }
  });
  const [result, setResult] = useState<UpdateResult>({ phase: "idle", requestId: "" });
  const [release, setRelease] = useState<UpdateResult["release"]>();
  const [ready, setReady] = useState(false);
  const pending = useRef("");
  const busy = ["checking", "downloading", "installing"].includes(result.phase);

  useEffect(() => {
    window.betterNotepadUpdateResult = next => {
      if (next.requestId !== pending.current) return;
      if (next.release) setRelease(next.release);
      if (next.ready !== undefined) setReady(next.ready);
      setResult(next);
    };
    return () => {
      if (pending.current) window.BetterNotepadUpdates?.cancel(pending.current);
      delete window.betterNotepadUpdateResult;
    };
  }, []);

  function run(action: "check" | "download" | "install") {
    if (busy) return;
    const native = window.BetterNotepadUpdates;
    if (!native || !info) { setResult({ phase: "error", requestId: "", message: "请在 Android 应用中检查更新。" }); return; }
    if (!info.configured) { setResult({ phase: "error", requestId: "", message: "更新源尚未配置，提供 GitHub Release 地址后即可启用。" }); return; }
    if (action !== "check" && !canInstall) return;
    const id = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, "0")).join("");
    pending.current = id;
    if (action === "check") { setRelease(undefined); setReady(false); }
    setResult({ requestId: id, phase: action === "check" ? "checking" : action === "download" ? "downloading" : "installing", progress: 0 });
    try { native[action](id); }
    catch { setResult({ requestId: id, phase: "error", message: "无法启动更新操作，请重试。" }); }
  }

  return <section className="settings-card update-card">
    <h2>应用更新</h2>
    <p>当前版本：{info?.version ?? "浏览器预览"}</p>
    <small>{info?.configured ? `更新源：GitHub · ${info.repository}` : "更新源尚未配置，稍后接入 GitHub Release。"}</small>
    <p>下载新版 APK 后由系统确认覆盖安装，无需卸载，保留本机便签。</p>
    {release && <div className="update-release"><strong>发现新版本 {release.version}</strong><small>安装包约 {(release.size / 1024 / 1024).toFixed(1)} MB</small>{release.notes && <p>{release.notes}</p>}</div>}
    {result.phase === "checking" && <p role="status">正在检查更新…</p>}
    {result.phase === "downloading" && <div role="status"><p>正在下载 {result.progress ?? 0}%</p><progress aria-label="更新下载进度" max={100} value={result.progress ?? 0} /></div>}
    {result.phase === "installing" && <p role="status">正在核对安装包…</p>}
    {result.message && <p className={result.phase === "error" ? "data-error" : "data-message"} role={result.phase === "error" ? "alert" : "status"}>{result.message}</p>}
    <div className="data-actions">
      <button className="data-button" disabled={busy} onClick={() => run("check")}>检查更新</button>
      {release && !ready && <button className="data-button" disabled={busy || !canInstall} onClick={() => run("download")}>下载更新</button>}
      {ready && <button className="data-button" disabled={busy || !canInstall} onClick={() => run("install")}>{result.phase === "permission" ? "继续安装" : "安装更新"}</button>}
      {busy && <button className="data-button" onClick={() => {
        window.BetterNotepadUpdates?.cancel(pending.current); pending.current = "";
        setResult({ requestId: "", phase: "idle", message: "已取消，便签未改动。" });
      }}>取消更新</button>}
    </div>
    {!canInstall && <p className="data-error">请先重试保存未保存的内容，再下载或安装更新。</p>}
  </section>;
}
