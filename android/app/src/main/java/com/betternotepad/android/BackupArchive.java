package com.betternotepad.android;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.*;
import java.util.zip.*;

// Platform-independent archive I/O. Only app-generated raster names are accepted.
final class BackupArchive {
    static final long MAX_MANIFEST = 8L * 1024 * 1024;
    static final long MAX_IMAGE = 32L * 1024 * 1024;
    static final long MAX_TOTAL = 512L * 1024 * 1024;
    static final long MAX_ARCHIVE = MAX_TOTAL + 8L * 1024 * 1024; // ZIP headers/central directory overhead.
    static final int MAX_IMAGES = 10000;
    static final class Stage implements Closeable {
        final File directory;
        String manifest;
        final Map<String, File> images = new LinkedHashMap<>();
        final Map<String, String> names = new LinkedHashMap<>();
        Stage(File directory) { this.directory = directory; }
        @Override public void close() {
            File[] files = directory.listFiles();
            if (files != null) for (File file : files) if (file.isFile()) file.delete();
            directory.delete();
        }
    }
    interface Commit { void write() throws Exception; }

    static boolean imageName(String name) { return name.matches("[a-f0-9]{32}\\.(jpg|png)"); }
    static long copy(InputStream input, OutputStream output, long limit) throws IOException {
        if (input == null) throw new IOException("Cannot read selected file");
        byte[] buffer = new byte[32768];
        long total = 0;
        int count;
        while ((count = input.read(buffer)) != -1) {
            total += count;
            if (total > limit) throw new IOException("Backup size limit exceeded");
            output.write(buffer, 0, count);
        }
        return total;
    }

    static void checkImage(File file, String name) throws IOException {
        byte[] header = new byte[8];
        int count;
        try (InputStream input = new FileInputStream(file)) { count = input.read(header); }
        byte[] png = { (byte)137, 80, 78, 71, 13, 10, 26, 10 };
        if (name.endsWith(".png") ? count != 8 || !Arrays.equals(header, png) :
            count < 3 || (header[0] & 255) != 255 || (header[1] & 255) != 216 || (header[2] & 255) != 255) {
            throw new IOException("Invalid raster image in backup");
        }
    }

    static Stage read(InputStream input, File cache) throws IOException {
        Stage stage = new Stage(Files.createTempDirectory(cache.toPath(), "backup-restore-").toFile());
        try {
            File archive = new File(stage.directory, "archive.zip");
            try (OutputStream output = new FileOutputStream(archive)) { copy(input, output, MAX_ARCHIVE); }
            long total = 0;
            Set<String> seen = new HashSet<>();
            try (ZipFile zip = new ZipFile(archive)) {
                Enumeration<? extends ZipEntry> entries = zip.entries();
                while (entries.hasMoreElements()) {
                    ZipEntry entry = entries.nextElement();
                    String path = entry.getName();
                    boolean manifest = "backup.json".equals(path);
                    if (entry.isDirectory() || (!manifest && !path.matches("images/[a-f0-9]{32}\\.(jpg|png)")) ||
                        !seen.add(path) || seen.size() > MAX_IMAGES + 1) throw new IOException("Invalid backup entry");
                    long limit = manifest ? MAX_MANIFEST : MAX_IMAGE;
                    if (entry.getSize() < 0 || entry.getSize() > limit || entry.getSize() > MAX_TOTAL - total)
                        throw new IOException("Backup size limit exceeded");
                    File file = new File(stage.directory, manifest ? "backup.json" :
                        UUID.randomUUID().toString().replace("-", "") + path.substring(path.lastIndexOf('.')));
                    CRC32 crc = new CRC32();
                    long size;
                    try (InputStream raw = zip.getInputStream(entry);
                         InputStream checked = new CheckedInputStream(raw, crc);
                         OutputStream output = new FileOutputStream(file)) {
                        size = copy(checked, output, Math.min(limit, MAX_TOTAL - total));
                    }
                    if (size != entry.getSize() || crc.getValue() != entry.getCrc()) throw new IOException("Backup checksum mismatch");
                    total += size;
                    if (manifest) stage.manifest = new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8);
                    else {
                        checkImage(file, path);
                        stage.names.put(path.substring(7), file.getName());
                        stage.images.put(file.getName(), file);
                    }
                }
            }
            if (stage.manifest == null) throw new IOException("Missing backup.json");
            archive.delete();
            return stage;
        } catch (IOException | RuntimeException | OutOfMemoryError error) { stage.close(); throw error; }
    }

    static void write(OutputStream output, String manifest, Set<String> images, File directory) throws IOException {
        byte[] data = manifest.getBytes(StandardCharsets.UTF_8);
        if (data.length > MAX_MANIFEST || images.size() > MAX_IMAGES) throw new IOException("Backup size limit exceeded");
        long total = data.length;
        try (ZipOutputStream zip = new ZipOutputStream(output)) {
            zip.putNextEntry(new ZipEntry("backup.json")); zip.write(data); zip.closeEntry();
            for (String name : images) {
                if (!imageName(name)) throw new IOException("Invalid image name");
                File file = new File(directory, name);
                checkImage(file, name);
                if (file.length() > MAX_IMAGE || file.length() > MAX_TOTAL - total) throw new IOException("Backup size limit exceeded");
                zip.putNextEntry(new ZipEntry("images/" + name));
                try (InputStream input = new FileInputStream(file)) { total += copy(input, zip, Math.min(MAX_IMAGE, MAX_TOTAL - total)); }
                zip.closeEntry();
            }
        }
    }

    // Install new, non-colliding files first; the caller atomically commits the
    // notebook last. A failed copy/commit removes only files created here.
    static void install(Stage stage, Set<String> references, File directory, Commit commit) throws Exception {
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("Cannot create images directory");
        List<File> installed = new ArrayList<>();
        try {
            for (String name : references) {
                if (!imageName(name)) throw new IOException("Invalid image reference");
                File target = new File(directory, name);
                File source = stage.images.get(name);
                if (source == null) {
                    if (!target.isFile()) throw new IOException("Missing image");
                    continue;
                }
                if (!target.createNewFile()) throw new IOException("Image name collision");
                installed.add(target);
                try (InputStream input = new FileInputStream(source); FileOutputStream output = new FileOutputStream(target)) {
                    copy(input, output, MAX_IMAGE); output.getFD().sync();
                }
            }
            commit.write();
        } catch (Exception | OutOfMemoryError error) {
            for (File file : installed) file.delete();
            throw error;
        }
    }
}
