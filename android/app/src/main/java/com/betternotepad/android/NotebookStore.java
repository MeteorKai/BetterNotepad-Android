package com.betternotepad.android;

import android.util.AtomicFile;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.regex.Pattern;

// All app and widget transactions share this lock in the default app process.
final class NotebookStore {
    static final Object LOCK = new Object();
    private static final Pattern IMAGE = Pattern.compile("!\\[图片\\]\\(/images/([a-f0-9]{32}\\.(?:jpg|png))\\)");

    static String read(AtomicFile file) throws Exception {
        synchronized (LOCK) {
            File base = file.getBaseFile();
            if (!base.exists() && !new File(base.getPath() + ".bak").exists())
                return "{\"version\":1,\"theme\":\"warm\",\"notes\":[]}";
            return new String(file.readFully(), StandardCharsets.UTF_8);
        }
    }

    static String revision(String raw) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(raw.getBytes(StandardCharsets.UTF_8));
        StringBuilder result = new StringBuilder();
        for (byte value : digest) result.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
        return result.toString();
    }

    static void write(AtomicFile file, String raw) throws Exception {
        synchronized (LOCK) {
            FileOutputStream output = null;
            try {
                output = file.startWrite();
                output.write(raw.getBytes(StandardCharsets.UTF_8));
                output.getFD().sync();
                file.finishWrite(output);
            } catch (Exception error) {
                if (output != null) file.failWrite(output);
                throw error;
            }
        }
    }

    static String saveChecked(AtomicFile file, String raw, String expected) throws Exception {
        synchronized (LOCK) {
            if (!revision(read(file)).equals(expected))
                return "{\"ok\":false,\"conflict\":true,\"error\":\"便签已在桌面或其他页面更新。未保存的修改仍保留，请重新读取后再编辑。\"}";
            BackupData.validate(new JSONObject(raw));
            write(file, raw);
            return new JSONObject().put("ok", true).put("revision", revision(raw)).toString();
        }
    }

    static JSONObject findNote(JSONObject data, String id) throws Exception {
        JSONArray notes = data.getJSONArray("notes");
        for (int i = 0; i < notes.length(); i++) {
            JSONObject note = notes.getJSONObject(i);
            if (note.getString("id").equals(id)) return note;
        }
        return null; // A note in the recycle bin must not be editable on the desktop.
    }

    static void setTodo(AtomicFile file, String noteId, String todoId, boolean done) throws Exception {
        synchronized (LOCK) {
            JSONObject data = new JSONObject(read(file));
            BackupData.validate(data);
            JSONObject note = findNote(data, noteId);
            if (note == null) throw new IllegalArgumentException("Note unavailable");
            JSONArray todos = note.optJSONArray("todos");
            if (todos != null) for (int i = 0; i < todos.length(); i++) {
                JSONObject todo = todos.getJSONObject(i);
                if (!todo.getString("id").equals(todoId)) continue;
                // A duplicate tap sets the same value instead of toggling it twice.
                if (todo.getBoolean("done") != done) {
                    todo.put("done", done); note.put("updatedAt", System.currentTimeMillis());
                    write(file, data.toString());
                }
                return;
            }
            throw new IllegalArgumentException("Todo unavailable");
        }
    }

    static String body(JSONObject note) throws Exception { return IMAGE.matcher(note.getString("content")).replaceAll("").trim(); }

    static String firstImage(JSONObject note) throws Exception {
        java.util.regex.Matcher match = IMAGE.matcher(note.getString("content"));
        return match.find() ? match.group(1) : null;
    }

    static String title(JSONObject note) throws Exception {
        String title = note.getString("title").trim();
        if (!title.isEmpty()) return title;
        for (String line : body(note).split("\\r?\\n")) {
            if (!line.trim().isEmpty()) {
                title = line.trim().replaceFirst("^#+\\s*", "").trim();
                if (!title.isEmpty()) return title.substring(0, Math.min(40, title.length()));
                break;
            }
        }
        JSONArray todos = note.optJSONArray("todos");
        if (todos != null) for (int i = 0; i < todos.length(); i++) {
            title = todos.getJSONObject(i).getString("text").trim();
            if (!title.isEmpty()) return title.substring(0, Math.min(40, title.length()));
        }
        return "无标题便签";
    }
}
