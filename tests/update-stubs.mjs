// JVM-only substitutes for Android boundaries. These do not verify a real system installer.
export const updateStubs = {
  "android/app/Activity.java": `package android.app;
import android.content.*;import android.content.pm.*;
public class Activity extends Context {
 public PackageManager pm=new PackageManager();public java.util.List<Intent> intents=new java.util.ArrayList<>();public boolean failLaunch;
 public PackageManager getPackageManager(){return pm;}public String getString(int id){return repository;}public String repository="";
 public boolean deferUi;public java.util.concurrent.BlockingQueue<Runnable> ui=new java.util.concurrent.LinkedBlockingQueue<>();
 public void runOnUiThread(Runnable task){if(deferUi)ui.add(task);else task.run();}public void startActivity(Intent intent){if(failLaunch)throw new RuntimeException();intents.add(intent);}
}`,
  "android/content/Context.java": `package android.content;import java.io.*;
public class Context {public File cache;public File getCacheDir(){return cache;}public String getPackageName(){return "com.betternotepad.android";}}`,
  "android/content/Intent.java": `package android.content;import android.net.Uri;
public class Intent {public static final String ACTION_VIEW="android.intent.action.VIEW";public static final int FLAG_GRANT_READ_URI_PERMISSION=1;
 public String action,type;public Uri uri;public int flags;public Intent(String action){this.action=action;}public Intent(String action,Uri uri){this.action=action;this.uri=uri;}
 public Intent setDataAndType(Uri uri,String type){this.uri=uri;this.type=type;return this;}public Intent addFlags(int flags){this.flags|=flags;return this;}}`,
  "android/content/pm/PackageManager.java": `package android.content.pm;
public class PackageManager {public static final int GET_SIGNING_CERTIFICATES=134217728,GET_SIGNATURES=64;
 public PackageInfo installed,candidate;public boolean permitted;public int archives;
 public PackageInfo getPackageInfo(String name,int flags){return installed;}public PackageInfo getPackageArchiveInfo(String path,int flags){archives++;return candidate;}
 public boolean canRequestPackageInstalls(){return permitted;}}`,
  "android/content/pm/PackageInfo.java": `package android.content.pm;public class PackageInfo {
 public String packageName,versionName;public int versionCode;public SigningInfo signingInfo;public Signature[] signatures;public ApplicationInfo applicationInfo=new ApplicationInfo();
 public long getLongVersionCode(){return versionCode;}}`,
  "android/content/pm/Signature.java": `package android.content.pm;public class Signature {final byte[] bytes;public Signature(byte[] bytes){this.bytes=bytes;}public byte[] toByteArray(){return bytes;}}`,
  "android/content/pm/SigningInfo.java": `package android.content.pm;public class SigningInfo {public Signature[] signers;public Signature[] getApkContentsSigners(){return signers;}}`,
  "android/content/pm/ApplicationInfo.java": `package android.content.pm;public class ApplicationInfo {public int minSdkVersion=26;}`,
  "android/os/Build.java": `package android.os;public class Build {public static class VERSION {public static int SDK_INT=34;}}`,
  "android/webkit/JavascriptInterface.java": `package android.webkit;public @interface JavascriptInterface {}`,
  "android/provider/Settings.java": `package android.provider;public class Settings {public static final String ACTION_MANAGE_UNKNOWN_APP_SOURCES="android.settings.MANAGE_UNKNOWN_APP_SOURCES";}`,
  "android/net/Uri.java": `package android.net;public class Uri {final java.net.URI uri;Uri(String text){uri=java.net.URI.create(text);}
 public static Uri parse(String text){return new Uri(text);}public String getScheme(){return uri.getScheme();}public String getAuthority(){return uri.getRawAuthority();}
 public String getPath(){return uri.getPath();}public String getQuery(){return uri.getRawQuery();}public String getFragment(){return uri.getRawFragment();}public String toString(){return uri.toString();}}`,
  "android/content/ContentProvider.java": `package android.content;import android.net.Uri;import android.database.Cursor;import android.os.ParcelFileDescriptor;import java.io.*;
public abstract class ContentProvider {public Context context;public Context getContext(){return context;}
 public abstract boolean onCreate();public abstract String getType(Uri uri);public abstract Cursor query(Uri uri,String[] projection,String selection,String[] args,String sort);
 public abstract Uri insert(Uri uri,ContentValues values);public abstract int update(Uri uri,ContentValues values,String selection,String[] args);public abstract int delete(Uri uri,String selection,String[] args);
 public abstract ParcelFileDescriptor openFile(Uri uri,String mode)throws FileNotFoundException;}`,
  "android/content/ContentValues.java": "package android.content;public class ContentValues {}",
  "android/database/Cursor.java": "package android.database;public interface Cursor {}",
  "android/database/MatrixCursor.java": "package android.database;public class MatrixCursor implements Cursor {public String[] columns;public Object[] values;public MatrixCursor(String[] columns){this.columns=columns;}public void addRow(Object[] values){this.values=values;}}",
  "android/os/ParcelFileDescriptor.java": `package android.os;import java.io.*;public class ParcelFileDescriptor {public static final int MODE_READ_ONLY=268435456;public File file;public int mode;
 public static ParcelFileDescriptor open(File file,int mode)throws FileNotFoundException {if(!file.isFile())throw new FileNotFoundException();ParcelFileDescriptor result=new ParcelFileDescriptor();result.file=file;result.mode=mode;return result;}}`,
  "android/provider/OpenableColumns.java": "package android.provider;public class OpenableColumns {public static final String DISPLAY_NAME=\"_display_name\",SIZE=\"_size\";}",
  "com/betternotepad/android/R.java": "package com.betternotepad.android;class R {static class string {static final int update_repository=1;}}",
};
