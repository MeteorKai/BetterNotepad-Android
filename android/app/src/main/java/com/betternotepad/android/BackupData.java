package com.betternotepad.android;

import org.json.JSONArray;
import org.json.JSONObject;
import java.util.*;
import java.util.regex.*;

final class BackupData {
    private static final Pattern IMAGE = Pattern.compile("!\\[图片\\]\\(/images/([a-f0-9]{32}\\.(?:jpg|png))\\)");
    private static final Pattern TAG_CONTROL = Pattern.compile("[\\x00-\\x1f\\x7f]");
    private static final Pattern TAG_EDGE = Pattern.compile("^[\\s\\p{Z}\\uFEFF]|[\\s\\p{Z}\\uFEFF]$");
    static void validate(JSONObject data) throws Exception {
        if (!(data.get("version") instanceof Number) || data.getDouble("version") != 1 ||
            !(data.get("theme") instanceof String) || !Arrays.asList("warm", "light", "dark").contains(data.getString("theme")))
            throw new IllegalArgumentException("Unsupported notebook");
        if (data.has("manualOrder") && !(data.get("manualOrder") instanceof Boolean))
            throw new IllegalArgumentException("Invalid note order");
        if (data.has("home")) {
            JSONObject home = data.getJSONObject("home");
            if (!(home.get("title") instanceof String) || !(home.get("subtitle") instanceof String) ||
                home.getString("title").trim().isEmpty() || home.getString("title").length() > 40 || home.getString("subtitle").length() > 80)
                throw new IllegalArgumentException("Invalid homepage settings");
        }
        Set<String> ids = new HashSet<>();
        for (String key : new String[] { "notes", "trash" }) {
            if ("trash".equals(key) && !data.has(key)) continue;
            JSONArray notes = data.getJSONArray(key);
            for (int i = 0; i < notes.length(); i++) {
                JSONObject note = notes.getJSONObject(i);
                for (String field : new String[] { "id", "title", "content", "format" })
                    if (!(note.get(field) instanceof String)) throw new IllegalArgumentException("Invalid note text");
                if (note.getString("id").isEmpty() || !ids.add(note.getString("id")) || !(note.get("pinned") instanceof Boolean) ||
                    !Arrays.asList("text", "markdown").contains(note.getString("format"))) throw new IllegalArgumentException("Invalid note");
                number(note, "createdAt"); number(note, "updatedAt");
                if ("trash".equals(key)) number(note, "deletedAt");
                if (note.has("tags")) {
                    JSONArray tags = note.getJSONArray("tags");
                    Set<String> labels = new HashSet<>();
                    if (tags.length() > 8) throw new IllegalArgumentException("Too many tags");
                    for (int t = 0; t < tags.length(); t++) {
                        if (!(tags.get(t) instanceof String)) throw new IllegalArgumentException("Invalid tag");
                        String tag = tags.getString(t);
                        if (tag.isEmpty() || TAG_EDGE.matcher(tag).find() || tag.length() > 20 ||
                            TAG_CONTROL.matcher(tag).find() || !labels.add(tag))
                            throw new IllegalArgumentException("Invalid tag");
                    }
                }
                if (note.has("todos")) {
                    JSONArray todos = note.getJSONArray("todos");
                    Set<String> items = new HashSet<>();
                    for (int t = 0; t < todos.length(); t++) {
                        JSONObject todo = todos.getJSONObject(t);
                        if (!(todo.get("id") instanceof String) || todo.getString("id").isEmpty() || !items.add(todo.getString("id")) ||
                            !(todo.get("text") instanceof String) || !(todo.get("done") instanceof Boolean))
                            throw new IllegalArgumentException("Invalid todo");
                    }
                }
            }
        }
    }

    static double number(JSONObject object, String key) throws Exception {
        if (!(object.get(key) instanceof Number)) throw new IllegalArgumentException("Invalid timestamp");
        double value = object.getDouble(key);
        if (Double.isNaN(value) || Double.isInfinite(value) || Math.abs(value) > 8640000000000000D)
            throw new IllegalArgumentException("Invalid timestamp");
        return value;
    }

    static Set<String> images(JSONObject data) throws Exception {
        Set<String> images = new LinkedHashSet<>();
        for (String key : new String[] { "notes", "trash" }) {
            if (!data.has(key)) continue;
            JSONArray notes = data.getJSONArray(key);
            for (int i = 0; i < notes.length(); i++) {
                Matcher matches = IMAGE.matcher(notes.getJSONObject(i).getString("content"));
                while (matches.find()) images.add(matches.group(1));
            }
        }
        return images;
    }

    static JSONObject read(BackupArchive.Stage stage) throws Exception {
        JSONObject manifest = new JSONObject(stage.manifest);
        if (!"betternotepad-backup".equals(manifest.get("type")) || !(manifest.get("version") instanceof Number) ||
            manifest.getDouble("version") != 1) throw new IllegalArgumentException("Unsupported backup");
        number(manifest, "createdAt");
        JSONObject data = manifest.getJSONObject("notebook");
        validate(data);
        if (!images(data).equals(stage.names.keySet())) throw new IllegalArgumentException("Missing or unreferenced backup images");
        for (String key : new String[] { "notes", "trash" }) {
            if (!data.has(key)) continue;
            JSONArray notes = data.getJSONArray(key);
            for (int i = 0; i < notes.length(); i++) {
                JSONObject note = notes.getJSONObject(i);
                Matcher matches = IMAGE.matcher(note.getString("content"));
                StringBuffer rewritten = new StringBuffer();
                while (matches.find()) matches.appendReplacement(rewritten, Matcher.quoteReplacement("![图片](/images/" + stage.names.get(matches.group(1)) + ")"));
                matches.appendTail(rewritten);
                note.put("content", rewritten.toString());
            }
        }
        return manifest;
    }
}
