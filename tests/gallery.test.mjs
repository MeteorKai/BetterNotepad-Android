import test, { before } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const directory = fileURLToPath(new URL("../build/gallery-tests/", import.meta.url));
const source = readFileSync(new URL("../android/app/src/main/java/com/betternotepad/android/GalleryActivity.java", import.meta.url), "utf8");
let java;
before(() => {
  const methods = ["onCreate", "imagePermissions", "imageAccess", "requestImageAccess", "onRequestPermissionsResult", "onResume", "onPause", "clearPhotos", "refreshPhotos", "loadMore", "imageCollection", "queryPage", "queryAlbums", "albumLabel", "chooseAlbum", "selectAlbum", "loadNearEnd", "onActivityResult", "selectPhoto"].map(name => {
    const method = source.match(new RegExp(`^    (?:@Override )?(?:public|protected|private) [^\\n]*?\\b${name}\\([^\\n]*\\) \\{[\\s\\S]*?^    \\}`, "m"))?.[0];
    assert.ok(method, `Native gallery method missing: ${name}`);
    return method;
  }).join("\n");
  const photo = source.match(/    private static final class Photo \{[\s\S]*?\n    \}/)?.[0];
  assert.ok(photo);
  const album = source.match(/    private static final class Album \{[\s\S]*?\n    \}/)?.[0];
  assert.ok(album);
  const jdk = [process.env.JAVA_HOME, "C:/Program Files/Java/jdk-17"].find(home => home && existsSync(join(home, "bin/javac.exe")));
  assert.ok(jdk, "原生相册测试需要 JDK 17");
  java = join(jdk, "bin/java.exe");
  mkdirSync(directory, { recursive: true });
  const fixture = join(directory, "GalleryFixture.java");
  // Actual production permission, lifecycle, paging and result methods.
  // Android UI/provider boundaries are faked; no personal photos are accessed.
  writeFileSync(fixture, `import java.util.*;
class Activity {
    static final int RESULT_OK = -1;
    public void onCreate(GalleryFixture.Bundle state) { }
    public void onRequestPermissionsResult(int code, String[] permissions, int[] results) { }
    protected void onResume() { }
    protected void onPause() { }
    protected void onActivityResult(int code, int result, GalleryFixture.Intent data) { }
}
public class GalleryFixture extends Activity {
    static final int PERMISSIONS = 42, PICK_IMAGE = 41, PAGE_SIZE = 60, NONE = 0, PARTIAL = 1, FULL = 2;
    static class Manifest { static class permission {
        static final String READ_MEDIA_IMAGES = "images", READ_MEDIA_VISUAL_USER_SELECTED = "selected", READ_EXTERNAL_STORAGE = "legacy";
    } }
    static class Build { static class VERSION { static int SDK_INT = 34; } }
    static class PackageManager { static final int PERMISSION_GRANTED = 0; }
    static class View { static final int VISIBLE = 0, GONE = 8; }
    static class Button { int visibility; String text; boolean enabled; void setVisibility(int value) { visibility = value; } void setText(String value) { text = value; } void setEnabled(boolean value) { enabled = value; } }
    static class Grid { int selection; void setSelection(int position) { selection = position; } }
    static class CancellationSignal {
        boolean cancelled;
        void cancel() { cancelled = true; }
        void throwIfCanceled() { if (cancelled) throw new IllegalStateException("cancelled"); }
    }
    static class Task {
        boolean cancelled; Runnable work;
        void cancel(boolean interrupt) { cancelled = interrupt; }
        void run() { if (!cancelled && work != null) work.run(); }
    }
    static class ThumbnailJob { boolean cancelled; void cancel() { cancelled = true; } }
    static class Cache { int clears; void evictAll() { clears++; } }
    static class Pool {
        int purges, submissions; final ArrayDeque<Task> pending = new ArrayDeque<>();
        void purge() { purges++; }
        Task submit(Runnable work) { Task task = new Task(); task.work = work; submissions++; pending.add(task); return task; }
    }
    static class Dialog {
        String[] labels; int checked; boolean dismissed; AlertDialog.Choice choice;
        void dismiss() { dismissed = true; }
        void choose(int index) { choice.select(this, index); }
    }
    static class AlertDialog {
        interface Choice { void select(Dialog dialog, int index); }
        static class Builder {
            final GalleryFixture app; final Dialog dialog = new Dialog();
            Builder(GalleryFixture app) { this.app = app; }
            Builder setTitle(String text) { return this; }
            Builder setSingleChoiceItems(String[] labels, int checked, Choice choice) { dialog.labels = labels; dialog.checked = checked; dialog.choice = choice; return this; }
            Builder setNegativeButton(String text, Object listener) { return this; }
            void show() { app.dialog = dialog; }
        }
    }
    static class Adapter { void notifyDataSetChanged() { } }
    static class Uri {
        final String value;
        Uri(String value) { this.value = value; }
        public String toString() { return value; }
    }
    static class Intent {
        static final int FLAG_GRANT_READ_URI_PERMISSION = 1;
        Uri data; int flags;
        Intent setData(Uri data) { this.data = data; return this; }
        Intent addFlags(int flags) { this.flags |= flags; return this; }
        Uri getData() { return data; }
    }
    static class ContentUris { static Uri withAppendedId(Uri base, long id) { return new Uri(base + "/" + id); } }
    static class MediaStore {
        static final String VOLUME_EXTERNAL = "external";
        static class Images { static class Media {
            static final String DATE_ADDED = "date_added", _ID = "_id", DISPLAY_NAME = "_display_name", BUCKET_ID = "bucket_id", BUCKET_DISPLAY_NAME = "bucket_display_name";
            static final Uri EXTERNAL_CONTENT_URI = new Uri("content://media/external/images/media");
            static int volumeCalls;
            static Uri getContentUri(String volume) { check(volume.equals("external"), "external volume"); volumeCalls++; return EXTERNAL_CONTENT_URI; }
        } }
    }
    static class Bundle extends HashMap<String, Object> {
        void putInt(String key, int value) { put(key, value); }
        void putString(String key, String value) { put(key, value); }
        void putStringArray(String key, String[] value) { put(key, value); }
        boolean getBoolean(String key) { return Boolean.TRUE.equals(get(key)); }
        String getString(String key) { return (String) get(key); }
    }
    static class Cursor implements AutoCloseable {
        final List<Photo> rows; final Map<Long, String[]> folders; final boolean albumMode;
        int index = -1; boolean closed;
        Cursor(List<Photo> rows, Map<Long, String[]> folders, boolean albumMode) { this.rows = rows; this.folders = folders; this.albumMode = albumMode; }
        boolean moveToNext() { return ++index < rows.size(); }
        long getLong(int column) { return column == 0 ? rows.get(index).id : rows.get(index).added; }
        String getString(int column) {
            if (albumMode) return folders.getOrDefault(rows.get(index).id, new String[] { "camera", "Camera" })[column];
            check(column == 2, "name projection"); return rows.get(index).name;
        }
        public void close() { closed = true; }
    }
    static class ContentResolver {
        static final String QUERY_ARG_LIMIT = "limit", QUERY_ARG_SORT_COLUMNS = "sort", QUERY_ARG_SORT_DIRECTION = "direction", QUERY_ARG_SQL_SORT_ORDER = "sql-sort", QUERY_ARG_SQL_SELECTION = "selection", QUERY_ARG_SQL_SELECTION_ARGS = "args";
        static final int QUERY_SORT_DIRECTION_DESCENDING = 1;
        final List<Photo> rows = new ArrayList<>();
        final Map<Long, String[]> folders = new HashMap<>();
        final List<Cursor> cursors = new ArrayList<>();
        Set<Long> visibleIds; int albumQueries;
        Bundle lastArgs; Cursor lastCursor; boolean unavailable, legacySortOnly;
        Cursor query(Uri collection, String[] projection, Bundle args, CancellationSignal signal) {
            check(collection.toString().equals(MediaStore.Images.Media.EXTERNAL_CONTENT_URI.toString()), "collection");
            boolean albumMode = Arrays.equals(projection, new String[] { "bucket_id", "bucket_display_name" });
            if (albumMode) { albumQueries++; check(!args.containsKey(QUERY_ARG_LIMIT), "albums must not be limited to the first photo page"); }
            else { check(Arrays.equals(projection, new String[] { "_id", "date_added", "_display_name" }), "minimal photo projection"); check((Integer) args.get(QUERY_ARG_LIMIT) == PAGE_SIZE, "structured page limit"); }
            lastArgs = args;
            if (unavailable) return null;
            ArrayList<Photo> visible = new ArrayList<>(rows);
            if (visibleIds != null) visible.removeIf(row -> !visibleIds.contains(row.id));
            if (args.containsKey(QUERY_ARG_SQL_SORT_ORDER)) {
                check(args.get(QUERY_ARG_SQL_SORT_ORDER).equals("date_added DESC, _id DESC"), "explicit SQL descending sort");
                visible.sort((a, b) -> a.added == b.added ? Long.compare(b.id, a.id) : Long.compare(b.added, a.added));
            } else if (legacySortOnly) visible.sort((a, b) -> Long.compare(a.id, b.id));
            else {
                check(Arrays.equals((String[]) args.get(QUERY_ARG_SORT_COLUMNS), new String[] { "date_added", "_id" }), "stable sort columns");
                visible.sort((a, b) -> a.added == b.added ? Long.compare(b.id, a.id) : Long.compare(b.added, a.added));
            }
            if (args.containsKey(QUERY_ARG_SQL_SELECTION)) {
                String selection = (String) args.get(QUERY_ARG_SQL_SELECTION);
                String[] values = (String[]) args.get(QUERY_ARG_SQL_SELECTION_ARGS);
                int offset = 0;
                if (selection.startsWith("bucket_id = ?")) {
                    String bucket = values[offset++];
                    visible.removeIf(row -> !Objects.equals(folders.getOrDefault(row.id, new String[] { "camera", "Camera" })[0], bucket));
                    selection = selection.substring("bucket_id = ?".length());
                } else if (selection.startsWith("bucket_id IS NULL")) {
                    visible.removeIf(row -> folders.getOrDefault(row.id, new String[] { "camera", "Camera" })[0] != null);
                    selection = selection.substring("bucket_id IS NULL".length());
                }
                if (selection.startsWith(" AND ")) selection = selection.substring(5);
                if (!selection.isEmpty()) {
                    check(selection.equals("(date_added < ? OR (date_added = ? AND _id < ?))"), "parenthesized keyset selection");
                    check(values[offset].equals(values[offset + 1]), "date tie argument");
                    long date = Long.parseLong(values[offset]), id = Long.parseLong(values[offset + 2]);
                    visible.removeIf(row -> !(row.added < date || (row.added == date && row.id < id)));
                    offset += 3;
                }
                check(offset == values.length, "selection arguments are bound, not interpolated");
            }
            // Deliberately ignore LIMIT like a legacy provider. Production must
            // still cap reads and close its cursor.
            lastCursor = new Cursor(visible, folders, albumMode); cursors.add(lastCursor); return lastCursor;
        }
    }
    final Set<String> allowed = new HashSet<>();
    final ArrayList<Photo> photos = new ArrayList<>();
    final ArrayList<Album> albums = new ArrayList<>();
    final Set<ThumbnailJob> jobs = new HashSet<>();
    final Button status = new Button(), grant = new Button(), permissionSettings = new Button(), more = new Button(), albumPicker = new Button();
    final Grid grid = new Grid(); final Pool queries = new Pool(); final ArrayDeque<Runnable> ui = new ArrayDeque<>();
    final Cache cache = new Cache(); final Pool thumbnails = new Pool(); final Adapter adapter = new Adapter();
    final ContentResolver resolver = new ContentResolver();
    CancellationSignal querySignal; Task queryTask;
    boolean asking, loading, hasMore, albumsLoaded, finished, pageCreated;
    String selectedAlbum; Dialog dialog;
    int generation, requests, resultCode; Intent result;
    String[] requested;
    int checkSelfPermission(String permission) { return allowed.contains(permission) ? 0 : -1; }
    void requestPermissions(String[] permissions, int code) { check(pageCreated && code == PERMISSIONS, "contextual permission request"); requested = permissions; requests++; }
    void createPage() { pageCreated = true; }
    void runOnUiThread(Runnable work) { ui.add(work); }
    boolean isFinishing() { return finished; }
    boolean isDestroyed() { return false; }
    void drain() {
        int steps = 0;
        while (!queries.pending.isEmpty() || !ui.isEmpty()) {
            check(++steps < 1000, "bounded async work");
            if (!queries.pending.isEmpty()) queries.pending.remove().run();
            while (!ui.isEmpty()) ui.remove().run();
        }
    }
    ContentResolver getContentResolver() { return resolver; }
    void setResult(int code, Intent data) { resultCode = code; result = data; }
    void finish() { finished = true; }
${photo}
${album}
${methods}
    static void check(boolean condition, String message) { if (!condition) throw new AssertionError(message); }
    static void sample(GalleryFixture app, int count) {
        for (int id = 1; id <= count; id++) app.resolver.rows.add(new Photo(id, id / 2, "photo" + id, new Uri("sample/" + id)));
    }
    public static void main(String[] args) {
        GalleryFixture app = new GalleryFixture();
        switch (args[0]) {
        case "permissions":
            for (int sdk : new int[] { 26, 32, 33, 34, 36 }) {
                Build.VERSION.SDK_INT = sdk;
                String[] expected = sdk >= 34 ? new String[] { "images", "selected" } : sdk >= 33 ? new String[] { "images" } : new String[] { "legacy" };
                check(Arrays.equals(app.imagePermissions(), expected), "SDK-specific image-only permissions");
            }
            break;
        case "access":
            for (int sdk : new int[] { 26, 32, 33, 34, 36 }) {
                Build.VERSION.SDK_INT = sdk;
                app.allowed.clear(); check(app.imageAccess() == NONE, "denied");
                app.allowed.add(sdk >= 33 ? "images" : "legacy"); check(app.imageAccess() == FULL, "full");
                app.allowed.add("selected"); check(app.imageAccess() == FULL, "full takes precedence");
                app.allowed.remove(sdk >= 33 ? "images" : "legacy");
                check(app.imageAccess() == (sdk >= 34 ? PARTIAL : NONE), "partial only on Android 14+");
            }
            break;
        case "request":
            app.onCreate(null); app.onResume(); app.requestImageAccess();
            check(app.requests == 1 && app.queries.submissions == 0 && app.asking, "no repeated prompt or pre-consent query");
            app.allowed.add("images"); app.onRequestPermissionsResult(PERMISSIONS, app.requested, new int[] { 0, 0 });
            check(!app.asking && app.queries.submissions == 1 && app.grant.visibility == View.GONE, "full grant loads the gallery");
            break;
        case "restore":
            Bundle state = new Bundle(); state.put("asking", true);
            app.onCreate(state); app.onResume();
            check(app.requests == 0 && app.queries.submissions == 0, "recreated prompt is not requested again");
            app.allowed.add("selected"); app.onRequestPermissionsResult(PERMISSIONS, new String[0], new int[0]);
            check(app.queries.submissions == 1 && app.grant.visibility == View.VISIBLE && app.status.text.contains("仅显示"), "partial grant keeps reselect controls");
            break;
        case "denial":
            app.onCreate(null); app.onRequestPermissionsResult(PERMISSIONS, app.requested, new int[] { -1, -1 }); app.onResume();
            check(app.queries.submissions == 0 && !app.asking && app.permissionSettings.visibility == View.VISIBLE && app.status.text.contains("系统选图"), "denial has a usable fallback without querying");
            break;
        case "revoke":
            app.allowed.add("images"); app.onCreate(null); app.onResume();
            check(app.requests == 0 && app.queries.submissions == 1, "existing full grant is not requested again");
            app.photos.add(new Photo(1, 1, "old", new Uri("old")));
            ThumbnailJob job = new ThumbnailJob(); app.jobs.add(job);
            app.querySignal = new CancellationSignal(); app.queryTask = new Task(); app.loading = true;
            app.onPause();
            check(job.cancelled && app.querySignal.cancelled && app.queryTask.cancelled && app.photos.isEmpty() && app.jobs.isEmpty() && !app.loading && app.cache.clears > 0, "pause clears thumbnails, jobs and data");
            app.allowed.clear(); app.allowed.add("selected"); app.onResume();
            check(app.queries.submissions == 2 && app.grant.visibility == View.VISIBLE, "downgrade to partial refreshes the gallery");
            app.allowed.clear(); app.onResume();
            check(app.queries.submissions == 2 && app.status.text.contains("尚未允许"), "revocation stops new queries");
            break;
        case "page":
            sample(app, 125); List<Photo> first = app.queryPage(null, null, new CancellationSignal());
            check(first.size() == 60 && first.get(0).id == 125 && app.resolver.lastCursor.closed && MediaStore.Images.Media.volumeCalls == 1, "bounded, closed, aggregated first page");
            Build.VERSION.SDK_INT = 26; app.queryPage(null, null, new CancellationSignal());
            check(MediaStore.Images.Media.volumeCalls == 1, "old API does not call new volume API");
            break;
        case "compat-sort":
            sample(app, 3000); app.resolver.legacySortOnly = true;
            List<Photo> compatible = app.queryPage(null, null, new CancellationSignal());
            check(compatible.size() == 60 && compatible.get(0).id == 3000 && compatible.get(59).id == 2941, "provider ignoring structured sort must still return newest first");
            break;
        case "large-gallery":
            sample(app, 3000); app.allowed.add("images"); app.resolver.legacySortOnly = true;
            app.refreshPhotos(); app.drain();
            check(app.albumPicker.text.contains("3000") && app.photos.size() == 60 && app.photos.get(0).id == 3000 && app.hasMore, "total count is not confused with first page size");
            app.loadNearEnd(0, 9, 60); check(app.queries.submissions == 1, "scrolling near the start does not fetch");
            app.loadNearEnd(52, 9, 60); app.loadNearEnd(52, 9, 60);
            check(app.queries.submissions == 2, "near-end load is deduplicated while in progress"); app.drain();
            check(app.photos.size() == 120 && app.photos.get(119).id == 2881, "scroll loads the next newest page");
            while (app.hasMore) { app.loadNearEnd(app.photos.size() - 9, 9, app.photos.size()); app.drain(); }
            Set<Long> loaded = new HashSet<>(); for (Photo item : app.photos) check(loaded.add(item.id), "no duplicate on automatic loading");
            check(loaded.size() == 3000 && app.photos.get(2999).id == 1 && app.more.visibility == View.GONE && app.resolver.albumQueries == 1, "all pages load once without rescanning album metadata");
            int submissions = app.queries.submissions; app.loadNearEnd(2991, 9, 3000);
            check(app.queries.submissions == submissions && app.resolver.cursors.stream().allMatch(cursor -> cursor.closed), "loading stops and all cursors are closed");
            break;
        case "albums":
            sample(app, 180); app.allowed.add("images");
            for (long id = 1; id <= 180; id++) app.resolver.folders.put(id, id <= 120 ? new String[] { "cam'era", "Camera" } : new String[] { "shots", "Screenshots" });
            app.refreshPhotos(); app.drain(); app.chooseAlbum();
            check(app.dialog.labels.length == 3 && app.dialog.labels[0].contains("180") && app.dialog.labels[1].equals("Screenshots（60）") && app.dialog.labels[2].equals("Camera（120）"), "all albums and counts include photos beyond the first page");
            app.dialog.choose(2); app.drain();
            check(app.dialog.dismissed && app.selectedAlbum.equals("cam'era") && app.photos.size() == 60 && app.photos.get(0).id == 120 && app.grid.selection == 0, "dialog selection resets grid and filters the chosen album using bound arguments");
            app.loadNearEnd(52, 9, 60); app.drain();
            check(app.photos.size() == 120 && app.photos.get(119).id == 1, "album filter and date-tie pagination stay combined");
            app.chooseAlbum(); check(app.dialog.checked == 2, "dialog reflects current album");
            app.dialog.choose(0); app.drain();
            check(app.selectedAlbum == null && app.photos.get(0).id == 180 && app.albumPicker.text.contains("180"), "all photos can be restored after choosing an album");
            break;
        case "unknown-album":
            sample(app, 3); app.allowed.add("images");
            app.resolver.folders.put(1L, new String[] { null, null }); app.resolver.folders.put(2L, new String[] { "unknown", " " });
            List<Album> unknown = app.queryAlbums(new CancellationSignal());
            check(unknown.size() == 3 && unknown.get(1).name.equals("其他图片") && unknown.get(2).id.isEmpty(), "null or blank album metadata gets a readable fallback");
            List<Photo> unfiled = app.queryPage(null, "", new CancellationSignal());
            check(unfiled.size() == 1 && unfiled.get(0).id == 1, "null bucket filtering is not confused with all photos");
            break;
        case "album-revocation":
            sample(app, 180); app.allowed.add("images");
            for (long id = 121; id <= 180; id++) app.resolver.folders.put(id, new String[] { "shots", "Screenshots" });
            app.selectedAlbum = "shots"; app.refreshPhotos(); app.drain(); check(app.albumPicker.text.equals("Screenshots（60） ▾"), "selected album survives refresh");
            app.allowed.clear(); app.allowed.add("selected"); app.resolver.visibleIds = new HashSet<>(Arrays.asList(1L, 2L, 3L));
            app.refreshPhotos(); app.drain();
            check(app.selectedAlbum == null && app.albumPicker.enabled && app.albumPicker.text.contains("已授权") && app.albumPicker.text.contains("3") && app.photos.size() == 3 && app.status.text.contains("仅部分"), "removed album falls back to only authorized photos and keeps album control usable");
            app.allowed.clear(); app.refreshPhotos(); app.drain();
            check(app.photos.isEmpty() && app.albums.isEmpty() && !app.albumPicker.enabled && !app.hasMore, "revocation clears stale photos and albums");
            break;
        case "stale-page":
            sample(app, 180); app.allowed.add("images");
            for (long id = 121; id <= 180; id++) app.resolver.folders.put(id, new String[] { "shots", "Screenshots" });
            app.refreshPhotos(); app.drain(); app.loadMore(); app.queries.pending.remove().run();
            check(!app.ui.isEmpty(), "old page callback pending");
            app.selectAlbum("shots"); app.drain();
            check(app.photos.size() == 60 && app.photos.get(0).id == 180 && app.photos.get(59).id == 121 && app.albumPicker.text.startsWith("Screenshots"), "old all-photo page never mixes into a new album");
            break;
        case "async-permission":
            sample(app, 180); app.allowed.add("images"); app.refreshPhotos(); app.queries.pending.remove().run();
            app.allowed.clear(); app.allowed.add("selected"); app.resolver.visibleIds = new HashSet<>(Arrays.asList(1L, 2L)); app.drain();
            check(app.photos.size() == 2 && app.albumPicker.text.contains("已授权") && app.albumPicker.text.contains("2") && app.status.text.contains("仅部分"), "pending full-access query is discarded on partial access");
            break;
        case "async-retry":
            sample(app, 125); app.allowed.add("images"); app.resolver.unavailable = true; app.refreshPhotos(); app.drain();
            check(!app.loading && !app.hasMore && app.more.enabled && app.more.text.contains("重试"), "failed metadata query has a retry rather than an automatic retry loop");
            app.resolver.unavailable = false; app.loadMore(); app.drain();
            check(app.photos.size() == 60 && app.albumPicker.enabled && app.albumPicker.text.contains("125"), "manual retry restores album discovery and photo loading");
            break;
        case "album-cancel":
            sample(app, 2); CancellationSignal cancelledAlbum = new CancellationSignal(); cancelledAlbum.cancel();
            try { app.queryAlbums(cancelledAlbum); throw new AssertionError("cancelled album query accepted"); } catch (IllegalStateException expected) { check(app.resolver.lastCursor.closed, "cancelled album cursor is closed"); }
            break;
        case "pagination":
            sample(app, 125); List<Photo> all = new ArrayList<>(), page = app.queryPage(null, null, new CancellationSignal()); all.addAll(page);
            app.resolver.rows.add(new Photo(126, 63, "new", new Uri("new")));
            do { page = app.queryPage(all.get(all.size() - 1), null, new CancellationSignal()); all.addAll(page); } while (page.size() == PAGE_SIZE);
            Set<Long> ids = new HashSet<>(); for (Photo item : all) check(ids.add(item.id), "no duplicate across date ties");
            check(ids.size() == 125 && !ids.contains(126L) && all.get(124).id == 1, "stable paging while new photos arrive");
            break;
        case "empty":
            check(app.queryPage(null, null, new CancellationSignal()).isEmpty() && app.resolver.lastCursor.closed, "empty cursor is closed");
            break;
        case "unavailable":
            app.resolver.unavailable = true;
            try { app.queryPage(null, null, new CancellationSignal()); throw new AssertionError("missing cursor accepted"); } catch (IllegalStateException expected) { check(expected.getMessage().equals("No media cursor"), "query failure is reported"); }
            break;
        case "cancel":
            sample(app, 2); CancellationSignal signal = new CancellationSignal(); signal.cancel();
            try { app.queryPage(null, null, signal); throw new AssertionError("cancelled query accepted"); } catch (IllegalStateException expected) { check(app.resolver.lastCursor.closed, "cancelled cursor is closed"); }
            break;
        case "select":
            app.allowed.add("images"); app.photos.add(new Photo(1, 1, "chosen", new Uri("chosen"))); app.selectPhoto(0);
            check(app.finished && app.resultCode == RESULT_OK && app.result.getData().toString().equals("chosen") && app.result.flags == 1, "selected image is returned to the note importer");
            break;
        case "invalid-selection":
            app.allowed.add("images"); app.selectPhoto(0); check(!app.finished && app.result == null, "stale grid index is ignored");
            app.allowed.clear(); app.photos.add(new Photo(1, 1, "old", new Uri("old"))); app.selectPhoto(0);
            check(!app.finished && app.result == null && app.photos.isEmpty(), "revoked selection is not imported");
            break;
        case "system-result":
            Intent picked = new Intent().setData(new Uri("system-photo")).addFlags(1); app.onActivityResult(PICK_IMAGE, RESULT_OK, picked);
            check(app.finished && app.result == picked, "system selection URI and flags forwarded");
            break;
        case "system-cancel":
            app.onActivityResult(PICK_IMAGE, 0, null); check(!app.finished && app.result == null, "system picker cancellation returns to the in-app gallery");
            break;
        default: throw new AssertionError("unknown case");
        }
        System.out.println("PASS: " + args[0]);
    }
}`, "utf8");
  execFileSync(join(jdk, "bin/javac.exe"), ["-encoding", "UTF-8", "--release", "8", "-d", directory, fixture], { timeout: 30000, encoding: "utf8" });
});

