package com.betternotepad.android;

import android.app.*;
import android.content.*;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.MediaStore;
import android.webkit.JavascriptInterface;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;
import java.util.concurrent.*;

public class CameraFixture extends Activity {
    // MAIN_CONSTANTS
    static final String ID = "0123456789abcdef0123456789abcdef", OTHER = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    static final String IMAGE = "/images/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg";
    static final Uri GALLERY = Uri.parse("content://media/external/images/media/123");
    static final byte[] PHOTO = "full-sized-camera-photo".getBytes(StandardCharsets.UTF_8);
    String imageRequest, backupRequest, currentTheme = "warm", decodeFailure = "", importThread;
    AlertDialog imageDialog;
    File cameraFile;
    Uri cameraUri;
    int imports, backups;
    byte[] imported;
    final Object bridge = new Object();
    final Updater updater = new Updater();
    final Web web = new Web();
    static class Updater { void close() {} }
    static class Web {
        final BlockingQueue<JSONObject> events = new LinkedBlockingQueue<>();
        void evaluateJavascript(String script, Object callback) {
            events.add(new JSONObject(script.substring(script.indexOf('(') + 1, script.lastIndexOf(')'))));
        }
        void removeJavascriptInterface(String name) {} void destroy() {}
    }
    void handleBackupResult(int request, int result, Intent data) { backups++; }
    void clearBackupStage() {}
    String importImage(Uri uri) throws IOException {
        imports++; importThread = Thread.currentThread().getName();
        if (decodeFailure.equals("oom")) throw new OutOfMemoryError();
        if (decodeFailure.equals("error")) throw new IOException("Decode failed");
        if (!GALLERY.toString().equals(uri.toString())) {
            imported = Files.readAllBytes(provider().openFile(uri, "r").file.toPath());
            if (!Arrays.equals(imported, PHOTO)) throw new IOException("Invalid image");
        }
        return IMAGE;
    }
    // MAIN_IMAGE_METHODS

