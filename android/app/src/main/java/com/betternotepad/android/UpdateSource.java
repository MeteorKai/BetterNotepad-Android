package com.betternotepad.android;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.function.IntConsumer;

final class UpdateSource {
    static final long MAX_APK = 100L * 1024 * 1024;
    private volatile boolean cancelled;
    private volatile HttpURLConnection connection;

    static final class Release {
        final String version, notes, url, digest;
        final long size;
        Release(String version, String notes, String url, long size, String digest) {
            this.version = version; this.notes = notes; this.url = url; this.size = size; this.digest = digest;
        }
    }

    static boolean validRepository(String repository) {
        return repository.matches("[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9][A-Za-z0-9._-]{0,99}");
    }
    static int compareVersions(String left, String right) throws IOException {
        int[] a = versionParts(left), b = versionParts(right);
        for (int i = 0; i < 3; i++) if (a[i] != b[i]) return Integer.compare(a[i], b[i]);
        return 0;
    }
    private static int[] versionParts(String value) throws IOException {
        if (!value.matches("v?(0|[1-9][0-9]{0,8})\\.(0|[1-9][0-9]{0,8})\\.(0|[1-9][0-9]{0,8})"))
            throw new IOException("Release 版本号需为 v主版本.次版本.修订号。");
        String[] parts = value.replaceFirst("^v", "").split("\\.");
        return new int[]{Integer.parseInt(parts[0]), Integer.parseInt(parts[1]), Integer.parseInt(parts[2])};
    }

    static Release parse(String repository, JSONObject data) throws Exception {
        if (!validRepository(repository)) throw new IOException("更新源配置无效。");
        if (data.getBoolean("draft") || data.getBoolean("prerelease")) throw new IOException("没有可用的正式版本。");
        String tag = data.getString("tag_name"); versionParts(tag);
        String version = tag.replaceFirst("^v", "");
        String name = "BetterNotepad-Android-" + version + ".apk";
        JSONArray assets = data.getJSONArray("assets"); JSONObject selected = null;
        for (int i = 0; i < assets.length(); i++) {
            JSONObject asset = assets.getJSONObject(i);
            if (!name.equals(asset.optString("name"))) continue;
            if (selected != null) throw new IOException("Release 中存在重复安装包。");
            selected = asset;
        }
        if (selected == null) throw new IOException("Release 缺少 " + name + "，请稍后重试。");
        long size = selected.getLong("size");
        if (!"uploaded".equals(selected.getString("state")) || size <= 0 || size > MAX_APK)
            throw new IOException("安装包尚未上传完成或超过 100 MB。");
        String url = "https://github.com/" + repository + "/releases/download/" + tag + "/" + name;
        if (!url.equals(selected.getString("browser_download_url"))) throw new IOException("安装包下载地址与更新源不一致。");
        String digest = selected.isNull("digest") ? "" : selected.optString("digest", "");
        if (!digest.isEmpty() && !digest.matches("sha256:[a-fA-F0-9]{64}")) throw new IOException("安装包校验信息无效。");
        String notes = data.optString("body", "");
        if (notes.length() > 20000) notes = notes.substring(0, 20000);
        return new Release(version, notes, url, size, digest.isEmpty() ? "" : digest.substring(7).toLowerCase(Locale.ROOT));
    }

    void cancel() { cancelled = true; HttpURLConnection active = connection; if (active != null) active.disconnect(); }
    private void checkCancelled() throws IOException {
        if (cancelled) throw new InterruptedIOException("更新已取消。");
    }
    private HttpURLConnection open(String value, boolean metadata) throws IOException {
        URL url = new URL(value);
        for (int redirects = 0; redirects <= 5; redirects++) {
            checkCancelled();
            String host = url.getHost();
            boolean allowed = metadata ? "api.github.com".equals(host) :
                "github.com".equals(host) || "release-assets.githubusercontent.com".equals(host) || "objects.githubusercontent.com".equals(host);
            if (!"https".equals(url.getProtocol()) || !allowed || url.getUserInfo() != null || url.getRef() != null || (url.getPort() != -1 && url.getPort() != 443))
                throw new IOException("更新下载跳转到了不受信任的地址。");
            HttpURLConnection request = (HttpURLConnection) url.openConnection(); connection = request;
            request.setInstanceFollowRedirects(false); request.setConnectTimeout(15000); request.setReadTimeout(30000);
            request.setRequestProperty("User-Agent", "BetterNotepad-Android");
            request.setRequestProperty("Accept", metadata ? "application/vnd.github+json" : "application/octet-stream");
            try {
                checkCancelled(); int code = request.getResponseCode();
                if (code == 301 || code == 302 || code == 303 || code == 307 || code == 308) {
                    String location = request.getHeaderField("Location");
                    if (location == null) throw new IOException("更新下载缺少跳转地址。");
                    url = new URL(url, location); request.disconnect(); continue;
                }
                if (code != 200) throw new IOException(code == 404 ? "仓库或正式 Release 不可用，请检查发布配置。" :
                    code == 403 || code == 429 ? "更新服务暂时限流，请稍后重试。" : "更新请求失败（HTTP " + code + "）。");
                return request;
            } catch (IOException error) { request.disconnect(); throw error; }
        }
        throw new IOException("更新下载跳转过多。");
    }