for (const mode of ["permissions", "access", "request", "restore", "denial", "revoke", "page", "compat-sort", "large-gallery", "albums", "unknown-album", "album-revocation", "stale-page", "async-permission", "async-retry", "album-cancel", "pagination", "empty", "unavailable", "cancel", "select", "invalid-selection", "system-result", "system-cancel"]) {
  test(`native in-app gallery: ${mode}`, () => {
    assert.match(execFileSync(java, ["-cp", directory, "GalleryFixture", mode], { timeout: 10000, encoding: "utf8" }), new RegExp(`PASS: ${mode}`));
  });
}

test("gallery permissions are image-only, SDK-scoped and not requested at notebook startup", () => {
  const manifest = readFileSync(new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url), "utf8");
  const main = readFileSync(new URL("../android/app/src/main/java/com/betternotepad/android/MainActivity.java", import.meta.url), "utf8");
  assert.match(manifest, /READ_EXTERNAL_STORAGE" android:maxSdkVersion="32"/);
  assert.match(manifest, /READ_MEDIA_IMAGES/);
  assert.match(manifest, /READ_MEDIA_VISUAL_USER_SELECTED/);
  assert.match(manifest, /android:name="\.GalleryActivity" android:exported="false"/);
  assert.doesNotMatch(manifest, /READ_MEDIA_VIDEO|MANAGE_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE/);
  assert.doesNotMatch(main, /requestPermissions\(/);
  assert.match(main, /new Intent\(this, GalleryActivity.class\).putExtra\("theme", currentTheme\)/);
  assert.match(source, /system.setOnClickListener\(view -> openSystemPicker\(\)\)/);
  assert.match(source, /new LruCache<String, Bitmap>\(8 \* 1024 \* 1024\)/);
  assert.match(source, /request != generation \|\| job.signal.isCanceled\(\) \|\| image.getTag\(\) != job/);
  assert.match(source, /previous.cancel\(\);\s+jobs.remove\(previous\)/);
  assert.match(source, /albumPicker.setOnClickListener\(view -> chooseAlbum\(\)\)/);
  assert.match(source, /onScroll\([^\n]*\) \{ loadNearEnd\(first, visible, total\); \}/);
  assert.match(source, /state.putString\("album", selectedAlbum\)/);
});