    CameraProvider provider() { CameraProvider provider = new CameraProvider(); provider.context = this; return provider; }
    static void require(boolean value) { if (!value) throw new AssertionError(); }
    JSONObject result(String id) throws Exception {
        JSONObject result = web.events.poll(5, TimeUnit.SECONDS); require(result != null && id.equals(result.getString("requestId"))); return result;
    }
    void choose(int which) { pickImage(ID); lastDialog.choose(which); }
    void clean(File file, Uri uri) {
        require(imageRequest == null && cameraFile == null && cameraUri == null && !file.exists());
        require(revoked.get(revoked.size() - 1).toString().equals(uri.toString())); require(revokedFlags == 3);
    }
    void success(Intent intent) throws Exception {
        File file = cameraFile; Uri uri = cameraUri; Files.write(provider().openFile(uri, "w").file.toPath(), PHOTO);
        onActivityResult(TAKE_PHOTO, RESULT_OK, intent);
        require(result(ID).getString("path").equals(IMAGE)); require(Arrays.equals(imported, PHOTO));
        require("note-image-import".equals(importThread)); clean(file, uri);
    }
    interface Throwing { void run() throws Exception; }
    static void rejects(Throwing action) throws Exception {
        try { action.run(); throw new AssertionError("Expected rejection"); }
        catch (IllegalArgumentException | FileNotFoundException | UnsupportedOperationException expected) {}
    }
    public static void main(String[] args) throws Exception {
        CameraFixture app = new CameraFixture(); app.cache = Files.createTempDirectory(new File(args[1]).toPath(), "capture-").toFile();
        String test = args[0];
        switch (test) {
            case "chooser-gallery":
                app.currentTheme = "dark"; app.choose(1); require(app.lastDialog.theme == android.R.style.Theme_Material_Dialog_Alert);
                require(Arrays.equals(app.lastDialog.items, new String[]{"拍照", "从相册选择"}));
                require(app.requestCode == PICK_IMAGE && app.intents.get(0).target.equals(GalleryActivity.class.getName()));
                require(app.intents.get(0).extras.get("theme").equals("dark"));
                app.onActivityResult(PICK_IMAGE, RESULT_OK, new Intent("gallery").setData(GALLERY));
                require(app.result(ID).getString("path").equals(IMAGE) && app.imports == 1 && app.revoked.isEmpty()); break;
            case "chooser-cancel":
            case "chooser-back":
                app.pickImage(ID); if (test.equals("chooser-cancel")) app.lastDialog.negative(); else app.lastDialog.cancel();
                require(app.result(ID).getBoolean("cancelled") && app.imageRequest == null && app.intents.isEmpty()); break;
            case "camera-launch": {
                app.choose(0); Intent intent = app.intents.get(0); File file = app.cameraFile; Uri uri = app.cameraUri;
                require(intent.action.equals(MediaStore.ACTION_IMAGE_CAPTURE) && app.requestCode == TAKE_PHOTO);
                require(intent.extras.get(MediaStore.EXTRA_OUTPUT) == uri && intent.clip.uri == uri && intent.flags == 3);
                require(file.isFile() && file.length() == 0 && uri.toString().startsWith("content://com.betternotepad.android.camera/"));
                app.onActivityResult(TAKE_PHOTO, RESULT_CANCELED, null); require(app.result(ID).getBoolean("cancelled")); app.clean(file, uri); break;
            }
            case "camera-success": app.choose(0); app.success(null); break;
            case "camera-result-uri-ignored":
                app.choose(0); app.success(new Intent("camera").setData(Uri.parse("content://untrusted/thumbnail")).putExtra("data", "thumbnail")); break;
            case "camera-cancel":
            case "camera-empty":
            case "camera-decode-error":
            case "camera-decode-oom": {
                app.choose(0); File file = app.cameraFile; Uri uri = app.cameraUri;
                if (!test.equals("camera-empty")) Files.write(file.toPath(), PHOTO);
                if (test.equals("camera-decode-error")) app.decodeFailure = "error";
                if (test.equals("camera-decode-oom")) app.decodeFailure = "oom";
                boolean cancel = test.equals("camera-cancel"); app.onActivityResult(TAKE_PHOTO, cancel ? RESULT_CANCELED : RESULT_OK, null);
                JSONObject event = app.result(ID); require(cancel ? event.getBoolean("cancelled") : event.getString("error").contains("无法读取"));
                require(app.imports == (cancel ? 0 : 1)); app.clean(file, uri); break;
            }
            case "camera-missing":
            case "camera-denied":
            case "gallery-missing":
                app.failure = test.equals("camera-denied") ? "denied" : "missing"; app.choose(test.equals("gallery-missing") ? 1 : 0);
                require(app.result(ID).getString("error").contains(test.equals("gallery-missing") ? "相册" : "相机"));
                require(app.imageRequest == null && app.cameraFile == null && app.cameraUri == null && app.intents.isEmpty());
                if (!test.equals("gallery-missing")) require(new File(app.cache, "camera-capture").list().length == 0); break;
            case "camera-no-space":
                require(new File(app.cache, "camera-capture").createNewFile()); app.choose(0);
                require(app.result(ID).getString("error").contains("相机") && app.imageRequest == null && app.intents.isEmpty()); break;
            case "camera-busy":
                app.choose(0); app.pickImage(OTHER); require(app.result(OTHER).getString("error").contains("未完成"));
                require(ID.equals(app.imageRequest) && app.cameraFile.isFile() && app.intents.size() == 1);
                app.onActivityResult(TAKE_PHOTO, RESULT_CANCELED, null); require(app.result(ID).getBoolean("cancelled")); break;
            case "camera-retry": {
                app.choose(0); File first = app.cameraFile; app.onActivityResult(TAKE_PHOTO, RESULT_CANCELED, null); app.result(ID);
                app.choose(0); require(!first.equals(app.cameraFile) && !first.exists()); app.success(null); require(app.revoked.size() == 2); break;
            }
            case "camera-destroy": {
                app.choose(0); File file = app.cameraFile; Uri uri = app.cameraUri; app.onDestroy();
                require(app.isDestroyed() && !file.exists() && app.cameraFile == null && app.cameraUri == null);
                require(app.revoked.get(0) == uri); app.pickImage(OTHER); require(app.intents.size() == 1 && app.web.events.isEmpty()); break;
            }
            case "dialog-destroy":
                app.pickImage(ID); app.onDestroy(); require(app.lastDialog.dismissed && app.intents.isEmpty()); break;
            case "provider-scope": {
                app.choose(0); CameraProvider provider = app.provider(); Uri uri = app.cameraUri; File file = app.cameraFile;
                require(provider.onCreate() && provider.getType(uri).equals("image/jpeg")); Files.write(file.toPath(), PHOTO);
                MatrixCursor cursor = (MatrixCursor) provider.query(uri, null, null, null, null);
                require(cursor.values[0].equals("BetterNotepad-photo.jpg") && cursor.values[1].equals((long) PHOTO.length));
                cursor = (MatrixCursor) provider.query(uri, new String[]{"_size", "other", "_display_name"}, null, null, null);
                require(cursor.values[0].equals((long) PHOTO.length) && cursor.values[1] == null && cursor.values[2].equals("BetterNotepad-photo.jpg"));
                for (String mode : new String[]{"r", "w", "wt", "rw", "rwt"}) {
                    ParcelFileDescriptor fd = provider.openFile(uri, mode); require(fd.file.equals(file) && (fd.mode & ParcelFileDescriptor.MODE_CREATE) == 0);
                    require((fd.mode & ParcelFileDescriptor.MODE_READ_WRITE) == (mode.equals("r") ? ParcelFileDescriptor.MODE_READ_ONLY : mode.startsWith("rw") ? ParcelFileDescriptor.MODE_READ_WRITE : ParcelFileDescriptor.MODE_WRITE_ONLY));
                }
                for (String mode : new String[]{"wa", "ra", "invalid", null}) rejects(() -> provider.openFile(uri, mode));
                for (String path : new String[]{"../notebook-v1.json", "%2e%2e%2fnotebook-v1.json", "images/x.jpg", file.getName() + "?x=1", file.getName() + "#x", ID + ".apk"})
                    rejects(() -> provider.openFile(Uri.parse("content://com.betternotepad.android.camera/" + path), "w"));
                rejects(() -> provider.openFile(Uri.parse("content://other.camera/" + file.getName()), "w"));
                rejects(() -> provider.openFile(Uri.parse("file:///" + file.getName()), "w"));
                rejects(() -> provider.insert(uri, null)); rejects(() -> provider.update(uri, null, null, null)); rejects(() -> provider.delete(uri, null, null));
                app.onActivityResult(TAKE_PHOTO, RESULT_CANCELED, null); app.result(ID); rejects(() -> provider.openFile(uri, "w")); require(!file.exists()); break;
            }
            case "backup-routing":
                app.choose(0); app.onActivityResult(EXPORT_BACKUP, RESULT_OK, null); require(app.backups == 1 && app.cameraFile.isFile() && app.web.events.isEmpty());
                app.onActivityResult(TAKE_PHOTO, RESULT_CANCELED, null); app.result(ID); break;
            case "invalid-request":
                for (String id : new String[]{null, "", "../photo.jpg", "wrong"}) app.pickImage(id);
                require(app.imageRequest == null && app.lastDialog == null && app.intents.isEmpty() && app.web.events.isEmpty()); break;
            default: throw new AssertionError(test);
        }
        System.out.println("PASS " + test);
    }
}
