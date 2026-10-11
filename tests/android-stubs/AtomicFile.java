package android.util;
import java.io.*;
import java.nio.file.*;

// JVM-only disk boundary, not a replacement for Android AtomicFile validation.
public class AtomicFile {
    public final File base, temp;
    public boolean fail;
    public static boolean failAll;
    public AtomicFile(File base) { this.base = base; temp = new File(base.getPath() + ".new"); }
    public File getBaseFile() { return base; }
    public byte[] readFully() throws IOException { return Files.readAllBytes(base.toPath()); }
    public FileOutputStream startWrite() throws IOException { if (fail || failAll) throw new IOException("disk full"); return new FileOutputStream(temp); }
    public void finishWrite(FileOutputStream stream) throws IOException { stream.close(); Files.move(temp.toPath(), base.toPath(), StandardCopyOption.REPLACE_EXISTING); }
    public void failWrite(FileOutputStream stream) { try { stream.close(); } catch (IOException ignored) { } temp.delete(); }
}
