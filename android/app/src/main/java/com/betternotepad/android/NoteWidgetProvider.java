package com.betternotepad.android;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.appwidget.AppWidgetProviderInfo;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Paint;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.AtomicFile;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.Toast;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class NoteWidgetProvider extends AppWidgetProvider {
    static final String NOTE_ID = "noteId", TODO_ID = "todoId";
    static final String PINNED = "com.betternotepad.android.WIDGET_PINNED";
    static final String TODO = "com.betternotepad.android.WIDGET_TODO";
    static final String REFRESH = "com.betternotepad.android.WIDGET_REFRESH";
    private static final ExecutorService WORK = Executors.newSingleThreadExecutor();
    private static boolean refreshQueued;

    static AtomicFile file(Context context) { return new AtomicFile(new File(context.getFilesDir(), "notebook-v1.json")); }
    static SharedPreferences bindings(Context context) { return context.getSharedPreferences("note-widgets", Context.MODE_PRIVATE); }
    static String noteId(Context context, int id) { return bindings(context).getString("note-" + id, ""); }
    static boolean registered(Context context) {
        ComponentName provider = new ComponentName(context, NoteWidgetProvider.class);
        for (AppWidgetProviderInfo info : AppWidgetManager.getInstance(context).getInstalledProvidersForPackage(context.getPackageName(), null)) {
            if (provider.equals(info.provider)) return true;
        }
        return false;
    }
    static boolean owns(Context context, int id) {
        AppWidgetProviderInfo info = AppWidgetManager.getInstance(context).getAppWidgetInfo(id);
        return info != null && new ComponentName(context, NoteWidgetProvider.class).equals(info.provider);
    }
    static void bind(Context context, int id, String noteId) throws Exception {
        synchronized (NotebookStore.LOCK) {
            JSONObject data = new JSONObject(NotebookStore.read(file(context))); BackupData.validate(data);
            if (!owns(context, id) || NotebookStore.findNote(data, noteId) == null) throw new IllegalArgumentException("Invalid widget binding");
            if (!bindings(context).edit().putString("note-" + id, noteId).commit()) throw new java.io.IOException("Cannot save widget binding");
        }
    }

    // Saves can be frequent while typing. Queue at most one following refresh,
    // and always read the latest committed notebook when that work starts.
    static void refresh(Context context) {
        final Context app = context.getApplicationContext();
        synchronized (NoteWidgetProvider.class) {
            if (refreshQueued) return;
            refreshQueued = true;
        }
        WORK.execute(() -> {
            synchronized (NoteWidgetProvider.class) { refreshQueued = false; }
            update(app, AppWidgetManager.getInstance(app).getAppWidgetIds(new ComponentName(app, NoteWidgetProvider.class)));
        });
    }

    private void async(Context context, Runnable action) {
        final PendingResult pending = goAsync();
        WORK.execute(() -> { try { action.run(); } finally { pending.finish(); } });
    }
    @Override public void onUpdate(Context context, AppWidgetManager manager, int[] ids) { async(context, () -> update(context, ids)); }
    @Override public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) { async(context, () -> update(context, new int[] { id })); }
    @Override public void onDeleted(Context context, int[] ids) {
        SharedPreferences.Editor editor = bindings(context).edit();
        for (int id : ids) editor.remove("note-" + id);
        editor.apply();
    }

    // Public lifecycle broadcasts never dispatch private note operations.
    @Override public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (!PINNED.equals(action) && !TODO.equals(action) && !REFRESH.equals(action)) super.onReceive(context, intent);
    }

    void receiveAction(Context context, Intent intent) {
        String action = intent.getAction();
        if (!PINNED.equals(action) && !TODO.equals(action) && !REFRESH.equals(action)) return;
        int id = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        async(context, () -> {
            try {
                if (!owns(context, id)) return;
                if (PINNED.equals(action)) bind(context, id, intent.getStringExtra(NOTE_ID));
                if (TODO.equals(action)) {
                    synchronized (NotebookStore.LOCK) {
                        String note = intent.getStringExtra(NOTE_ID);
                        if (note == null || !note.equals(noteId(context, id)) || !intent.hasExtra("done")) return;
                        NotebookStore.setTodo(file(context), note, intent.getStringExtra(TODO_ID), intent.getBooleanExtra("done", false));
                    }
                }
            } catch (Exception error) {
                new Handler(Looper.getMainLooper()).post(() -> Toast.makeText(context, "小组件操作未成功，原内容未改动。请刷新或重新选择便签。", Toast.LENGTH_LONG).show());
            } finally {
                update(context, AppWidgetManager.getInstance(context).getAppWidgetIds(new ComponentName(context, NoteWidgetProvider.class)));
            }
        });
    }

    static void update(Context context, int[] ids) {
        if (ids.length == 0) return;
        JSONObject data = null;
        try { data = new JSONObject(NotebookStore.read(file(context))); BackupData.validate(data); } catch (Exception ignored) { }
        for (int id : ids) {
            if (!owns(context, id)) continue;
            try { render(context, id, data); } catch (Exception | OutOfMemoryError ignored) { }
        }
    }

    static Intent action(Context context, Class<?> target, String action, int id, String... items) {
        Uri.Builder uri = new Uri.Builder().scheme("betternotepad-widget").authority("local").appendPath(String.valueOf(id)).appendPath(action);
        for (String item : items) uri.appendPath(item == null ? "" : item);
        return new Intent(context, target).setAction(action)
            .setData(uri.build())
            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
    }
    private static PendingIntent activity(Context context, int id, String note, boolean config) {
        Intent intent = action(context, config ? WidgetConfigActivity.class : MainActivity.class, config ? "configure" : "open", id, note);
        if (!config) intent.putExtra(NOTE_ID, note).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static void render(Context context, int id, JSONObject data) throws Exception {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        String selected = noteId(context, id);
        JSONObject note = data == null ? null : NotebookStore.findNote(data, selected);
        String theme = data == null ? "warm" : data.getString("theme");
        boolean dark = "dark".equals(theme), light = "light".equals(theme);
        int ink = Color.parseColor(dark ? "#f1edf3" : light ? "#353844" : "#433a30");
        int sub = Color.parseColor(dark ? "#bbb1c4" : light ? "#646a79" : "#706659");
        int accent = Color.parseColor(dark ? "#c5a9dd" : light ? "#746aad" : "#854b2b");
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.note_widget);
        views.setInt(R.id.widget_root, "setBackgroundResource", dark ? R.drawable.widget_dark : light ? R.drawable.widget_light : R.drawable.widget_warm);
        views.setTextColor(R.id.widget_title, ink); views.setTextColor(R.id.widget_body, sub); views.setTextColor(R.id.widget_status, sub);
        views.setTextColor(R.id.widget_config, accent); views.setTextColor(R.id.widget_refresh, accent);
        views.setOnClickPendingIntent(R.id.widget_config, activity(context, id, selected, true));
        views.setOnClickPendingIntent(R.id.widget_root, activity(context, id, selected, note == null));
        Intent refresh = action(context, WidgetActionReceiver.class, REFRESH, id, "");
        views.setOnClickPendingIntent(R.id.widget_refresh, PendingIntent.getBroadcast(context, 0, refresh, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        views.removeAllViews(R.id.widget_tasks);
        views.setViewVisibility(R.id.widget_image, View.GONE);
        if (note == null) {
            views.setTextViewText(R.id.widget_title, "BetterNotepad");
            views.setTextViewText(R.id.widget_body, data == null ? "便签暂时无法读取，请刷新重试。" : selected.isEmpty() ? "点击齿轮，选择要显示的便签。" : "这篇便签已删除或不在当前便签本中。可在应用回收站恢复，或点击齿轮更换。");
            views.setTextViewText(R.id.widget_status, "点击齿轮选择便签 · ↻ 刷新");
        } else {
            views.setTextViewText(R.id.widget_title, NotebookStore.title(note));
            String body = NotebookStore.body(note);
            JSONArray todos = note.optJSONArray("todos"); int total = todos == null ? 0 : todos.length(), done = 0;
            for (int i = 0; i < total; i++) if (todos.getJSONObject(i).getBoolean("done")) done++;
            int budget = Math.max(0, manager.getAppWidgetOptions(id).getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 220) - 96);
            String imageName = NotebookStore.firstImage(note);
            Bitmap bitmap = imageName != null && budget >= 180 ? thumbnail(new File(new File(context.getFilesDir(), "images"), imageName)) : null;
            if (bitmap != null) { views.setImageViewBitmap(R.id.widget_image, bitmap); views.setViewVisibility(R.id.widget_image, View.VISIBLE); budget -= 70; }
            int lines = Math.max(1, Math.min(3, (budget - (total > 0 ? 50 : 6)) / 20));
            views.setViewVisibility(R.id.widget_body, body.isEmpty() ? View.GONE : View.VISIBLE);
            views.setTextViewText(R.id.widget_body, body); views.setInt(R.id.widget_body, "setMaxLines", lines);
            if (!body.isEmpty()) budget -= lines * 20 + 6;
            int shown = Math.min(total, Math.min(6, Math.max(0, budget / 44)));
            for (int i = 0; i < shown; i++) {
                JSONObject todo = todos.getJSONObject(i); boolean checked = todo.getBoolean("done");
                String text = todo.getString("text"); if (text.trim().isEmpty()) text = "未填写事项";
                RemoteViews row = new RemoteViews(context.getPackageName(), R.layout.widget_todo);
                row.setTextViewText(R.id.task_check, checked ? "✓" : "□"); row.setTextColor(R.id.task_check, accent);
                row.setTextViewText(R.id.task_text, text); row.setTextColor(R.id.task_text, checked ? sub : ink);
                row.setInt(R.id.task_text, "setPaintFlags", Paint.ANTI_ALIAS_FLAG | (checked ? Paint.STRIKE_THRU_TEXT_FLAG : 0));
                row.setContentDescription(R.id.task_check, (checked ? "取消完成：" : "完成：") + text);
                Intent tap = action(context, WidgetActionReceiver.class, TODO, id, selected, todo.getString("id"))
                    .putExtra(NOTE_ID, selected).putExtra(TODO_ID, todo.getString("id")).putExtra("done", !checked);
                row.setOnClickPendingIntent(R.id.task_check, PendingIntent.getBroadcast(context, 0, tap, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
                row.setOnClickPendingIntent(R.id.task_text, activity(context, id, selected, false));
                views.addView(R.id.widget_tasks, row);
            }
            views.setTextViewText(R.id.widget_status, total == 0 ? "点击进入编辑 · 长按可调整大小" : "待办 " + done + " / " + total + (shown < total ? " · 另 " + (total - shown) + " 项，点击查看" : " · 点击文字编辑"));
            try { manager.updateAppWidget(id, views); } finally { if (bitmap != null) bitmap.recycle(); }
            return;
        }
        manager.updateAppWidget(id, views);
    }

    private static Bitmap thumbnail(File image) {
        try {
            BitmapFactory.Options options = new BitmapFactory.Options(); options.inJustDecodeBounds = true;
            BitmapFactory.decodeFile(image.getPath(), options);
            if (options.outWidth <= 0 || options.outHeight <= 0) return null;
            options.inJustDecodeBounds = false; options.inSampleSize = 1;
            while (Math.max(options.outWidth, options.outHeight) / options.inSampleSize > 256) options.inSampleSize *= 2;
            return BitmapFactory.decodeFile(image.getPath(), options);
        } catch (Exception | OutOfMemoryError error) { return null; }
    }
}
