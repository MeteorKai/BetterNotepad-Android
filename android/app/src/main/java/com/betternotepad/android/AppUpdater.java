package com.betternotepad.android;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import org.json.JSONObject;
import java.io.*;
import java.security.MessageDigest;
import java.util.concurrent.CountDownLatch;
import java.util.function.Consumer;

final class AppUpdater {
    private final Activity activity;
    private final Consumer<JSONObject> callback;
    private final String repository;
    private UpdateSource.Release release;
    private File ready;
    private String readyHash;
    private boolean handedToInstaller, closed;
    private String active;
    private UpdateSource source;
    private Thread worker;

    AppUpdater(Activity activity, Consumer<JSONObject> callback) {
        this.activity = activity; this.callback = callback;
        repository = activity.getString(R.string.update_repository).trim();
    }
    private PackageInfo installed() throws Exception {
        return activity.getPackageManager().getPackageInfo(activity.getPackageName(), signingFlags());
    }
    private static int signingFlags() {
        return Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
    }
    private static long code(PackageInfo info) { return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode; }
    private static byte[][] signers(PackageInfo info) {
        Signature[] signatures = Build.VERSION.SDK_INT >= 28 ? (info.signingInfo == null ? null : info.signingInfo.getApkContentsSigners()) : info.signatures;
        if (signatures == null) return new byte[0][];
        byte[][] result = new byte[signatures.length][];
        for (int i = 0; i < result.length; i++) result[i] = signatures[i].toByteArray();
        return result;
    }
    @JavascriptInterface public String info() {
        JSONObject result = new JSONObject();
        try { result.put("version", installed().versionName).put("repository", repository).put("configured", !repository.isEmpty()); }
        catch (Exception ignored) { return "null"; }
        return result.toString();
    }
    @JavascriptInterface public void check(String id) { start(id, "check"); }
    @JavascriptInterface public void download(String id) { start(id, "download"); }
    @JavascriptInterface public void install(String id) { start(id, "install"); }

