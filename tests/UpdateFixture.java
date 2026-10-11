package com.betternotepad.android;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.*;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.*;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;

public class UpdateFixture {
    static final String REPO = "fixture/notes", ID = "0123456789abcdef0123456789abcdef";
    static final String API = "https://api.github.com/repos/" + REPO + "/releases/latest";
    static final String URL_APK = "https://github.com/" + REPO + "/releases/download/v0.1.21/BetterNotepad-Android-0.1.21.apk";
    static final byte[] APK = "fixture-apk-bytes".getBytes(StandardCharsets.UTF_8);
    static final byte[] CERT = {1, 2, 3};
    static final Map<String, Response> responses = new HashMap<>();
    static int opened;
    static class Response {
        int status = 200; byte[] body; String redirect; Long length; boolean timeout;
        CountDownLatch entered, blocked;
        Response(byte[] body) { this.body = body; }
    }
    static class Connection extends HttpURLConnection {
        final Response response;
        Connection(URL url) throws IOException { super(url); opened++; response = responses.get(url.toString()); if (response == null) throw new IOException("Unexpected fixture URL: " + url); }
        public void disconnect() { if (response.blocked != null) response.blocked.countDown(); } public boolean usingProxy() { return false; } public void connect() {}
        public int getResponseCode() throws IOException {
            if (response.blocked != null) { response.entered.countDown(); try { response.blocked.await(); } catch (InterruptedException error) { throw new InterruptedIOException("cancelled"); } }
            if (response.timeout) throw new SocketTimeoutException(); return response.status;
        }
        public String getHeaderField(String name) { return "Location".equals(name) ? response.redirect : null; }
        public long getContentLengthLong() { return response.length == null ? response.body.length : response.length; }
        public InputStream getInputStream() { return new ByteArrayInputStream(response.body); }
    }
    static JSONObject metadata() throws Exception {
        JSONObject asset = new JSONObject().put("name", "BetterNotepad-Android-0.1.21.apk").put("state", "uploaded")
            .put("size", APK.length).put("browser_download_url", URL_APK).put("digest", "sha256:" + UpdateSource.hex(MessageDigest.getInstance("SHA-256").digest(APK)));
        return new JSONObject().put("tag_name", "v0.1.21").put("draft", false).put("prerelease", false)
            .put("body", "Version notes <script>not executable</script>").put("assets", new JSONArray().put(asset));
    }
    static void defaults() throws Exception {
        responses.put(API, new Response(metadata().toString().getBytes(StandardCharsets.UTF_8)));
        responses.put(URL_APK, new Response(APK));
    }
    interface Throwing { void run() throws Exception; }
    static void require(boolean value) { if (!value) throw new AssertionError(); }
    static void rejects(Throwing action, String message) throws Exception {
        try { action.run(); throw new AssertionError("Expected failure: " + message); }
        catch (Exception error) { require(error.getMessage() != null && error.getMessage().contains(message)); }
    }
    static PackageInfo pkg(String version, int code) {
        PackageInfo info = new PackageInfo(); info.packageName = "com.betternotepad.android"; info.versionName = version; info.versionCode = code;
        info.signatures = new Signature[]{new Signature(CERT)}; info.signingInfo = new SigningInfo(); info.signingInfo.signers = info.signatures; return info;
    }
    static Activity activity(File directory) {
        Activity activity = new Activity(); activity.cache = directory; activity.repository = REPO;
        activity.pm.installed = pkg("0.1.20", 21); activity.pm.candidate = pkg("0.1.21", 22); return activity;
    }
    static BlockingQueue<JSONObject> events = new LinkedBlockingQueue<>();
    static JSONObject await(AppUpdater updater, String phase) throws Exception {
        JSONObject result;
        do { result = events.poll(5, TimeUnit.SECONDS); if (result == null) throw new AssertionError("No " + phase); } while ("downloading".equals(result.getString("phase")));
        require(phase.equals(result.getString("phase")));
        java.lang.reflect.Field field = AppUpdater.class.getDeclaredField("active"); field.setAccessible(true);
        long end = System.currentTimeMillis() + 5000;
        while (field.get(updater) != null && System.currentTimeMillis() < end) Thread.sleep(1);
        require(field.get(updater) == null); return result;
    }
    static void ready(AppUpdater updater) throws Exception { updater.check(ID); await(updater, "available"); updater.download(ID); await(updater, "ready"); }

