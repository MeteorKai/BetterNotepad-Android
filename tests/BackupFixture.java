package com.betternotepad.android;

import org.json.*;
import java.io.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.zip.*;
import java.text.SimpleDateFormat;

// JVM-only boundaries: no device, gallery or personal notebook is accessed.
public class BackupFixture {
    static final String PHOTO = "0123456789abcdef0123456789abcdef.jpg";
    static final String BIN_PHOTO = "abcdef0123456789abcdef0123456789.png";
    static final byte[] JPG = { (byte)255, (byte)216, (byte)255, 7, 8, 9, 10, 11 };
    static final byte[] PNG = { (byte)137, 80, 78, 71, 13, 10, 26, 10, 12 };
    static void check(boolean value) { if (!value) throw new AssertionError("Backup invariant failed"); }
    interface Work { void run() throws Exception; }
    static void rejects(Work work) throws Exception { try { work.run(); } catch (Exception expected) { return; } throw new AssertionError("Expected rejection"); }
    static JSONObject note(String id, String content) throws Exception {
        return new JSONObject().put("id", id).put("title", "中文 🙂 " + id).put("content", content)
            .put("format", "markdown").put("pinned", true).put("createdAt", 1).put("updatedAt", 2);
    }
    static JSONObject data() throws Exception {
        return new JSONObject().put("version", 1).put("theme", "dark").put("home", new JSONObject().put("title", "小本子").put("subtitle", ""))
            .put("notes", new JSONArray().put(note("live", "正文\n![图片](/images/" + PHOTO + ")")))
            .put("trash", new JSONArray().put(note("bin", "![图片](/images/" + BIN_PHOTO + ")").put("deletedAt", 3)));
    }
    static String manifest(JSONObject data) throws Exception {
        return new JSONObject().put("type", "betternotepad-backup").put("version", 1).put("createdAt", 100).put("notebook", data).toString();
    }
    static byte[] zip(Map<String, byte[]> entries) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(output)) {
            for (Map.Entry<String, byte[]> entry : entries.entrySet()) {
                zip.putNextEntry(new ZipEntry(entry.getKey())); zip.write(entry.getValue()); zip.closeEntry();
            }
        }
        return output.toByteArray();
    }
    static Map<String, byte[]> entries(JSONObject data) throws Exception {
        Map<String, byte[]> entries = new LinkedHashMap<>();
        entries.put("backup.json", manifest(data).getBytes(StandardCharsets.UTF_8));
        entries.put("images/" + PHOTO, JPG); entries.put("images/" + BIN_PHOTO, PNG);
        return entries;
    }
    static BackupArchive.Stage stage(byte[] bytes, File cache) throws Exception {
        return BackupArchive.read(new ByteArrayInputStream(bytes), cache);
    }
    static File root;
    File images = new File(root, "images");
    File cache = new File(root, "cache");
    final AtomicFile notebook = new AtomicFile(new File(root, "notebook-v1.json"));
    final NotebookBridge bridge = new NotebookBridge();
    String imageRequest, currentTheme = "warm";
    volatile String backupRequest;
    volatile boolean backupBusy;
    BackupArchive.Stage backupStage;
    JSONObject stagedData;
    String stagedBaseline;
    static final int EXPORT_BACKUP = 42, OPEN_BACKUP = 43, RESULT_OK = -1;
    final Web web = new Web();
    final Resolver resolver = new Resolver();
    Intent launched;
    int launchedCode;
    boolean destroyed, noPicker;
    boolean webReady;
    int widgetRefreshes;
    File getFilesDir() { return root; } File getCacheDir() { return cache; }
    Resolver getContentResolver() { return resolver; }
    boolean isDestroyed() { return destroyed; }
    void runOnUiThread(Runnable work) { work.run(); }
    void applyTheme(String theme) { currentTheme = theme; }
    void imageResult(String id, String field, Object value) { }
    void openImagePicker() { }
    void notifyResume() { }
    void refreshWidgets() { widgetRefreshes++; }
    void startActivity(Intent intent) { }
    static class WidgetConfigActivity { }
    void startActivityForResult(Intent intent, int code) {
        if (noPicker) throw new ActivityNotFoundException(); launched = intent; launchedCode = code;
    }
    static class ActivityNotFoundException extends RuntimeException { }
    static class Uri { }
    static class Intent {
        static final String ACTION_CREATE_DOCUMENT = "create", ACTION_OPEN_DOCUMENT = "open", CATEGORY_OPENABLE = "openable", EXTRA_TITLE = "title", EXTRA_MIME_TYPES = "mime";
        final String action; String type; Uri data;
        Set<String> categories = new HashSet<>(); Map<String, Object> extras = new HashMap<>();
        Intent(String action) { this.action = action; } Intent setType(String value) { type = value; return this; }
        Intent(Object context, Class<?> target) { action = target.getName(); }
        Intent addCategory(String value) { categories.add(value); return this; }
        Intent putExtra(String key, Object value) { extras.put(key, value); return this; } Uri getData() { return data; }
    }
    static class Resolver {
        byte[] input; ByteArrayOutputStream output; boolean failOutput, deleted;
        InputStream openInputStream(Uri uri) { return new ByteArrayInputStream(input); }
        OutputStream openOutputStream(Uri uri, String mode) {
            check("wt".equals(mode)); output = new ByteArrayOutputStream();
            if (!failOutput) return output;
            return new OutputStream() { public void write(int value) throws IOException { throw new IOException("disk full"); } };
        }
    }
    static class DocumentsContract { static boolean deleteDocument(Resolver resolver, Uri uri) { resolver.deleted = true; return true; } }
    static class Web {
        final List<String> events = Collections.synchronizedList(new ArrayList<>());
        void evaluateJavascript(String script, Object callback) { events.add(script); }
        JSONObject result() throws Exception {
            String script = events.get(events.size() - 1);
            return new JSONObject(script.substring(script.indexOf('(') + 1, script.lastIndexOf(')')));
        }
    }
    static class AtomicFile extends android.util.AtomicFile { AtomicFile(File base) { super(base); } }
    // MAIN_METHODS
    void waitEvent(int before) throws Exception {
        long end = System.currentTimeMillis() + 5000;
        while (web.events.size() == before && System.currentTimeMillis() < end) Thread.sleep(5);
        check(web.events.size() == before + 1);
    }
    void pick(int code) throws Exception {
        int before = web.events.size(); Intent result = new Intent("result"); result.data = new Uri();
        handleBackupResult(code, RESULT_OK, result); waitEvent(before);
    }
    void apply(String raw) throws Exception {
        int before = web.events.size(); bridge.restoreBackup(backupRequest, raw); waitEvent(before);
    }
    static final String ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    public static void main(String[] args) throws Exception {
        root = Files.createTempDirectory(Paths.get(args[1]), "case-").toFile();
        BackupFixture app = new BackupFixture(); app.images.mkdirs(); app.cache.mkdirs();
        String mode = args[0]; JSONObject original = data();
        Files.write(new File(app.images, PHOTO).toPath(), JPG); Files.write(new File(app.images, BIN_PHOTO).toPath(), PNG);
        Files.write(app.notebook.base.toPath(), original.toString().getBytes(StandardCharsets.UTF_8));
        byte[] originalBytes = app.notebook.readFully();
        if ("roundtrip".equals(mode)) {
            original.getJSONArray("notes").getJSONObject(0).put("content", original.getJSONArray("notes").getJSONObject(0).getString("content") + "\n普通文字 /images/99999999999999999999999999999999.jpg");
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            BackupArchive.write(output, manifest(original), BackupData.images(original), app.images);
            try (BackupArchive.Stage stage = stage(output.toByteArray(), app.cache)) {
                JSONObject imported = BackupData.read(stage).getJSONObject("notebook");
                check(imported.getString("theme").equals("dark"));
                check(imported.getJSONArray("notes").getJSONObject(0).getString("content").contains("普通文字 /images/99999999999999999999999999999999.jpg"));
                check(imported.getJSONArray("trash").getJSONObject(0).getBoolean("pinned"));
                check(imported.getJSONArray("trash").getJSONObject(0).getLong("deletedAt") == 3);
                check(stage.names.size() == 2 && !stage.names.get(PHOTO).equals(PHOTO));
                for (String name : BackupData.images(imported)) check(stage.images.containsKey(name));
                File fresh = new File(root, "fresh"); boolean[] committed = { false };
                BackupArchive.install(stage, BackupData.images(imported), fresh, () -> {
                    check(fresh.list().length == 2); committed[0] = true;
                });
                check(committed[0]);
                check(Arrays.equals(Files.readAllBytes(new File(fresh, stage.names.get(PHOTO)).toPath()), JPG));
            }
        } else if ("bad-paths".equals(mode)) {
            for (String name : new String[] { "../notebook-v1.json", "/images/" + PHOTO, "images\\" + PHOTO, "images/../../evil", "images/", "unrelated.txt" }) {
                Map<String, byte[]> entries = entries(original); entries.put(name, JPG);
                byte[] bytes = zip(entries); rejects(() -> stage(bytes, app.cache)); check(app.cache.list().length == 0);
            }
        } else if ("duplicate".equals(mode)) {
            String second = "11111111111111111111111111111111.jpg";
            Map<String, byte[]> entries = entries(original); entries.put("images/" + second, JPG);
            byte[] bytes = zip(entries), from = second.getBytes(StandardCharsets.UTF_8), to = PHOTO.getBytes(StandardCharsets.UTF_8);
            for (int i = 0; i <= bytes.length - from.length; i++) {
                boolean found = true; for (int j = 0; j < from.length; j++) if (bytes[i + j] != from[j]) found = false;
                if (found) System.arraycopy(to, 0, bytes, i, to.length);
            }
            rejects(() -> stage(bytes, app.cache));
        } else if ("truncated".equals(mode)) {
            byte[] valid = zip(entries(original)); rejects(() -> stage(Arrays.copyOf(valid, valid.length - 20), app.cache));
            rejects(() -> stage(new byte[] { 1, 2, 3 }, app.cache));
        } else if ("checksum".equals(mode)) {
            byte[] content = "checksum-fixture".getBytes(StandardCharsets.UTF_8); CRC32 crc = new CRC32(); crc.update(content);
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            try (ZipOutputStream zip = new ZipOutputStream(output)) {
                ZipEntry entry = new ZipEntry("backup.json"); entry.setMethod(ZipEntry.STORED); entry.setSize(content.length); entry.setCrc(crc.getValue());
                zip.putNextEntry(entry); zip.write(content); zip.closeEntry();
            }
            byte[] bytes = output.toByteArray(); bytes[30 + "backup.json".length()] ^= 1;
            rejects(() -> stage(bytes, app.cache));
        } else if ("limits".equals(mode)) {
            Map<String, byte[]> entries = new LinkedHashMap<>(); entries.put("backup.json", new byte[(int)BackupArchive.MAX_MANIFEST + 1]);
            byte[] large = zip(entries); rejects(() -> stage(large, app.cache));
            entries.clear(); entries.put("images/" + PHOTO, new byte[(int)BackupArchive.MAX_IMAGE + 1]);
            byte[] image = zip(entries); rejects(() -> stage(image, app.cache));
            rejects(() -> BackupArchive.copy(new ByteArrayInputStream(new byte[5]), new ByteArrayOutputStream(), 4));
        } else if ("schema".equals(mode)) {
            for (String raw : new String[] { "{broken", "{}", manifest(original).replace("betternotepad-backup", "other"), manifest(original).replace("\"version\":1", "\"version\":2") }) {
                Map<String, byte[]> entries = entries(original); entries.put("backup.json", raw.getBytes(StandardCharsets.UTF_8));
                try (BackupArchive.Stage stage = stage(zip(entries), app.cache)) { rejects(() -> BackupData.read(stage)); }
            }
            for (Object value : new Object[] { "3", JSONObject.NULL, true }) {
                JSONObject invalid = new JSONObject(original.toString()); invalid.getJSONArray("trash").getJSONObject(0).put("deletedAt", value);
                rejects(() -> BackupData.validate(invalid));
            }
            JSONObject duplicate = new JSONObject(original.toString()); duplicate.getJSONArray("trash").getJSONObject(0).put("id", "live");
            rejects(() -> BackupData.validate(duplicate));
        } else if ("missing-images".equals(mode)) {
            Map<String, byte[]> entries = entries(original); entries.remove("images/" + BIN_PHOTO);
            try (BackupArchive.Stage stage = stage(zip(entries), app.cache)) { rejects(() -> BackupData.read(stage)); }
            entries = entries(original); entries.put("images/99999999999999999999999999999999.jpg", JPG);
            try (BackupArchive.Stage stage = stage(zip(entries), app.cache)) { rejects(() -> BackupData.read(stage)); }
            entries = entries(original); entries.put("images/" + PHOTO, "<svg/>".getBytes(StandardCharsets.UTF_8));
            byte[] bad = zip(entries); rejects(() -> stage(bad, app.cache));
            new File(app.images, BIN_PHOTO).delete();
            rejects(() -> BackupArchive.write(new ByteArrayOutputStream(), manifest(original), BackupData.images(original), app.images));
        } else if ("rollback".equals(mode)) {
            try (BackupArchive.Stage stage = stage(zip(entries(original)), app.cache)) {
                JSONObject imported = BackupData.read(stage).getJSONObject("notebook");
                rejects(() -> BackupArchive.install(stage, BackupData.images(imported), app.images, () -> { throw new IOException("disk full"); }));
                check(app.images.list().length == 2);
                Set<String> missing = BackupData.images(imported); missing.add("99999999999999999999999999999999.jpg");
                rejects(() -> BackupArchive.install(stage, missing, app.images, () -> { throw new AssertionError("Must not commit"); }));
                check(app.images.list().length == 2); check(Arrays.equals(app.notebook.readFully(), originalBytes));
                String collision = stage.images.keySet().iterator().next(); Files.write(new File(app.images, collision).toPath(), JPG);
                rejects(() -> BackupArchive.install(stage, BackupData.images(imported), app.images, () -> { throw new AssertionError("Must not commit"); }));
                check(Arrays.equals(Files.readAllBytes(new File(app.images, collision).toPath()), JPG));
            }
        } else if ("prune".equals(mode)) {
            String orphan = "99999999999999999999999999999999.jpg"; Files.write(new File(app.images, orphan).toPath(), JPG);
            check(new JSONObject(app.bridge.load()).getBoolean("ok"));
            check(new File(app.images, PHOTO).isFile() && new File(app.images, BIN_PHOTO).isFile() && !new File(app.images, orphan).exists());
            original.put("trash", new JSONArray()); Files.write(app.notebook.base.toPath(), original.toString().getBytes(StandardCharsets.UTF_8));
            app.bridge.load(); check(!new File(app.images, BIN_PHOTO).exists());
        } else if ("shared-image".equals(mode)) {
            original.getJSONArray("trash").getJSONObject(0).put("content", "![图片](/images/" + PHOTO + ")");
            check(BackupData.images(original).size() == 1);
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            BackupArchive.write(output, manifest(original), BackupData.images(original), app.images);
            try (BackupArchive.Stage stage = stage(output.toByteArray(), app.cache)) {
                JSONObject incoming = BackupData.read(stage).getJSONObject("notebook");
                check(stage.images.size() == 1 && BackupData.images(incoming).size() == 1);
            }
            original.put("trash", new JSONArray());
            Files.write(app.notebook.base.toPath(), original.toString().getBytes(StandardCharsets.UTF_8));
            app.bridge.load(); check(new File(app.images, PHOTO).isFile() && !new File(app.images, BIN_PHOTO).exists());
        } else if ("note-metadata".equals(mode)) {
            original.put("manualOrder", true);
            original.getJSONArray("notes").put(note("second", "另一篇便签").put("updatedAt", 100));
            JSONArray tags = new JSONArray().put("工作").put("中文 🙂");
            JSONArray todos = new JSONArray().put(new JSONObject().put("id", "task1").put("text", "待办中文 ✅").put("done", false))
                .put(new JSONObject().put("id", "task2").put("text", "").put("done", true));
            original.getJSONArray("notes").getJSONObject(0).put("tags", tags).put("todos", todos);
            original.getJSONArray("trash").getJSONObject(0).put("tags", tags).put("todos", todos);
            Files.write(app.notebook.base.toPath(), original.toString().getBytes(StandardCharsets.UTF_8));
            app.bridge.exportBackup(ID); app.pick(EXPORT_BACKUP);
            app.resolver.input = app.resolver.output.toByteArray(); app.bridge.openBackup(ID); app.pick(OPEN_BACKUP);
            String incoming = new JSONObject(app.bridge.readBackup(ID)).getString("data");
            app.apply(incoming); check(app.web.result().getString("phase").equals("restored"));
            JSONObject restored = new JSONObject(app.readNotebook());
            check(restored.getBoolean("manualOrder"));
            check(restored.getJSONArray("notes").getJSONObject(0).getString("id").equals("live"));
            check(restored.getJSONArray("notes").getJSONObject(1).getString("id").equals("second"));
            for (String key : new String[] { "notes", "trash" }) {
                check(restored.getJSONArray(key).getJSONObject(0).getJSONArray("tags").toString().equals(tags.toString()));
                check(restored.getJSONArray(key).getJSONObject(0).getJSONArray("todos").toString().equals(todos.toString()));
            }
        } else if ("bad-metadata".equals(mode)) {
            for (Object order : new Object[] { JSONObject.NULL, "true", 1, new JSONArray(), new JSONObject() }) {
                JSONObject invalid = new JSONObject(original.toString()); invalid.put("manualOrder", order);
                rejects(() -> BackupData.validate(invalid));
            }
            for (Object tags : new Object[] { JSONObject.NULL, new JSONArray().put(3), new JSONArray().put("标签").put("标签"), new JSONArray().put("　标签"),
                new JSONArray().put("标签\n"), new JSONArray().put(""), new JSONArray().put("长长长长长长长长长长长长长长长长长长长长长") }) {
                JSONObject invalid = new JSONObject(original.toString()); invalid.getJSONArray("notes").getJSONObject(0).put("tags", tags);
                rejects(() -> BackupData.validate(invalid));
            }
            for (Object todos : new Object[] { JSONObject.NULL, new JSONArray().put(JSONObject.NULL), new JSONArray().put(new JSONObject().put("id", "").put("text", "x").put("done", false)),
                new JSONArray().put(new JSONObject().put("id", "t").put("text", 1).put("done", false)),
                new JSONArray().put(new JSONObject().put("id", "t").put("text", "x").put("done", "yes")) }) {
                JSONObject invalid = new JSONObject(original.toString()); invalid.getJSONArray("trash").getJSONObject(0).put("todos", todos);
                rejects(() -> BackupData.validate(invalid));
            }
            check(Arrays.equals(originalBytes, app.notebook.readFully()));
        } else if ("checked-bridge".equals(mode)) {
            JSONObject loaded = new JSONObject(app.bridge.load()); String revision = loaded.getString("revision");
            original.getJSONArray("notes").getJSONObject(0).put("todos", new JSONArray().put(new JSONObject().put("id", "t").put("text", "桌面任务").put("done", false)));
            JSONObject saved = new JSONObject(app.bridge.saveChecked(original.toString(), revision));
            check(saved.getBoolean("ok") && app.widgetRefreshes == 1);
            NotebookStore.setTodo(app.notebook, "live", "t", true); String desktop = app.readNotebook();
            check(new JSONObject(app.bridge.saveChecked(original.toString(), saved.getString("revision"))).getBoolean("conflict"));
            check(app.readNotebook().equals(desktop) && app.widgetRefreshes == 1);
            app.notebook.fail = true;
            check(!new JSONObject(app.bridge.saveChecked(desktop, NotebookStore.revision(desktop))).getBoolean("ok"));
            check(app.readNotebook().equals(desktop) && app.widgetRefreshes == 1);
        } else if ("widget-during-preview".equals(mode)) {
            original.getJSONArray("notes").getJSONObject(0).put("todos", new JSONArray().put(new JSONObject().put("id", "t").put("text", "桌面任务").put("done", false)));
            app.writeNotebook(original.toString());
            app.bridge.exportBackup(ID); app.pick(EXPORT_BACKUP); app.resolver.input = app.resolver.output.toByteArray();
            app.bridge.openBackup(ID); app.pick(OPEN_BACKUP); String staged = new JSONObject(app.bridge.readBackup(ID)).getString("data");
            NotebookStore.setTodo(app.notebook, "live", "t", true); String latest = app.readNotebook(); app.apply(staged);
            check(app.web.result().has("error") && app.readNotebook().equals(latest) && app.widgetRefreshes == 0);
            check(app.images.list().length == 2);
        } else if ("native-flow".equals(mode)) {
            app.bridge.exportBackup(ID); check(app.launchedCode == EXPORT_BACKUP && app.backupBusy);
            check("application/zip".equals(app.launched.type) && app.launched.categories.contains("openable"));
            check(app.launched.extras.get("title").toString().endsWith(".zip"));
            check(!new JSONObject(app.bridge.save(original.toString())).getBoolean("ok"));
            app.pick(EXPORT_BACKUP); check(app.web.result().getString("phase").equals("exported"));
            app.resolver.input = app.resolver.output.toByteArray(); app.bridge.openBackup(ID);
            check(app.launchedCode == OPEN_BACKUP && app.launched.extras.containsKey("mime"));
            app.pick(OPEN_BACKUP); JSONObject preview = app.web.result();
            check(preview.getInt("notes") == 1 && preview.getInt("trash") == 1 && preview.getInt("images") == 2);
            check(Arrays.equals(originalBytes, app.notebook.readFully()));
            check(!new JSONObject(app.bridge.readBackup("wrong")).getBoolean("ok"));
            JSONObject incoming = new JSONObject(new JSONObject(app.bridge.readBackup(ID)).getString("data"));
            app.notebook.fail = true; app.apply(incoming.toString());
            check(app.web.result().has("error") && app.backupStage != null && !app.backupBusy);
            check(app.images.list().length == 2 && Arrays.equals(originalBytes, app.notebook.readFully()));
            app.notebook.fail = false; app.apply(incoming.toString()); check(app.web.result().getString("phase").equals("restored"));
            check(app.widgetRefreshes == 1);
            check(app.backupStage == null && app.backupRequest == null && app.cache.list().length == 0);
            check(new JSONObject(app.bridge.load()).getBoolean("ok"));
            check(app.images.list().length == 2);
            check(new JSONObject(app.readNotebook()).getJSONArray("trash").getJSONObject(0).getString("content").equals(incoming.getJSONArray("trash").getJSONObject(0).getString("content")));
        } else if ("native-cancel".equals(mode)) {
            app.bridge.openBackup(ID); app.handleBackupResult(OPEN_BACKUP, 0, null); check(app.web.result().getBoolean("cancelled"));
            check(app.backupRequest == null && !app.backupBusy);
            app.noPicker = true; app.bridge.exportBackup(ID); check(app.web.result().has("error") && app.backupRequest == null);
            app.noPicker = false; app.resolver.input = zip(entries(original)); app.bridge.openBackup(ID); app.pick(OPEN_BACKUP);
            app.bridge.discardBackup("wrong"); check(app.backupStage != null);
            app.bridge.discardBackup(ID); check(app.backupStage == null && app.cache.list().length == 0);
            check(Arrays.equals(originalBytes, app.notebook.readFully()));
        } else if ("native-empty".equals(mode)) {
            app.notebook.base.delete();
            app.bridge.exportBackup(ID); app.pick(EXPORT_BACKUP);
            app.resolver.input = app.resolver.output.toByteArray(); app.bridge.openBackup(ID); app.pick(OPEN_BACKUP);
            JSONObject preview = app.web.result();
            check(preview.getInt("notes") == 0 && preview.getInt("trash") == 0 && preview.getInt("images") == 0);
            String incoming = new JSONObject(app.bridge.readBackup(ID)).getString("data");
            app.apply(incoming); check(app.web.result().getString("phase").equals("restored"));
            check(new JSONObject(app.bridge.load()).getBoolean("ok"));
            check(new JSONObject(app.readNotebook()).getJSONArray("notes").length() == 0 && app.images.list().length == 0);
        } else if ("native-error".equals(mode)) {
            app.resolver.failOutput = true; app.bridge.exportBackup(ID); app.pick(EXPORT_BACKUP);
            check(app.web.result().has("error") && app.resolver.deleted && app.backupRequest == null);
            check(Arrays.equals(originalBytes, app.notebook.readFully()));
            app.resolver.input = new byte[] { 1, 2, 3 }; app.bridge.openBackup(ID); app.pick(OPEN_BACKUP);
            check(app.web.result().has("error") && app.backupStage == null && app.cache.list().length == 0);
            app.resolver.input = zip(entries(original)); app.bridge.openBackup(ID); app.pick(OPEN_BACKUP);
            String incoming = new JSONObject(app.bridge.readBackup(ID)).getString("data");
            JSONObject changed = new JSONObject(original.toString()).put("theme", "light");
            check(new JSONObject(app.bridge.save(changed.toString())).getBoolean("ok"));
            app.apply(incoming); check(app.web.result().has("error"));
            check(new JSONObject(app.readNotebook()).getString("theme").equals("light") && app.images.list().length == 2);
            app.bridge.discardBackup(ID);
        } else throw new AssertionError("Unknown case " + mode);
        System.out.println("PASS " + mode);
    }
}