    private synchronized void start(String id, String action) {
        if (closed || id == null || !id.matches("[a-f0-9]{32}")) return;
        if (active != null) { send(id, "error", "另一项更新操作尚未结束，请稍后重试。"); return; }
        if ("check".equals(action)) { release = null; discardReady(); }
        active = id;
        final UpdateSource transport = new UpdateSource(); source = transport;
        worker = new Thread(() -> {
            File partial = new File(new File(activity.getCacheDir(), "app-update"), id + ".part");
            try {
                if (repository.isEmpty()) throw new IOException("更新源尚未配置。");
                if ("check".equals(action)) {
                    UpdateSource.Release found = transport.latest(repository);
                    boolean newer = UpdateSource.compareVersions(found.version, installed().versionName) > 0;
                    synchronized (this) {
                        if (!id.equals(active)) return;
                        if (newer) release = found;
                        send(id, newer ? "available" : "current", newer ? "可下载并覆盖安装新版。" : "当前已是最新版本。");
                    }
                } else {
                    final UpdateSource.Release target;
                    synchronized (this) { target = release; }
                    if (target == null) throw new IOException("请先检查更新。");
                    if ("download".equals(action)) {
                        if (!partial.getParentFile().isDirectory() && !partial.getParentFile().mkdirs()) throw new IOException("无法创建更新缓存。");
                        transport.download(target, partial, progress -> {
                            synchronized (this) { if (id.equals(active)) send(id, "downloading", "", progress); }
                        });
                        validate(partial, target);
                        String hash = fileHash(partial);
                        synchronized (this) {
                            if (!id.equals(active)) return;
                            discardReady();
                            File apk = new File(partial.getParentFile(), id + ".apk");
                            if (!partial.renameTo(apk)) throw new IOException("无法保存更新安装包。");
                            ready = apk; readyHash = hash;
                            send(id, "ready", "下载和校验完成，点击安装更新。");
                        }
                    } else {
                        final File apk; final String expectedHash;
                        synchronized (this) { apk = ready; expectedHash = readyHash; }
                        if (apk == null || !apk.isFile()) throw new IOException("安装包已被清理，请重新下载。");
                        if (!fileHash(apk).equals(expectedHash)) throw new IOException("安装包已改变，请重新下载。");
                        validate(apk, target);
                        CountDownLatch opened = new CountDownLatch(1);
                        activity.runOnUiThread(() -> {
                            try {
                                synchronized (this) { if (id.equals(active) && !closed) openInstaller(id, apk); }
                            } finally { opened.countDown(); }
                        });
                        opened.await();
                    }
                }
            } catch (Exception error) {
                synchronized (this) {
                    if (id.equals(active)) {
                        if ("install".equals(action)) discardReady();
                        String message = error instanceof java.net.SocketTimeoutException ? "更新请求超时，请重试。" :
                            error instanceof java.net.UnknownHostException || error instanceof javax.net.ssl.SSLException ? "无法连接更新服务，请检查网络后重试。" :
                            error.getMessage() == null ? "更新操作失败，请重试。" : error.getMessage();
                        send(id, "error", message);
                    }
                }
            } finally {
                partial.delete();
                synchronized (this) { if (id.equals(active)) { active = null; source = null; worker = null; } }
            }
        }, "BetterNotepad-update");
        worker.start();
    }
    private void validate(File apk, UpdateSource.Release target) throws Exception {
        PackageInfo current = installed();
        PackageInfo candidate = activity.getPackageManager().getPackageArchiveInfo(apk.getAbsolutePath(), signingFlags());
        if (candidate == null || candidate.applicationInfo == null) throw new IOException("无法读取安装包，请重新下载。");
        if (apk.length() != target.size) throw new IOException("安装包大小不一致，请重新下载。");
        UpdateSource.validatePackage(current.packageName, code(current), signers(current), candidate.packageName,
            code(candidate), signers(candidate), candidate.versionName, target.version, candidate.applicationInfo.minSdkVersion, Build.VERSION.SDK_INT);
    }
    private static String fileHash(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[32768]; int read;
            while ((read = input.read(buffer)) != -1) {
                if (Thread.currentThread().isInterrupted()) throw new InterruptedIOException("更新已取消。");
                digest.update(buffer, 0, read);
            }
        }
        return UpdateSource.hex(digest.digest());
    }
    private void openInstaller(String id, File apk) {
        try {
            if (!activity.getPackageManager().canRequestPackageInstalls()) {
                activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.getPackageName())));
                send(id, "permission", "请允许 BetterNotepad 安装应用，返回后点击「继续安装」。");
            } else {
                Uri uri = Uri.parse("content://" + activity.getPackageName() + ".updates/" + apk.getName());
                activity.startActivity(new Intent(Intent.ACTION_VIEW).setDataAndType(uri, UpdateProvider.MIME).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION));
                handedToInstaller = true;
                send(id, "installer", "已打开系统安装界面，请确认安装；取消后可再次点击安装。");
            }
        } catch (Exception ignored) { send(id, "error", "无法打开系统安装设置或安装界面，请重试。"); }
    }
    private void send(String id, String phase, String message) { send(id, phase, message, -1); }
    private void send(String id, String phase, String message, int progress) {
        try {
            JSONObject result = new JSONObject().put("requestId", id).put("phase", phase).put("message", message).put("ready", ready != null);
            if (progress >= 0) result.put("progress", progress);
            if (release != null) result.put("release", new JSONObject().put("version", release.version).put("notes", release.notes).put("size", release.size));
            callback.accept(result);
        } catch (Exception ignored) { }
    }
    private void discardReady() {
        // A system installer may still be reading a granted APK. Never remove that file here.
        if (ready != null && !handedToInstaller) ready.delete();
        ready = null; readyHash = null; handedToInstaller = false;
    }
    @JavascriptInterface public synchronized void cancel(String id) {
        if (id != null && id.equals(active)) {
            active = null;
            if (source != null) source.cancel();
            if (worker != null) worker.interrupt();
            source = null; worker = null;
        }
    }
    synchronized void close() { cancel(active); discardReady(); closed = true; }
}