    public static void main(String[] args) throws Exception {
        URL.setURLStreamHandlerFactory(protocol -> "https".equals(protocol) ? new URLStreamHandler() {
            protected URLConnection openConnection(URL url) throws IOException { return new Connection(url); }
        } : null);
        String test = args[0]; File directory = Files.createTempDirectory(new File(args[1]).toPath(), "update-fixture-").toFile(); defaults();
        switch (test) {
            case "versions":
                require(UpdateSource.compareVersions("v0.1.20", "0.1.9") > 0); require(UpdateSource.compareVersions("1.0.0", "0.99.99") > 0);
                require(UpdateSource.compareVersions("0.1.20", "v0.1.20") == 0);
                for (String value : new String[]{"1.0", "0.1.21-beta", "v01.2.3", "1000000000.0.0", "<script>"}) rejects(() -> UpdateSource.compareVersions(value, "0.1.20"), "版本号");
                break;
            case "repository":
                for (String value : new String[]{"", "https://github.com/a/b", "a/../b", "a/b?token=x", "a/b#", "a/b/c"}) require(!UpdateSource.validRepository(value));
                require(UpdateSource.validRepository(REPO)); rejects(() -> new UpdateSource().latest(""), "尚未配置"); require(opened == 0); break;
            case "release": {
                UpdateSource.Release release = new UpdateSource().latest(REPO); require(release.version.equals("0.1.21")); require(release.size == APK.length);
                JSONObject data = metadata(); data.put("prerelease", true); rejects(() -> UpdateSource.parse(REPO, data), "正式版本");
                data.put("prerelease", false).put("draft", true); rejects(() -> UpdateSource.parse(REPO, data), "正式版本");
                break;
            }
            case "assets": {
                JSONObject data = metadata(), asset = data.getJSONArray("assets").getJSONObject(0);
                asset.put("name", "windows.zip"); rejects(() -> UpdateSource.parse(REPO, data), "缺少");
                JSONObject duplicate = metadata(); duplicate.getJSONArray("assets").put(duplicate.getJSONArray("assets").getJSONObject(0));
                rejects(() -> UpdateSource.parse(REPO, duplicate), "重复");
                for (long size : new long[]{0, -1, UpdateSource.MAX_APK + 1}) { JSONObject d = metadata(); d.getJSONArray("assets").getJSONObject(0).put("size", size); rejects(() -> UpdateSource.parse(REPO, d), "100 MB"); }
                JSONObject wrong = metadata(); wrong.getJSONArray("assets").getJSONObject(0).put("browser_download_url", "https://example.invalid/payload.apk"); rejects(() -> UpdateSource.parse(REPO, wrong), "地址");
                JSONObject digest = metadata(); digest.getJSONArray("assets").getJSONObject(0).put("digest", "md5:123"); rejects(() -> UpdateSource.parse(REPO, digest), "校验信息");
                break;
            }
            case "network-errors":
                for (int status : new int[]{404, 403, 429, 500}) { responses.get(API).status = status; rejects(() -> new UpdateSource().latest(REPO), status == 404 ? "不可用" : status == 500 ? "500" : "限流"); }
                responses.get(API).timeout = true; try { new UpdateSource().latest(REPO); throw new AssertionError(); } catch (SocketTimeoutException expected) {}
                responses.get(API).timeout = false; responses.get(API).status = 200; responses.get(API).body = new byte[1024 * 1024 + 1]; rejects(() -> new UpdateSource().latest(REPO), "过大"); break;
            case "download": {
                File partial = new File(directory, "good.part"); List<Integer> progress = new ArrayList<>();
                new UpdateSource().download(UpdateSource.parse(REPO, metadata()), partial, progress::add);
                require(Arrays.equals(Files.readAllBytes(partial.toPath()), APK)); require(progress.get(progress.size() - 1) == 100); break;
            }
            case "download-errors": {
                File partial = new File(directory, "bad.part");
                responses.get(URL_APK).length = -1L; responses.get(URL_APK).body = new byte[APK.length - 1];
                rejects(() -> new UpdateSource().download(UpdateSource.parse(REPO, metadata()), partial, p -> {}), "不完整"); require(!partial.exists());
                responses.get(URL_APK).body = new byte[APK.length + 1]; rejects(() -> new UpdateSource().download(UpdateSource.parse(REPO, metadata()), partial, p -> {}), "超出"); require(!partial.exists());
                responses.get(URL_APK).body = new byte[APK.length]; rejects(() -> new UpdateSource().download(UpdateSource.parse(REPO, metadata()), partial, p -> {}), "SHA-256"); require(!partial.exists());
                defaults(); responses.get(URL_APK).length = 100L; rejects(() -> new UpdateSource().download(UpdateSource.parse(REPO, metadata()), partial, p -> {}), "大小"); require(!partial.exists()); break;
            }
            case "cancel": {
                File partial = new File(directory, "cancel.part"); UpdateSource source = new UpdateSource();
                rejects(() -> source.download(UpdateSource.parse(REPO, metadata()), partial, p -> source.cancel()), "取消"); require(!partial.exists());
                UpdateSource before = new UpdateSource(); before.cancel(); opened = 0; rejects(() -> before.latest(REPO), "取消"); require(opened == 0); break;
            }
            case "redirects": {
                String cdn = "https://release-assets.githubusercontent.com/fixture/apk?signature=fixture";
                responses.get(URL_APK).status = 302; responses.get(URL_APK).redirect = cdn; responses.put(cdn, new Response(APK));
                new UpdateSource().download(UpdateSource.parse(REPO, metadata()), new File(directory, "cdn.part"), p -> {});
                for (String url : new String[]{"http://github.com/x", "https://evil.invalid/x", "https://github.com:444/x", "https://token@github.com/x", "https://github.com/x#fragment"}) {
                    responses.get(URL_APK).redirect = url; rejects(() -> new UpdateSource().download(UpdateSource.parse(REPO, metadata()), new File(directory, "bad.part"), p -> {}), "不受信任");
                }
                responses.get(URL_APK).redirect = URL_APK; rejects(() -> new UpdateSource().download(UpdateSource.parse(REPO, metadata()), new File(directory, "loop.part"), p -> {}), "过多"); break;
            }
            case "package-validation": {
                byte[][] cert = {CERT};
                UpdateSource.validatePackage("app", 21, cert, "app", 22, cert, "0.1.21", "0.1.21", 26, 34);
                rejects(() -> UpdateSource.validatePackage("app", 21, cert, "other", 22, cert, "0.1.21", "0.1.21", 26, 34), "不属于");
                rejects(() -> UpdateSource.validatePackage("app", 21, cert, "app", 21, cert, "0.1.21", "0.1.21", 26, 34), "更高版本");
                rejects(() -> UpdateSource.validatePackage("app", 21, cert, "app", 22, cert, "0.1.22", "0.1.21", 26, 34), "Release");
                rejects(() -> UpdateSource.validatePackage("app", 21, cert, "app", 22, cert, "0.1.21", "0.1.21", 35, 34), "不支持");
                for (byte[][] bad : new byte[][][]{new byte[0][], new byte[][]{{9}}, new byte[][]{CERT, {9}}}) rejects(() -> UpdateSource.validatePackage("app", 21, cert, "app", 22, bad, "0.1.21", "0.1.21", 26, 34), "签名"); break;
            }
            case "native-empty": {
                Activity activity = activity(directory); activity.repository = "";
                AppUpdater updater = new AppUpdater(activity, events::add); require(!new JSONObject(updater.info()).getBoolean("configured"));
                updater.check(ID); require(await(updater, "error").getString("message").contains("尚未配置")); require(opened == 0); updater.close(); break;
            }
            case "native-current": {
                Activity activity = activity(directory); activity.pm.installed.versionName = "0.1.21";
                AppUpdater updater = new AppUpdater(activity, events::add); updater.check(ID); await(updater, "current");
                updater.download(ID); await(updater, "error"); require(activity.intents.isEmpty()); updater.close(); break;
            }
            case "native-cancel": {
                Activity activity = activity(directory); Response blocked = responses.get(API);
                blocked.entered = new CountDownLatch(1); blocked.blocked = new CountDownLatch(1);
                AppUpdater updater = new AppUpdater(activity, events::add); updater.check(ID); require(blocked.entered.await(5, TimeUnit.SECONDS));
                String next = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
                updater.check(next); require(events.poll(5, TimeUnit.SECONDS).getString("phase").equals("error"));
                updater.cancel(ID); defaults(); updater.check(next);
                require(await(updater, "available").getString("requestId").equals(next));
                require(events.isEmpty()); require(activity.intents.isEmpty());
                updater.close(); opened = 0; updater.check(ID); require(opened == 0); break;
            }
            case "native-permission":
            case "native-old-android": {
                if (test.equals("native-old-android")) Build.VERSION.SDK_INT = 26;
                Activity activity = activity(directory); AppUpdater updater = new AppUpdater(activity, events::add); ready(updater);
                updater.install(ID); await(updater, "permission"); require(activity.intents.size() == 1);
                require(activity.intents.get(0).action.equals("android.settings.MANAGE_UNKNOWN_APP_SOURCES")); require(activity.intents.get(0).uri.toString().equals("package:com.betternotepad.android"));
                activity.pm.permitted = true; require(activity.intents.size() == 1);
                updater.install(ID); JSONObject result = await(updater, "installer"); Intent intent = activity.intents.get(1);
                require(result.getString("message").contains("请确认安装")); require(!result.getString("message").contains("更新成功"));
                require(intent.action.equals(Intent.ACTION_VIEW)); require(intent.type.equals(UpdateProvider.MIME)); require(intent.flags == Intent.FLAG_GRANT_READ_URI_PERMISSION);
                require(intent.uri.toString().equals("content://com.betternotepad.android.updates/" + ID + ".apk"));
                updater.close(); require(new File(directory, "app-update/" + ID + ".apk").isFile()); break;
            }
            case "native-invalid-apk": {
                Activity activity = activity(directory); activity.pm.candidate.signingInfo.signers = new Signature[]{new Signature(new byte[]{9})};
                AppUpdater updater = new AppUpdater(activity, events::add); updater.check(ID); await(updater, "available"); updater.download(ID);
                require(await(updater, "error").getString("message").contains("签名")); require(activity.intents.isEmpty());
                require(new File(directory, "app-update").list().length == 0); updater.close(); break;
            }
            case "native-invalid-package": {
                Activity activity = activity(directory); activity.pm.candidate.packageName = "other.package";
                AppUpdater updater = new AppUpdater(activity, events::add); updater.check(ID); await(updater, "available"); updater.download(ID);
                require(await(updater, "error").getString("message").contains("不属于")); require(activity.intents.isEmpty()); updater.close(); break;
            }
            case "native-cancel-install": {
                Activity activity = activity(directory); activity.pm.permitted = true;
                AppUpdater updater = new AppUpdater(activity, events::add); ready(updater); activity.deferUi = true;
                updater.install(ID); Runnable pending = activity.ui.poll(5, TimeUnit.SECONDS); require(pending != null);
                updater.cancel(ID); pending.run(); require(activity.intents.isEmpty()); require(events.isEmpty()); updater.close(); break;
            }
            case "native-changed-apk": {
                Activity activity = activity(directory); activity.pm.permitted = true;
                AppUpdater updater = new AppUpdater(activity, events::add); ready(updater);
                Files.write(new File(directory, "app-update/" + ID + ".apk").toPath(), new byte[]{0});
                updater.install(ID); JSONObject result = await(updater, "error"); require(!result.getBoolean("ready")); require(activity.intents.isEmpty()); updater.close(); break;
            }
            case "native-installer-failure": {
                Activity activity = activity(directory); AppUpdater updater = new AppUpdater(activity, events::add); ready(updater);
                activity.failLaunch = true; updater.install(ID); require(await(updater, "error").getBoolean("ready"));
                activity.failLaunch = false; activity.pm.permitted = true; updater.install(ID); await(updater, "installer"); updater.close(); break;
            }
            case "provider": {
                Activity activity = activity(directory); new File(directory, "app-update").mkdirs(); File apk = new File(directory, "app-update/" + ID + ".apk"); Files.write(apk.toPath(), APK);
                UpdateProvider provider = new UpdateProvider(); provider.context = activity; require(provider.onCreate());
                Uri uri = Uri.parse("content://com.betternotepad.android.updates/" + ID + ".apk"); require(provider.getType(uri).equals(UpdateProvider.MIME));
                ParcelFileDescriptor fd = provider.openFile(uri, "r"); require(fd.file.equals(apk)); require(fd.mode == ParcelFileDescriptor.MODE_READ_ONLY);
                MatrixCursor cursor = (MatrixCursor) provider.query(uri, null, null, null, null); require(cursor.values[1].equals((long) APK.length));
                rejects(() -> provider.openFile(uri, "rw"), "read-only");
                for (String path : new String[]{"notebook-v1.json", "../notebook-v1.json", "%2e%2e%2fnotebook-v1.json", ID + ".apk?x=1", ID + ".apk#x", "images/x.jpg"})
                    rejects(() -> provider.openFile(Uri.parse("content://com.betternotepad.android.updates/" + path), "r"), "Invalid");
                rejects(() -> provider.openFile(Uri.parse("content://other.updates/" + ID + ".apk"), "r"), "Invalid");
                rejects(() -> provider.delete(uri, null, null), "Read-only"); break;
            }
            default: throw new AssertionError(test);
        }
        System.out.println("PASS " + test);
    }
}