    Release latest(String repository) throws Exception {
        if (repository.isEmpty()) throw new IOException("更新源尚未配置。");
        if (!validRepository(repository)) throw new IOException("更新源配置无效。");
        HttpURLConnection request = open("https://api.github.com/repos/" + repository + "/releases/latest", true);
        try (InputStream input = request.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int read;
            while ((read = input.read(buffer)) != -1) {
                checkCancelled(); if (output.size() + read > 1024 * 1024) throw new IOException("Release 信息过大。");
                output.write(buffer, 0, read);
            }
            checkCancelled(); return parse(repository, new JSONObject(new String(output.toByteArray(), StandardCharsets.UTF_8)));
        } finally { request.disconnect(); connection = null; }
    }

    void download(Release release, File partial, IntConsumer progress) throws Exception {
        boolean complete = false;
        HttpURLConnection request = null;
        try {
            request = open(release.url, false);
            long length = request.getContentLengthLong();
            if (length >= 0 && length != release.size) throw new IOException("安装包大小与 Release 不一致。");
            MessageDigest hash = MessageDigest.getInstance("SHA-256");
            try (InputStream input = request.getInputStream(); FileOutputStream output = new FileOutputStream(partial)) {
                byte[] buffer = new byte[32768]; int read, previous = -1; long total = 0;
                while ((read = input.read(buffer)) != -1) {
                    checkCancelled(); total += read;
                    if (total > release.size || total > MAX_APK) throw new IOException("安装包大小超出预期。");
                    output.write(buffer, 0, read); hash.update(buffer, 0, read);
                    int percent = (int) (total * 100 / release.size);
                    if (percent != previous) { progress.accept(percent); previous = percent; }
                }
                checkCancelled();
                if (total != release.size) throw new IOException("安装包下载不完整，请重新下载。");
                if (!release.digest.isEmpty() && !release.digest.equals(hex(hash.digest()))) throw new IOException("安装包 SHA-256 校验失败，请重新下载。");
                output.getFD().sync(); complete = true;
            }
        } finally {
            if (request != null) request.disconnect(); connection = null;
            if (!complete) partial.delete();
        }
    }
    static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder();
        for (byte value : bytes) result.append(String.format(Locale.ROOT, "%02x", value & 255));
        return result.toString();
    }
    static void validatePackage(String installedPackage, long installedCode, byte[][] installedSigners,
            String candidatePackage, long candidateCode, byte[][] candidateSigners, String candidateVersion,
            String expectedVersion, int minSdk, int deviceSdk) throws IOException {
        if (!installedPackage.equals(candidatePackage)) throw new IOException("安装包不属于 BetterNotepad。");
        if (candidateCode <= installedCode) throw new IOException("安装包不是更高版本，不能覆盖更新。");
        if (!expectedVersion.equals(candidateVersion)) throw new IOException("安装包版本与 Release 不一致。");
        if (minSdk > deviceSdk) throw new IOException("当前 Android 版本不支持此安装包。");
        Set<String> before = new HashSet<>(), after = new HashSet<>();
        for (byte[] signer : installedSigners) before.add(hex(signer));
        for (byte[] signer : candidateSigners) after.add(hex(signer));
        if (before.isEmpty() || !before.equals(after)) throw new IOException("安装包签名与当前应用不一致，已拒绝安装。");
    }
}
