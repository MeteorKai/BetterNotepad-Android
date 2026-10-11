package com.betternotepad.android;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Intent;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.TextView;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.UUID;

public class WidgetConfigActivity extends Activity {
    private int widgetId;
    private String selected;
    private final ArrayList<String> noteIds = new ArrayList<>();
    private Button confirm;
    private TextView message;
    private TextView status;
    private ListView list;
    private boolean saving;
    private boolean pinPending;
    private String pendingNote;
    private int[] beforePinIds = new int[0];

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        setResult(RESULT_CANCELED);
        widgetId = getIntent().getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        if (widgetId != AppWidgetManager.INVALID_APPWIDGET_ID && !NoteWidgetProvider.owns(this, widgetId)) { finish(); return; }
        selected = state == null ? NoteWidgetProvider.noteId(this, widgetId) : state.getString("selected", "");
        if (state != null) {
            pinPending = state.getBoolean("pinPending"); pendingNote = state.getString("pendingNote");
            int[] ids = state.getIntArray("beforePinIds"); if (ids != null) beforePinIds = ids;
        }
        LinearLayout page = new LinearLayout(this); page.setOrientation(LinearLayout.VERTICAL);
        int padding = dp(20); page.setPadding(padding, padding, padding, padding);
        TextView title = new TextView(this); title.setText("桌面小组件"); title.setTextSize(22); title.setPadding(0, 0, 0, dp(12)); page.addView(title);
        message = new TextView(this); message.setTextSize(13); message.setPadding(0, 0, 0, dp(16)); page.addView(message);
        status = new TextView(this); status.setTextSize(13); status.setPadding(0, 0, 0, dp(12)); page.addView(status);
        list = new ListView(this); list.setChoiceMode(ListView.CHOICE_MODE_SINGLE);
        page.addView(list, new LinearLayout.LayoutParams(-1, 0, 1));
        list.setOnItemClickListener((parent, view, position, id) -> { selected = noteIds.get(position); confirm.setEnabled(true); });
        confirm = new Button(this); confirm.setText(widgetId == AppWidgetManager.INVALID_APPWIDGET_ID ? "添加到桌面" : "显示这篇便签");
        confirm.setEnabled(false); confirm.setOnClickListener(view -> apply()); page.addView(confirm);
        Button help = new Button(this); help.setText("手动添加帮助"); help.setOnClickListener(view -> unsupported()); page.addView(help);
        Button cancel = new Button(this); cancel.setText("取消"); cancel.setOnClickListener(view -> finish()); page.addView(cancel);
        setContentView(page);
        try {
            JSONObject data = new JSONObject(NotebookStore.read(NoteWidgetProvider.file(this))); BackupData.validate(data);
            String theme = data.getString("theme"); boolean dark = "dark".equals(theme), light = "light".equals(theme);
            int background = Color.parseColor(dark ? "#25222c" : light ? "#ffffff" : "#fffdf8");
            int ink = Color.parseColor(dark ? "#f1edf3" : light ? "#353844" : "#433a30");
            int accent = Color.parseColor(dark ? "#c5a9dd" : light ? "#746aad" : "#854b2b");
            page.setBackgroundColor(background); title.setTextColor(ink); message.setTextColor(ink); status.setTextColor(ink);
            getWindow().setStatusBarColor(background); getWindow().setNavigationBarColor(background);
            getWindow().getDecorView().setSystemUiVisibility(dark ? 0 : android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
            confirm.setBackgroundTintList(ColorStateList.valueOf(accent)); confirm.setTextColor(Color.parseColor(dark ? "#241b2f" : "#ffffff"));
            JSONArray notes = data.getJSONArray("notes"); ArrayList<JSONObject> sorted = new ArrayList<>();
            for (int i = 0; i < notes.length(); i++) sorted.add(notes.getJSONObject(i));
            sorted.sort((a, b) -> { int pin = Boolean.compare(b.optBoolean("pinned"), a.optBoolean("pinned")); return pin != 0 ? pin : Long.compare(b.optLong("updatedAt"), a.optLong("updatedAt")); });
            ArrayList<String> labels = new ArrayList<>();
            for (JSONObject note : sorted) { noteIds.add(note.getString("id")); labels.add(NotebookStore.title(note)); }
            list.setAdapter(new ArrayAdapter<String>(this, android.R.layout.simple_list_item_single_choice, labels) {
                @Override public android.view.View getView(int position, android.view.View view, android.view.ViewGroup parent) {
                    TextView row = (TextView) super.getView(position, view, parent); row.setTextColor(ink); row.setTextSize(15); return row;
                }
            });
            int position = noteIds.indexOf(selected);
            if (position >= 0) { list.setItemChecked(position, true); confirm.setEnabled(true); }
            message.setText(noteIds.isEmpty() ? "还没有便签。请先在应用中新建，再添加小组件。" : "选择一篇便签显示在桌面。待办可直接勾选，点击内容进入编辑；可添加多个小组件，并分别选择便签。");
        } catch (Exception error) { message.setText("便签暂时无法读取，原内容未修改。请返回应用检查后重试。"); }
        if (pinPending) { list.setEnabled(false); confirm.setText("检查添加结果"); }
    }

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    @Override protected void onSaveInstanceState(Bundle state) {
        state.putString("selected", selected); state.putBoolean("pinPending", pinPending);
        state.putString("pendingNote", pendingNote); state.putIntArray("beforePinIds", beforePinIds);
        super.onSaveInstanceState(state);
    }
    @Override protected void onResume() {
        super.onResume();
        if (status == null) return;
        if (pinPending) checkPinResult(); else showStatus();
    }

