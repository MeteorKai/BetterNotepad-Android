package com.betternotepad.android;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.media.ExifInterface;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.MediaStore;
import android.os.Bundle;
import android.util.AtomicFile;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class MainActivity extends Activity {
    private static final String HOST = "app.betternotepad.local";
    private static final int PICK_IMAGE = 41;
    private static final int EXPORT_BACKUP = 42;
    private static final int OPEN_BACKUP = 43;
    private static final int TAKE_PHOTO = 44;
    private WebView web;
    private AppUpdater updater;
    private AtomicFile notebook;
    private String imageRequest;
    private AlertDialog imageDialog;
    private File cameraFile;
    private Uri cameraUri;
    private String currentTheme = "warm";
    private final NotebookBridge bridge = new NotebookBridge();
    private volatile String backupRequest;
    private volatile boolean backupBusy;
    private BackupArchive.Stage backupStage;
    private JSONObject stagedData;
    private String stagedBaseline;
    private boolean webReady, resumed;
    private String pendingNote;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        pendingNote = getIntent().getStringExtra(NoteWidgetProvider.NOTE_ID);
        notebook = new AtomicFile(new File(getFilesDir(), "notebook-v1.json"));
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#f8f3eb"));
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.addJavascriptInterface(bridge, "BetterNotepad");
        updater = new AppUpdater(this, result -> runOnUiThread(() -> {
            if (!isDestroyed()) web.evaluateJavascript("window.betterNotepadUpdateResult && window.betterNotepadUpdateResult(" + result.toString() + ")", null);
        }));
        web.addJavascriptInterface(updater, "BetterNotepadUpdates");
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!isLocal(uri)) return response(403, "Forbidden");
                String path = uri.getPath();
                if (path == null || path.equals("/")) path = "/index.html";
                if (path.contains("..")) return response(403, "Forbidden");
                String mime = path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" :
                    path.endsWith(".svg") ? "image/svg+xml" : path.endsWith(".png") ? "image/png" : "text/html";
                Map<String, String> headers = new HashMap<>();
                headers.put("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'");
                headers.put("X-Content-Type-Options", "nosniff");
                try {
                    if (path.startsWith("/images/")) {
                        if (!path.matches("/images/[a-f0-9]{32}\\.(jpg|png)")) return response(403, "Forbidden");
                        File image = new File(new File(getFilesDir(), "images"), path.substring(8));
                        return new WebResourceResponse(path.endsWith(".png") ? "image/png" : "image/jpeg", null,
                            200, "OK", headers, new FileInputStream(image));
                    }
                    return new WebResourceResponse(mime, "UTF-8", 200, "OK", headers, getAssets().open("web" + path));
                } catch (IOException error) { return response(404, "Not Found"); }
            }

            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (isLocal(uri)) return false;
                if (request.isForMainFrame() && ("https".equals(uri.getScheme()) || "http".equals(uri.getScheme()))) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
                    catch (android.content.ActivityNotFoundException ignored) { }
                }
                return true;
            }
        });
        setContentView(web);
        web.loadUrl("https://" + HOST + "/");
    }

    @Override protected void onResume() { super.onResume(); resumed = true; notifyResume(); }
    @Override protected void onPause() { resumed = false; super.onPause(); }
    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent); setIntent(intent);
        pendingNote = intent.getStringExtra(NoteWidgetProvider.NOTE_ID); notifyResume();
    }
    private void notifyResume() {
        if (!webReady || !resumed || web == null || isDestroyed()) return;
        final String note = pendingNote;
        web.evaluateJavascript("Boolean(window.betterNotepadResume && window.betterNotepadResume(" + (note == null ? "null" : JSONObject.quote(note)) + "))", handled -> {
            if ("true".equals(handled) && java.util.Objects.equals(note, pendingNote)) pendingNote = null;
        });
    }
    private void refreshWidgets() { NoteWidgetProvider.refresh(this); }

    private static boolean isLocal(Uri uri) {
        return "https".equals(uri.getScheme()) && HOST.equals(uri.getHost()) && uri.getPort() == -1;
    }

    private static WebResourceResponse response(int status, String reason) {
        return new WebResourceResponse("text/plain", "UTF-8", status, reason, null,
            new ByteArrayInputStream(reason.getBytes(StandardCharsets.UTF_8)));
    }

    private void applyTheme(String theme) {
        runOnUiThread(() -> {
            if (isDestroyed()) return;
            currentTheme = theme;
            boolean dark = "dark".equals(theme);
            int color = Color.parseColor(dark ? "#1c1a21" : "light".equals(theme) ? "#f7f8fb" : "#f8f3eb");
            getWindow().setStatusBarColor(color);
            getWindow().setNavigationBarColor(color);
            getWindow().getDecorView().setSystemUiVisibility(dark ? 0 : View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
            web.setBackgroundColor(color);
        });
    }

    private void imageResult(String requestId, String field, Object value) {
        runOnUiThread(() -> {
            if (requestId.equals(imageRequest)) { clearCamera(); imageRequest = null; }
            if (isDestroyed()) return;
            try {
                String result = new JSONObject().put("requestId", requestId).put(field, value).toString();
                web.evaluateJavascript("window.betterNotepadImageResult && window.betterNotepadImageResult(" + result + ")", null);
            } catch (Exception ignored) { }
        });
    }

    private void openImagePicker() {
        final String requestId = imageRequest;
        int theme = "dark".equals(currentTheme) ? android.R.style.Theme_Material_Dialog_Alert : android.R.style.Theme_Material_Light_Dialog_Alert;
        imageDialog = new AlertDialog.Builder(this, theme).setTitle("插入图片")
            .setItems(new String[]{"拍照", "从相册选择"}, (dialog, which) -> {
                try {
                    if (which == 0) openCamera();
                    else startActivityForResult(new Intent(this, GalleryActivity.class).putExtra("theme", currentTheme), PICK_IMAGE);
                } catch (IOException | android.content.ActivityNotFoundException | SecurityException error) {
                    imageResult(requestId, "error", which == 0 ? "无法打开相机，请检查手机相机是否可用及设备剩余空间。" : "无法打开相册，请重试。");
                }
            }).setNegativeButton("取消", (dialog, which) -> imageResult(requestId, "cancelled", true))
            .setOnCancelListener(dialog -> imageResult(requestId, "cancelled", true)).show();
    }

    private void openCamera() throws IOException {
        File directory = new File(getCacheDir(), "camera-capture");
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("Cannot create camera directory");
        cameraFile = new File(directory, UUID.randomUUID().toString().replace("-", "") + ".jpg");
        if (!cameraFile.createNewFile()) throw new IOException("Cannot create capture file");
        cameraUri = Uri.parse("content://" + getPackageName() + ".camera/" + cameraFile.getName());
        Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE).putExtra(MediaStore.EXTRA_OUTPUT, cameraUri);
        intent.setClipData(ClipData.newRawUri("拍照", cameraUri));
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        startActivityForResult(intent, TAKE_PHOTO);
    }

    private void clearCamera() {
        if (cameraUri != null) { revokeUriPermission(cameraUri, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION); cameraUri = null; }
        if (cameraFile != null) { cameraFile.delete(); cameraFile = null; }
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent result) {
        super.onActivityResult(requestCode, resultCode, result);
        if (requestCode == EXPORT_BACKUP || requestCode == OPEN_BACKUP) {
            handleBackupResult(requestCode, resultCode, result);
            return;
        }
        if ((requestCode != PICK_IMAGE && requestCode != TAKE_PHOTO) || imageRequest == null) return;
        final String requestId = imageRequest;
        if (resultCode != RESULT_OK || (requestCode == PICK_IMAGE && (result == null || result.getData() == null))) {
            imageResult(requestId, "cancelled", true);
            return;
        }
        // Cameras commonly return a null Intent when EXTRA_OUTPUT is supplied.
        final Uri uri = requestCode == TAKE_PHOTO ? cameraUri : result.getData();
        if (uri == null) { imageResult(requestId, "error", "拍照结果已失效，请重新拍照。"); return; }
        // Decode and persist off the UI thread; never retain the provider URI.
        new Thread(() -> {
            try { imageResult(requestId, "path", importImage(uri)); }
            catch (Exception | OutOfMemoryError error) {
                imageResult(requestId, "error", "无法读取这张图片，请检查图片格式及设备剩余空间后重试。");
            }
        }, "note-image-import").start();
    }

    private String importImage(Uri uri) throws IOException {
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inJustDecodeBounds = true;
        try (InputStream input = getContentResolver().openInputStream(uri)) { BitmapFactory.decodeStream(input, null, options); }
        if (options.outWidth <= 0 || options.outHeight <= 0) throw new IOException("Invalid image");
        options.inJustDecodeBounds = false;
        options.inSampleSize = 1;
        while ((long) Math.max(options.outWidth, options.outHeight) > 2048L * options.inSampleSize) options.inSampleSize *= 2;
        int orientation = ExifInterface.ORIENTATION_NORMAL;
        try (InputStream input = getContentResolver().openInputStream(uri)) {
            orientation = new ExifInterface(input).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
        } catch (IOException ignored) { }
        Bitmap bitmap;
        try (InputStream input = getContentResolver().openInputStream(uri)) { bitmap = BitmapFactory.decodeStream(input, null, options); }
        if (bitmap == null) throw new IOException("Cannot decode image");
        AtomicFile file = null;
        FileOutputStream output = null;
        try {
            Matrix matrix = new Matrix();
            switch (orientation) {
                case ExifInterface.ORIENTATION_FLIP_HORIZONTAL: matrix.setScale(-1, 1); break;
                case ExifInterface.ORIENTATION_ROTATE_180: matrix.setRotate(180); break;
                case ExifInterface.ORIENTATION_FLIP_VERTICAL: matrix.setScale(1, -1); break;
                case ExifInterface.ORIENTATION_TRANSPOSE: matrix.setRotate(90); matrix.postScale(-1, 1); break;
                case ExifInterface.ORIENTATION_ROTATE_90: matrix.setRotate(90); break;
                case ExifInterface.ORIENTATION_TRANSVERSE: matrix.setRotate(-90); matrix.postScale(-1, 1); break;
                case ExifInterface.ORIENTATION_ROTATE_270: matrix.setRotate(-90); break;
            }
            if (!matrix.isIdentity()) {
                Bitmap rotated = Bitmap.createBitmap(bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), matrix, true);
                if (rotated != bitmap) { bitmap.recycle(); bitmap = rotated; }
            }
            boolean png = bitmap.hasAlpha() || "image/png".equals(options.outMimeType);
            File directory = new File(getFilesDir(), "images");
            if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("Cannot create images directory");
            String name = UUID.randomUUID().toString().replace("-", "") + (png ? ".png" : ".jpg");
            file = new AtomicFile(new File(directory, name));
            output = file.startWrite();
            if (!bitmap.compress(png ? Bitmap.CompressFormat.PNG : Bitmap.CompressFormat.JPEG, 90, output)) throw new IOException("Cannot encode image");
            file.finishWrite(output);
            output = null;
            return "/images/" + name;
        } finally {
            if (output != null) file.failWrite(output);
            bitmap.recycle();
        }
    }

    private void pruneImages(JSONObject data) throws Exception {
        if (data.getInt("version") != 1) return;
        BackupData.validate(data);
        Set<String> referenced = BackupData.images(data);
        // Keep files during editing so undo works. Only prune on a fresh load,
        // after all saved references have been read successfully.
        File[] files = new File(getFilesDir(), "images").listFiles();
        if (files == null) return;
        for (File file : files) {
            if (file.isFile() && file.getName().matches("[a-f0-9]{32}\\.(jpg|png)") && !referenced.contains(file.getName())) file.delete();
        }
    }

    private String readNotebook() throws Exception {
        return NotebookStore.read(notebook);
    }

    private void writeNotebook(String raw) throws Exception {
        NotebookStore.write(notebook, raw);
    }

    private void clearBackupStage() {
        if (backupStage != null) backupStage.close();
        backupStage = null; stagedData = null; stagedBaseline = null;
    }

    private void backupResult(String id, String field, Object value) {
        try { backupResult(id, new JSONObject().put(field, value)); } catch (Exception ignored) { }
    }

    private void backupResult(String id, JSONObject result) {
        runOnUiThread(() -> {
            if (id.equals(backupRequest)) {
                backupBusy = false;
                // A staged preview (including a failed commit) stays retryable.
                if (backupStage == null || "restored".equals(result.optString("phase"))) backupRequest = null;
            }
            if (isDestroyed()) return;
            try {
                result.put("requestId", id);
                web.evaluateJavascript("window.betterNotepadBackupResult && window.betterNotepadBackupResult(" + result + ")", null);
            } catch (Exception ignored) { }
        });
    }

    private void beginBackup(String id, int requestCode) {
        if (id == null || !id.matches("[a-f0-9]{32}")) return;
        runOnUiThread(() -> {
            if (isDestroyed()) return;
            if (backupRequest != null || imageRequest != null) {
                backupResult(id, "error", "还有操作未完成，请稍后重试。"); return;
            }
            backupRequest = id; backupBusy = true;
            Intent intent = new Intent(requestCode == EXPORT_BACKUP ? Intent.ACTION_CREATE_DOCUMENT : Intent.ACTION_OPEN_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            if (requestCode == EXPORT_BACKUP) {
                intent.setType("application/zip");
                intent.putExtra(Intent.EXTRA_TITLE, "BetterNotepad-" + new SimpleDateFormat("yyyyMMdd-HHmmss", Locale.ROOT).format(new Date()) + ".zip");
            } else {
                intent.setType("*/*");
                intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[] { "application/zip", "application/x-zip-compressed", "application/octet-stream" });
            }
            try { startActivityForResult(intent, requestCode); }
            catch (android.content.ActivityNotFoundException | SecurityException error) {
                backupResult(id, "error", "无法打开系统文件选择器，请重试。");
            }
        });
    }

    private void handleBackupResult(int requestCode, int resultCode, Intent result) {
        final String id = backupRequest;
        if (id == null) return;
        if (resultCode != RESULT_OK || result == null || result.getData() == null) {
            backupResult(id, "cancelled", true); return;
        }
        final Uri uri = result.getData();
        new Thread(() -> {
            synchronized (bridge) {
                try {
                    if (isDestroyed()) throw new IOException("Activity closed");
                    if (requestCode == EXPORT_BACKUP) {
                        JSONObject data = new JSONObject(readNotebook());
                        BackupData.validate(data);
                        String manifest = new JSONObject().put("type", "betternotepad-backup").put("version", 1)
                            .put("createdAt", System.currentTimeMillis()).put("notebook", data).toString();
                        try (OutputStream output = getContentResolver().openOutputStream(uri, "wt")) {
                            if (output == null) throw new IOException("Cannot open backup destination");
                            BackupArchive.write(output, manifest, BackupData.images(data), new File(getFilesDir(), "images"));
                        }
                        backupResult(id, "phase", "exported");
                    } else {
                        clearBackupStage();
                        try (InputStream input = getContentResolver().openInputStream(uri)) { backupStage = BackupArchive.read(input, getCacheDir()); }
                        JSONObject manifest = BackupData.read(backupStage);
                        stagedData = manifest.getJSONObject("notebook");
                        stagedBaseline = readNotebook();
                        backupResult(id, new JSONObject().put("phase", "preview").put("notes", stagedData.getJSONArray("notes").length())
                            .put("trash", stagedData.has("trash") ? stagedData.getJSONArray("trash").length() : 0)
                            .put("images", backupStage.images.size()).put("createdAt", manifest.getLong("createdAt")));
                    }
                } catch (Exception | OutOfMemoryError error) {
                    clearBackupStage();
                    if (requestCode == EXPORT_BACKUP) {
                        // Best effort: providers may not support deleting an incomplete document.
                        try { DocumentsContract.deleteDocument(getContentResolver(), uri); } catch (Exception ignored) { }
                    }
                    backupResult(id, "error", requestCode == EXPORT_BACKUP ?
                        "备份未完成，请检查保存位置及剩余空间。若出现不完整文件，请删除后重试。" :
                        "无法读取此备份，请确认是完整的 BetterNotepad ZIP，图片齐全且空间充足。原内容未改动。");
                }
            }
        }, "note-backup-io").start();
    }

    public final class NotebookBridge {
        @JavascriptInterface public void ready() { runOnUiThread(() -> { webReady = true; notifyResume(); }); }
        @JavascriptInterface public void configureWidget() {
            runOnUiThread(() -> {
                if (!isDestroyed()) startActivity(new Intent(MainActivity.this, WidgetConfigActivity.class));
            });
        }
        @JavascriptInterface public void pickImage(String requestId) {
            if (requestId == null || !requestId.matches("[a-f0-9]{32}")) return;
            runOnUiThread(() -> {
                if (isDestroyed()) return;
                if (imageRequest != null || backupRequest != null) { imageResult(requestId, "error", "还有操作未完成，请稍后重试。"); return; }
                imageRequest = requestId;
                openImagePicker();
            });
        }

        @JavascriptInterface public synchronized String load() {
            try { synchronized (NotebookStore.LOCK) {
                String raw = readNotebook();
                JSONObject data = new JSONObject(raw);
                applyTheme(data.getString("theme"));
                if (imageRequest == null) pruneImages(data);
                return new JSONObject().put("ok", true).put("data", raw).put("revision", NotebookStore.revision(raw)).toString();
            } } catch (Exception error) { return "{\"ok\":false,\"error\":\"无法读取本机便签，原文件未被修改。\"}"; }
        }

        @JavascriptInterface public synchronized String save(String raw) {
            try { synchronized (NotebookStore.LOCK) {
                if (backupBusy) throw new IOException("Backup in progress");
                JSONObject data = new JSONObject(raw);
                BackupData.validate(data);
                String theme = data.getString("theme");
                writeNotebook(raw);
                applyTheme(theme);
                refreshWidgets();
                return "{\"ok\":true}";
            } } catch (Exception error) {
                return "{\"ok\":false,\"error\":\"无法写入本机便签，请检查设备剩余空间后重试。\"}";
            }
        }

        @JavascriptInterface public synchronized String saveChecked(String raw, String expected) {
            try { synchronized (NotebookStore.LOCK) {
                if (backupBusy) throw new IOException("Backup in progress");
                String result = NotebookStore.saveChecked(notebook, raw, expected);
                if (new JSONObject(result).getBoolean("ok")) { applyTheme(new JSONObject(raw).getString("theme")); refreshWidgets(); }
                return result;
            } } catch (Exception error) { return "{\"ok\":false,\"error\":\"无法写入本机便签，请检查设备剩余空间后重试。\"}"; }
        }

        @JavascriptInterface public void exportBackup(String id) { beginBackup(id, EXPORT_BACKUP); }
        @JavascriptInterface public void openBackup(String id) { beginBackup(id, OPEN_BACKUP); }

        @JavascriptInterface public synchronized String readBackup(String id) {
            try {
                if (id == null || !id.equals(backupRequest) || stagedData == null || backupBusy) throw new IOException("No staged backup");
                return new JSONObject().put("ok", true).put("data", stagedData.toString()).toString();
            } catch (Exception error) { return "{\"ok\":false,\"error\":\"备份预览已失效，请重新选择文件。\"}"; }
        }

        @JavascriptInterface public synchronized void discardBackup(String id) {
            if (id != null && id.equals(backupRequest) && !backupBusy) { clearBackupStage(); backupRequest = null; }
        }

        @JavascriptInterface public void restoreBackup(String id, String raw) {
            if (id == null || !id.matches("[a-f0-9]{32}")) return;
            runOnUiThread(() -> {
                if (!id.equals(backupRequest) || backupStage == null || backupBusy) {
                    backupResult(id, "error", "备份预览已失效，请重新选择文件。"); return;
                }
                backupBusy = true;
                new Thread(() -> {
                    synchronized (bridge) { synchronized (NotebookStore.LOCK) {
                        boolean committed = false;
                        try {
                            if (isDestroyed() || !readNotebook().equals(stagedBaseline)) throw new IOException("Notebook changed after preview");
                            if (raw == null || raw.getBytes(StandardCharsets.UTF_8).length > BackupArchive.MAX_MANIFEST)
                                throw new IOException("Notebook size limit exceeded");
                            JSONObject next = new JSONObject(raw);
                            BackupData.validate(next);
                            BackupArchive.install(backupStage, BackupData.images(next), new File(getFilesDir(), "images"), () -> {
                                if (isDestroyed()) throw new IOException("Activity closed");
                                writeNotebook(raw);
                            });
                            committed = true;
                            clearBackupStage();
                            applyTheme(next.getString("theme"));
                            refreshWidgets();
                            backupResult(id, "phase", "restored");
                        } catch (Exception | OutOfMemoryError error) {
                            if (committed) backupResult(id, "phase", "restored");
                            else backupResult(id, "error", "恢复未完成，原内容未改动。请检查剩余空间后重试，或取消并重新选择备份。");
                        }
                    } }
                }, "note-backup-restore").start();
            });
        }
    }

    @Override public void onBackPressed() {
        web.evaluateJavascript("Boolean(window.betterNotepadBack && window.betterNotepadBack())", handled -> {
            if (!"true".equals(handled)) finish();
        });
    }

    @Override protected void onDestroy() {
        if (imageDialog != null) imageDialog.dismiss();
        clearCamera();
        updater.close();
        web.removeJavascriptInterface("BetterNotepadUpdates");
        new Thread(() -> { synchronized (bridge) { clearBackupStage(); } }, "note-backup-cleanup").start();
        web.removeJavascriptInterface("BetterNotepad");
        web.destroy();
        super.onDestroy();
    }
}
