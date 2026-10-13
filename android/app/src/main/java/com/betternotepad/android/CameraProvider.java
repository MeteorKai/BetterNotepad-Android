package com.betternotepad.android;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;

public class CameraProvider extends ContentProvider {
    @Override public boolean onCreate() { return true; }
    private File file(Uri uri) {
        String path = uri.getPath();
        if (!"content".equals(uri.getScheme()) || !(getContext().getPackageName() + ".camera").equals(uri.getAuthority()) ||
            path == null || !path.matches("/[a-f0-9]{32}\\.jpg") || uri.getQuery() != null || uri.getFragment() != null)
            throw new IllegalArgumentException("Invalid camera URI");
        return new File(new File(getContext().getCacheDir(), "camera-capture"), path.substring(1));
    }
    @Override public String getType(Uri uri) { file(uri); return "image/jpeg"; }
    @Override public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) {
        File photo = file(uri);
        String[] columns = projection == null ? new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE} : projection;
        MatrixCursor cursor = new MatrixCursor(columns); Object[] values = new Object[columns.length];
        for (int i = 0; i < columns.length; i++) {
            if (OpenableColumns.DISPLAY_NAME.equals(columns[i])) values[i] = "BetterNotepad-photo.jpg";
            else if (OpenableColumns.SIZE.equals(columns[i])) values[i] = photo.length();
        }
        cursor.addRow(values); return cursor;
    }
    @Override public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"r".equals(mode) && !"w".equals(mode) && !"wt".equals(mode) && !"rw".equals(mode) && !"rwt".equals(mode))
            throw new FileNotFoundException("Unsupported camera file mode");
        try {
            File photo = file(uri);
            if (!photo.isFile()) throw new FileNotFoundException("Capture file unavailable");
            // Only open an already-created capture; a stale grant must not recreate it.
            return ParcelFileDescriptor.open(photo, ParcelFileDescriptor.parseMode(mode) & ~ParcelFileDescriptor.MODE_CREATE);
        } catch (IllegalArgumentException error) { throw new FileNotFoundException("Invalid camera URI"); }
    }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException("Capture file only"); }
    @Override public int update(Uri uri, ContentValues values, String selection, String[] args) { throw new UnsupportedOperationException("Capture file only"); }
    @Override public int delete(Uri uri, String selection, String[] args) { throw new UnsupportedOperationException("Capture file only"); }
}