    private void showStatus() {
        try {
            AppWidgetManager manager = AppWidgetManager.getInstance(this);
            status.setText(NoteWidgetProvider.registered(this)
                ? "系统已识别小组件 · 已添加 " + manager.getAppWidgetIds(new ComponentName(this, NoteWidgetProvider.class)).length + " 个\n"
                    + (manager.isRequestPinAppWidgetSupported() ? "当前桌面支持应用内请求；仍需在桌面确认。" : "当前桌面需手动添加，请查看下方帮助。")
                : "系统尚未识别 BetterNotepad 小组件。请确认已覆盖安装新版并打开应用；不要卸载或清除数据。");
        } catch (RuntimeException error) { status.setText("无法读取系统小组件状态（" + error.getClass().getSimpleName() + "）。请查看手动添加帮助。"); }
    }

    private boolean checkPinResult() {
        try {
            for (int id : AppWidgetManager.getInstance(this).getAppWidgetIds(new ComponentName(this, NoteWidgetProvider.class))) {
                boolean previous = false; for (int old : beforePinIds) if (old == id) previous = true;
                if (!previous && pendingNote != null && pendingNote.equals(NoteWidgetProvider.noteId(this, id))) {
                    pinPending = false; list.setEnabled(true); confirm.setText("再添加一个");
                    status.setText("已确认添加到桌面。可返回桌面查看，或再添加一个独立便签小组件。");
                    return true;
                }
            }
            status.setText("已发出请求，但尚未确认添加成功。若没有桌面确认窗口，请用下方「手动添加帮助」；返回后可检查结果或重新请求。");
        } catch (RuntimeException error) { status.setText("暂时无法确认添加结果（" + error.getClass().getSimpleName() + "）。请检查桌面后重试。"); }
        return false;
    }

    private void apply() {
        if (saving || selected == null || !noteIds.contains(selected)) return;
        if (widgetId == AppWidgetManager.INVALID_APPWIDGET_ID) {
            AppWidgetManager manager = AppWidgetManager.getInstance(this);
            try {
                if (pinPending) {
                    if (!checkPinResult()) { pinPending = false; list.setEnabled(true); confirm.setText("再次请求添加"); }
                    return;
                }
                if (!NoteWidgetProvider.registered(this)) { showStatus(); return; }
                if (!manager.isRequestPinAppWidgetSupported()) { unsupported(); return; }
                beforePinIds = manager.getAppWidgetIds(new ComponentName(this, NoteWidgetProvider.class)); pendingNote = selected;
                Intent callback = NoteWidgetProvider.action(this, WidgetActionReceiver.class, NoteWidgetProvider.PINNED, 0, UUID.randomUUID().toString()).putExtra(NoteWidgetProvider.NOTE_ID, selected);
                // The launcher fills in EXTRA_APPWIDGET_ID after user confirmation.
                callback.removeExtra(AppWidgetManager.EXTRA_APPWIDGET_ID);
                int flags = PendingIntent.FLAG_ONE_SHOT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
                PendingIntent completed = PendingIntent.getBroadcast(this, 0, callback, flags);
                if (!manager.requestPinAppWidget(new ComponentName(this, NoteWidgetProvider.class), null, completed)) { completed.cancel(); status.setText("桌面未接受添加请求，尚未添加小组件。请从桌面手动添加。"); unsupported(); return; }
                pinPending = true; list.setEnabled(false); confirm.setText("检查添加结果"); checkPinResult();
            } catch (RuntimeException error) { status.setText("添加请求失败（" + error.getClass().getSimpleName() + "），尚未添加小组件。请从桌面手动添加。"); unsupported(); }
        } else {
            saving = true; confirm.setEnabled(false); list.setEnabled(false);
            final String note = selected;
            new Thread(() -> {
                try {
                    NoteWidgetProvider.bind(this, widgetId, note);
                    NoteWidgetProvider.update(this, new int[] { widgetId });
                    runOnUiThread(() -> { setResult(RESULT_OK, new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)); finish(); });
                } catch (Exception error) {
                    runOnUiThread(() -> { saving = false; confirm.setEnabled(true); list.setEnabled(true); message.setText("未能设置小组件。便签可能已删除，请返回后重新选择。"); });
                }
            }, "note-widget-config").start();
        }
    }
    private void unsupported() {
        new AlertDialog.Builder(this).setTitle("从桌面添加")
            .setMessage("长按桌面空白处，进入小组件列表，选择 BetterNotepad 便签与待办，再选择便签。\n\n小米/澎湃 OS：在添加小部件页找到「支持小部件应用 → 全部 → 安卓小部件」。不要只在小米小部件商店中搜索；不同桌面版本的入口名称可能不同。\n\n没有显示时请把本页的系统识别状态发给开发者。无需卸载或清除便签数据。")
            .setPositiveButton("知道了", null).show();
    }
}
