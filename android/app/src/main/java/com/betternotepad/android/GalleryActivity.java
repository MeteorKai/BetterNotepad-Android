package com.betternotepad.android;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.LruCache;
import android.util.Size;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AbsListView;
import android.widget.BaseAdapter;
import android.widget.Button;
import android.widget.GridView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

public class GalleryActivity extends Activity {
    private static final int PERMISSIONS = 42, PICK_IMAGE = 41, PAGE_SIZE = 60;
    private static final int NONE = 0, PARTIAL = 1, FULL = 2;
    private final ArrayList<Photo> photos = new ArrayList<>();
    private final ArrayList<Album> albums = new ArrayList<>();
    private final ExecutorService queries = Executors.newSingleThreadExecutor();
    private final ThreadPoolExecutor thumbnails = new ThreadPoolExecutor(2, 2, 0, TimeUnit.MILLISECONDS, new LinkedBlockingQueue<>());
    private final Set<ThumbnailJob> jobs = new HashSet<>();
    private final LruCache<String, Bitmap> cache = new LruCache<String, Bitmap>(8 * 1024 * 1024) {
        @Override protected int sizeOf(String key, Bitmap value) { return value.getAllocationByteCount(); }
    };
    private final PhotoAdapter adapter = new PhotoAdapter();
    private GridView grid;
    private TextView status;
    private Button grant, permissionSettings, more, albumPicker;
    private String selectedAlbum;
    private int generation, ink, accent, chip;
    private boolean asking, loading, hasMore, albumsLoaded;
    private CancellationSignal querySignal;
    private Future<?> queryTask;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        createPage();
        asking = savedInstanceState != null && savedInstanceState.getBoolean("asking");
        selectedAlbum = savedInstanceState == null ? null : savedInstanceState.getString("album");
        if (savedInstanceState == null && imageAccess() == NONE) requestImageAccess();
    }

    private String[] imagePermissions() {
        if (Build.VERSION.SDK_INT >= 34) return new String[] { Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED };
        if (Build.VERSION.SDK_INT >= 33) return new String[] { Manifest.permission.READ_MEDIA_IMAGES };
        return new String[] { Manifest.permission.READ_EXTERNAL_STORAGE };
    }

    private int imageAccess() {
        String full = Build.VERSION.SDK_INT >= 33 ? Manifest.permission.READ_MEDIA_IMAGES : Manifest.permission.READ_EXTERNAL_STORAGE;
        if (checkSelfPermission(full) == PackageManager.PERMISSION_GRANTED) return FULL;
        if (Build.VERSION.SDK_INT >= 34 && checkSelfPermission(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED) == PackageManager.PERMISSION_GRANTED) return PARTIAL;
        return NONE;
    }

    private void requestImageAccess() {
        if (asking) return;
        asking = true;
        status.setText("请选择照片访问范围；允许全部照片后可直接浏览相册。");
        requestPermissions(imagePermissions(), PERMISSIONS);
    }

    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(code, permissions, results);
        if (code == PERMISSIONS) { asking = false; refreshPhotos(); }
    }

    @Override protected void onResume() {
        super.onResume();
        if (!asking) refreshPhotos();
    }

    @Override protected void onPause() {
        clearPhotos();
        super.onPause();
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        state.putBoolean("asking", asking);
        state.putString("album", selectedAlbum);
        super.onSaveInstanceState(state);
    }

    private void clearPhotos() {
        generation++;
        if (querySignal != null) querySignal.cancel();
        if (queryTask != null) queryTask.cancel(true);
        for (ThumbnailJob job : jobs) job.cancel();
        jobs.clear();
        thumbnails.purge();
        cache.evictAll();
        photos.clear();
        loading = false;
        hasMore = false;
        adapter.notifyDataSetChanged();
    }

    private void refreshPhotos() {
        clearPhotos();
        albums.clear();
        albumsLoaded = false;
        albumPicker.setEnabled(false);
        albumPicker.setText("选择相册 ▾");
        int access = imageAccess();
        grant.setVisibility(access == FULL ? View.GONE : View.VISIBLE);
        permissionSettings.setVisibility(access == FULL ? View.GONE : View.VISIBLE);
        grant.setText(access == PARTIAL ? "调整照片授权" : "授权访问相册");
        more.setVisibility(View.GONE);
        status.setText(access == NONE ? "尚未允许读取相册，可授权或使用右上角系统选图。" : access == PARTIAL ? "仅显示你授权的照片，也可在权限设置中允许全部照片。" : "已允许访问全部照片；正在读取本地相册…");
        if (access != NONE) loadMore();
    }

    private void loadMore() {
        if (loading || imageAccess() == NONE) return;
        loading = true;
        more.setVisibility(View.VISIBLE);
        more.setEnabled(false);
        more.setText("正在加载照片…");
        final int request = generation;
        final int access = imageAccess();
        final String bucket = selectedAlbum;
        final boolean readAlbums = !albumsLoaded;
        final Photo last = photos.isEmpty() ? null : photos.get(photos.size() - 1);
        final CancellationSignal signal = new CancellationSignal();
        querySignal = signal;
        queryTask = queries.submit(() -> {
            try {
                List<Album> folders = readAlbums ? queryAlbums(signal) : null;
                List<Photo> page = queryPage(last, bucket, signal);
                runOnUiThread(() -> {
                    if (request != generation || isFinishing() || isDestroyed()) return;
                    if (imageAccess() != access) { refreshPhotos(); return; }
                    if (folders != null) {
                        albums.clear();
                        albums.addAll(folders);
                        albumsLoaded = true;
                        albumPicker.setEnabled(!albums.isEmpty());
                        if (bucket != null && albums.stream().noneMatch(album -> album.id.equals(bucket))) {
                            selectAlbum(null);
                            return;
                        }
                        albumPicker.setText(albumLabel(selectedAlbum) + " ▾");
                    }
                    hasMore = page.size() == PAGE_SIZE;
                    photos.addAll(page);
                    adapter.notifyDataSetChanged();
                    status.setText((access == FULL ? "全部照片权限" : "仅部分照片权限") + " · 已显示 " + photos.size() + " 张\n" + (photos.isEmpty() ? "没有可显示的本地照片，可调整授权或使用系统选图。" : "最近添加优先，滑到底部继续加载；云端照片请用系统选图。"));
                    more.setText("加载更多照片");
                    more.setEnabled(true);
                    more.setVisibility(hasMore ? View.VISIBLE : View.GONE);
                    loading = false;
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    if (request != generation || isFinishing() || isDestroyed()) return;
                    loading = false;
                    hasMore = false;
                    if (imageAccess() == NONE) refreshPhotos();
                    else {
                        status.setText("照片读取失败，可以重试或使用右上角系统选图。");
                        more.setText("重试加载");
                        more.setEnabled(true);
                    }
                });
            }
        });
    }

    private Uri imageCollection() {
        return Build.VERSION.SDK_INT >= 29 ? MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL) : MediaStore.Images.Media.EXTERNAL_CONTENT_URI;
    }

    private List<Photo> queryPage(Photo last, String bucket, CancellationSignal signal) {
        Uri collection = imageCollection();
        Bundle args = new Bundle();
        args.putInt(ContentResolver.QUERY_ARG_LIMIT, PAGE_SIZE);
        // Legacy providers may ignore structured sort columns and return oldest IDs first.
        args.putString(ContentResolver.QUERY_ARG_SQL_SORT_ORDER, "date_added DESC, _id DESC");
        ArrayList<String> values = new ArrayList<>();
        String selection = "";
        if (bucket != null) {
            selection = bucket.isEmpty() ? "bucket_id IS NULL" : "bucket_id = ?";
            if (!bucket.isEmpty()) values.add(bucket);
        }
        if (last != null) {
            if (!selection.isEmpty()) selection += " AND ";
            selection += "(date_added < ? OR (date_added = ? AND _id < ?))";
            values.add(String.valueOf(last.added));
            values.add(String.valueOf(last.added));
            values.add(String.valueOf(last.id));
        }
        if (!selection.isEmpty()) {
            args.putString(ContentResolver.QUERY_ARG_SQL_SELECTION, selection);
            args.putStringArray(ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS, values.toArray(new String[0]));
        }
        ArrayList<Photo> page = new ArrayList<>();
        try (Cursor cursor = getContentResolver().query(collection, new String[] { MediaStore.Images.Media._ID, MediaStore.Images.Media.DATE_ADDED, MediaStore.Images.Media.DISPLAY_NAME }, args, signal)) {
            if (cursor == null) throw new IllegalStateException("No media cursor");
            while (page.size() < PAGE_SIZE && cursor.moveToNext()) {
                signal.throwIfCanceled();
                long id = cursor.getLong(0);
                page.add(new Photo(id, cursor.getLong(1), cursor.getString(2), ContentUris.withAppendedId(collection, id)));
            }
        }
        return page;
    }

    private List<Album> queryAlbums(CancellationSignal signal) {
        LinkedHashMap<String, Album> folders = new LinkedHashMap<>();
        Bundle args = new Bundle();
        args.putString(ContentResolver.QUERY_ARG_SQL_SORT_ORDER, "date_added DESC, _id DESC");
        try (Cursor cursor = getContentResolver().query(imageCollection(), new String[] { MediaStore.Images.Media.BUCKET_ID, MediaStore.Images.Media.BUCKET_DISPLAY_NAME }, args, signal)) {
            if (cursor == null) throw new IllegalStateException("No album cursor");
            while (cursor.moveToNext()) {
                signal.throwIfCanceled();
                String id = cursor.getString(0), name = cursor.getString(1);
                if (id == null) id = "";
                Album album = folders.get(id);
                if (album == null) {
                    album = new Album(id, name == null || name.trim().isEmpty() ? "其他图片" : name);
                    folders.put(id, album);
                }
                album.count++;
            }
        }
        return new ArrayList<>(folders.values());
    }

    private String albumLabel(String id) {
        int count = 0;
        for (Album album : albums) {
            if (album.id.equals(id)) return album.name + "（" + album.count + "）";
            count += album.count;
        }
        return (imageAccess() == PARTIAL ? "已授权本地照片" : "全部本地照片") + "（" + count + "）";
    }

    private void chooseAlbum() {
        if (!albumsLoaded || imageAccess() == NONE) return;
        final ArrayList<Album> choices = new ArrayList<>(albums);
        String[] labels = new String[choices.size() + 1];
        labels[0] = albumLabel(null);
        int checked = 0;
        for (int i = 0; i < choices.size(); i++) {
            Album album = choices.get(i);
            labels[i + 1] = album.name + "（" + album.count + "）";
            if (album.id.equals(selectedAlbum)) checked = i + 1;
        }
        new AlertDialog.Builder(this).setTitle("选择本地相册")
            .setSingleChoiceItems(labels, checked, (dialog, which) -> {
                dialog.dismiss();
                selectAlbum(which == 0 ? null : choices.get(which - 1).id);
            }).setNegativeButton("取消", null).show();
    }

    private void selectAlbum(String id) {
        if (imageAccess() == NONE) { refreshPhotos(); return; }
        selectedAlbum = id;
        clearPhotos();
        albumPicker.setText(albumLabel(id) + " ▾");
        grid.setSelection(0);
        loadMore();
    }

    private void loadNearEnd(int first, int visible, int total) {
        if (hasMore && total > 0 && first + visible >= total - 6) loadMore();
    }

    private void openSystemPicker() {
        Intent system = new Intent(MediaStore.ACTION_PICK_IMAGES).setType("image/*");
        Intent gallery = new Intent(Intent.ACTION_PICK);
        gallery.setDataAndType(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, "image/*");
        Intent files = new Intent(Intent.ACTION_GET_CONTENT).setType("image/*");
        files.addCategory(Intent.CATEGORY_OPENABLE);
        for (Intent intent : new Intent[] { system, gallery, files }) {
            try { startActivityForResult(intent, PICK_IMAGE); return; }
            catch (ActivityNotFoundException | SecurityException ignored) { }
        }
        status.setText("此设备没有可用的相册或图片选择器。");
    }

    @Override protected void onActivityResult(int code, int resultCode, Intent result) {
        super.onActivityResult(code, resultCode, result);
        if (code == PICK_IMAGE && resultCode == RESULT_OK && result != null && result.getData() != null) {
            setResult(RESULT_OK, result);
            finish();
        }
    }

    private void selectPhoto(int position) {
        if (imageAccess() == NONE) { refreshPhotos(); return; }
        if (position < 0 || position >= photos.size()) return;
        setResult(RESULT_OK, new Intent().setData(photos.get(position).uri).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION));
        finish();
    }

    private void createPage() {
        String theme = getIntent().getStringExtra("theme");
        boolean dark = "dark".equals(theme), light = "light".equals(theme);
        int surface = Color.parseColor(dark ? "#1c1a21" : light ? "#f7f8fb" : "#f8f3eb");
        ink = Color.parseColor(dark ? "#f1edf3" : light ? "#353844" : "#433a30");
        accent = Color.parseColor(dark ? "#c5a9dd" : light ? "#746aad" : "#854b2b");
        chip = Color.parseColor(dark ? "#332d3b" : light ? "#e9e6f2" : "#eee3d6");
        getWindow().setStatusBarColor(surface);
        getWindow().setNavigationBarColor(surface);
        getWindow().getDecorView().setSystemUiVisibility(dark ? 0 : View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setPadding(dp(16), dp(12), dp(16), dp(12));
        root.setBackgroundColor(surface);
        LinearLayout header = new LinearLayout(this);
        header.setGravity(Gravity.CENTER_VERTICAL);
        Button back = button("‹");
        back.setTextSize(28);
        back.setContentDescription("取消插图并返回便签");
        back.setOnClickListener(view -> finish());
        header.addView(back, new LinearLayout.LayoutParams(dp(48), dp(48)));
        TextView title = new TextView(this);
        title.setText("选择照片");
        title.setTextSize(20);
        title.setTextColor(ink);
        title.setPadding(dp(12), 0, 0, 0);
        header.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        Button system = button("系统选图");
        system.setOnClickListener(view -> openSystemPicker());
        header.addView(system);
        root.addView(header);
        status = new TextView(this);
        status.setTextSize(13);
        status.setTextColor(ink);
        status.setPadding(0, dp(16), 0, dp(12));
        status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);
        root.addView(status);
        LinearLayout permissions = new LinearLayout(this);
        grant = button("授权访问相册");
        grant.setBackground(rounded(accent));
        grant.setTextColor(Color.parseColor(dark ? "#241b2f" : light ? "#ffffff" : "#fff8ec"));
        grant.setOnClickListener(view -> requestImageAccess());
        permissions.addView(grant);
        permissionSettings = button("权限设置");
        permissionSettings.setOnClickListener(view -> startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()))));
        permissions.addView(permissionSettings);
        root.addView(permissions);
        albumPicker = button("选择相册 ▾");
        albumPicker.setContentDescription("切换本地照片相册");
        albumPicker.setOnClickListener(view -> chooseAlbum());
        root.addView(albumPicker, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        grid = new GridView(this);
        grid.setNumColumns(GridView.AUTO_FIT);
        grid.setColumnWidth(dp(96));
        grid.setStretchMode(GridView.STRETCH_COLUMN_WIDTH);
        grid.setHorizontalSpacing(dp(6));
        grid.setVerticalSpacing(dp(6));
        grid.setPadding(0, dp(8), 0, dp(8));
        grid.setClipToPadding(false);
        grid.setAdapter(adapter);
        grid.setOnItemClickListener((parent, view, position, id) -> selectPhoto(position));
        grid.setOnScrollListener(new AbsListView.OnScrollListener() {
            @Override public void onScrollStateChanged(AbsListView view, int state) { }
            @Override public void onScroll(AbsListView view, int first, int visible, int total) { loadNearEnd(first, visible, total); }
        });
        root.addView(grid, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        more = button("加载更多照片");
        more.setOnClickListener(view -> loadMore());
        root.addView(more);
        setContentView(root);
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }

    private Button button(String text) {
        Button button = new Button(this);
        button.setText(text);
        button.setTextSize(13);
        button.setTextColor(ink);
        button.setBackground(rounded(chip));
        button.setAllCaps(false);
        button.setMinHeight(dp(48));
        return button;
    }

    private GradientDrawable rounded(int color) {
        GradientDrawable background = new GradientDrawable();
        background.setColor(color);
        background.setCornerRadius(dp(12));
        return background;
    }

    private static final class Photo {
        final long id, added;
        final String name;
        final Uri uri;
        Photo(long id, long added, String name, Uri uri) { this.id = id; this.added = added; this.name = name; this.uri = uri; }
    }

    private static final class Album {
        final String id, name;
        int count;
        Album(String id, String name) { this.id = id; this.name = name; }
    }

    private final class ThumbnailJob {
        final CancellationSignal signal = new CancellationSignal();
        Future<?> task;
        void cancel() { signal.cancel(); if (task != null) task.cancel(true); }
    }

    private final class PhotoAdapter extends BaseAdapter {
        @Override public int getCount() { return photos.size(); }
        @Override public Photo getItem(int position) { return photos.get(position); }
        @Override public long getItemId(int position) { return photos.get(position).id; }
        @Override public View getView(int position, View recycled, ViewGroup parent) {
            ImageView image = recycled == null ? new ImageView(GalleryActivity.this) {
                @Override protected void onMeasure(int width, int height) { super.onMeasure(width, width); }
            } : (ImageView) recycled;
            if (image.getTag() instanceof ThumbnailJob) {
                ThumbnailJob previous = (ThumbnailJob) image.getTag();
                previous.cancel();
                jobs.remove(previous);
            }
            thumbnails.purge();
            Photo photo = getItem(position);
            image.setLayoutParams(new AbsListView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
            image.setBackground(rounded(chip));
            image.setClipToOutline(true);
            image.setScaleType(ImageView.ScaleType.CENTER_CROP);
            image.setContentDescription("插入照片：" + (photo.name == null ? "照片" : photo.name));
            image.setImageDrawable(null);
            Bitmap cached = cache.get(photo.uri.toString());
            if (cached != null) { image.setTag(null); image.setImageBitmap(cached); return image; }
            final int request = generation;
            ThumbnailJob job = new ThumbnailJob();
            image.setTag(job);
            jobs.add(job);
            job.task = thumbnails.submit(() -> {
                Bitmap bitmap = null;
                try {
                    if (!job.signal.isCanceled()) bitmap = Build.VERSION.SDK_INT >= 29 ? getContentResolver().loadThumbnail(photo.uri, new Size(240, 240), job.signal) : MediaStore.Images.Thumbnails.getThumbnail(getContentResolver(), photo.id, MediaStore.Images.Thumbnails.MINI_KIND, null);
                } catch (Exception | OutOfMemoryError ignored) { }
                final Bitmap result = bitmap;
                runOnUiThread(() -> {
                    jobs.remove(job);
                    if (request != generation || job.signal.isCanceled() || image.getTag() != job || isFinishing() || isDestroyed()) { if (result != null) result.recycle(); return; }
                    image.setTag(null);
                    if (result != null) { cache.put(photo.uri.toString(), result); image.setImageBitmap(result); }
                    else { image.setScaleType(ImageView.ScaleType.CENTER); image.setImageResource(android.R.drawable.ic_menu_report_image); }
                });
            });
            return image;
        }
    }

    @Override protected void onDestroy() {
        clearPhotos();
        queries.shutdownNow();
        thumbnails.shutdownNow();
        super.onDestroy();
    }
}
