import test, { before } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { testJson } from "./test-json.mjs";
import { updateStubs } from "./update-stubs.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = join(root, "build/camera-tests");
const native = join(root, "android/app/src/main/java/com/betternotepad/android");
let java, classpath;

before(async () => {
  const main = readFileSync(join(native, "MainActivity.java"), "utf8");
  const methods = ["imageResult", "openImagePicker", "openCamera", "clearCamera", "onActivityResult", "onDestroy"].map(name => {
    const method = main.match(new RegExp(`    (?:@Override )?(?:private|protected) void ${name}\\([^)]*\\)(?: throws IOException)? \\{[\\s\\S]*?\\n    \\}`))?.[0];
    assert.ok(method, `production ${name} method must exist`); return method;
  });
  const pick = main.match(/        @JavascriptInterface public void pickImage\([\s\S]*?\n        \}/)?.[0];
  assert.ok(pick); methods.push(pick);
  const constants = [...main.matchAll(/    private static final int (?:PICK_IMAGE|TAKE_PHOTO|EXPORT_BACKUP|OPEN_BACKUP) = \d+;/g)].map(match => match[0]);
  assert.equal(constants.length, 4);
  const jdk = [process.env.JAVA_HOME, "C:/Program Files/Java/jdk-17"].find(home => home && existsSync(join(home, "bin/javac.exe")));
  assert.ok(jdk); java = join(jdk, "bin/java.exe");
  const jar = await testJson(root), files = [];
  const stubs = {
    ...updateStubs,
    "android/app/Activity.java": `package android.app;
import android.content.*;import android.net.Uri;
public class Activity extends Context {
 public static final int RESULT_OK=-1,RESULT_CANCELED=0;public boolean destroyed;public String failure="";
 public AlertDialog lastDialog;public int requestCode;public java.util.List<Intent> intents=new java.util.ArrayList<>();
 public java.util.List<Uri> revoked=new java.util.ArrayList<>();public int revokedFlags;
 public void runOnUiThread(Runnable task){task.run();}public boolean isDestroyed(){return destroyed;}
 public void startActivityForResult(Intent intent,int code){if(failure.equals("missing"))throw new ActivityNotFoundException();if(failure.equals("denied"))throw new SecurityException();intents.add(intent);requestCode=code;}
 public void revokeUriPermission(Uri uri,int flags){revoked.add(uri);revokedFlags=flags;}
 protected void onActivityResult(int request,int result,Intent data){}protected void onDestroy(){destroyed=true;}
}`,
    "android/content/ActivityNotFoundException.java": "package android.content;public class ActivityNotFoundException extends RuntimeException {}",
    "android/content/Intent.java": `package android.content;import android.net.Uri;import java.util.*;
public class Intent {
 public static final int FLAG_GRANT_READ_URI_PERMISSION=1,FLAG_GRANT_WRITE_URI_PERMISSION=2;
 public String action,target;public Uri data;public int flags;public ClipData clip;public Map<String,Object> extras=new HashMap<>();
 public Intent(String action){this.action=action;}public Intent(Context context,Class<?> target){this.target=target.getName();}
 public Intent putExtra(String key,Object value){extras.put(key,value);return this;}public void setClipData(ClipData clip){this.clip=clip;}
 public Intent addFlags(int flags){this.flags|=flags;return this;}public Intent setData(Uri uri){data=uri;return this;}public Uri getData(){return data;}
}`,
    "android/content/ClipData.java": `package android.content;import android.net.Uri;public class ClipData {public Uri uri;
 public static ClipData newRawUri(String label,Uri uri){ClipData clip=new ClipData();clip.uri=uri;return clip;}}`,
    "android/content/DialogInterface.java": `package android.content;public interface DialogInterface {
 interface OnClickListener {void onClick(DialogInterface dialog,int which);}interface OnCancelListener {void onCancel(DialogInterface dialog);}}`,
    "android/app/AlertDialog.java": `package android.app;import android.content.*;
public class AlertDialog implements DialogInterface {
 public String[] items;public int theme;public boolean dismissed;OnClickListener choice,negative;OnCancelListener cancel;
 public void choose(int which){choice.onClick(this,which);dismiss();}public void negative(){negative.onClick(this,-2);dismiss();}
 public void cancel(){cancel.onCancel(this);dismiss();}public void dismiss(){dismissed=true;}
 public static class Builder {final Activity activity;final AlertDialog dialog=new AlertDialog();
 public Builder(Activity activity,int theme){this.activity=activity;dialog.theme=theme;}public Builder setTitle(String title){return this;}
 public Builder setItems(String[] items,OnClickListener listener){dialog.items=items;dialog.choice=listener;return this;}
 public Builder setNegativeButton(String text,OnClickListener listener){dialog.negative=listener;return this;}
 public Builder setOnCancelListener(OnCancelListener listener){dialog.cancel=listener;return this;}
 public AlertDialog show(){activity.lastDialog=dialog;return dialog;}}
}`,
    "android/provider/MediaStore.java": `package android.provider;public class MediaStore {
 public static final String ACTION_IMAGE_CAPTURE="android.media.action.IMAGE_CAPTURE",EXTRA_OUTPUT="output";}`,
    "android/R.java": "package android;public class R {public static class style {public static final int Theme_Material_Dialog_Alert=1,Theme_Material_Light_Dialog_Alert=2;}}",
    "android/os/ParcelFileDescriptor.java": `package android.os;import java.io.*;public class ParcelFileDescriptor {
 public static final int MODE_READ_ONLY=0x10000000,MODE_WRITE_ONLY=0x20000000,MODE_READ_WRITE=0x30000000,MODE_CREATE=0x08000000,MODE_TRUNCATE=0x04000000;
 public File file;public int mode;public static int parseMode(String mode){if(mode.equals("r"))return MODE_READ_ONLY;
 if(mode.equals("w")||mode.equals("wt"))return MODE_WRITE_ONLY|MODE_CREATE|MODE_TRUNCATE;
 return MODE_READ_WRITE|MODE_CREATE|(mode.equals("rwt")?MODE_TRUNCATE:0);}
 public static ParcelFileDescriptor open(File file,int mode)throws FileNotFoundException{if(!file.isFile())throw new FileNotFoundException();ParcelFileDescriptor fd=new ParcelFileDescriptor();fd.file=file;fd.mode=mode;return fd;}
}`,
    "com/betternotepad/android/GalleryActivity.java": "package com.betternotepad.android;public class GalleryActivity {}",
  };
  for (const [path, content] of Object.entries(stubs)) {
    const file = join(directory, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, content); files.push(file);
  }
  const fixture = join(directory, "com/betternotepad/android/CameraFixture.java");
  // Compile production control flow and the actual provider; only Android UI and image decoding are substituted.
  writeFileSync(fixture, readFileSync(join(root, "tests/CameraFixture.java"), "utf8")
    .replace("// MAIN_CONSTANTS", constants.join("\n")).replace("// MAIN_IMAGE_METHODS", methods.join("\n")));
  execFileSync(join(jdk, "bin/javac.exe"), ["-encoding", "UTF-8", "--release", "8", "-classpath", jar, "-d", directory,
    ...files, join(native, "CameraProvider.java"), fixture], { encoding: "utf8", timeout: 30000 });
  classpath = `${directory};${jar}`;
});

for (const name of ["chooser-gallery", "chooser-cancel", "chooser-back", "camera-launch", "camera-success", "camera-result-uri-ignored",
  "camera-cancel", "camera-empty", "camera-decode-error", "camera-decode-oom", "camera-missing", "camera-denied", "gallery-missing",
  "camera-no-space", "camera-busy", "camera-retry", "camera-destroy", "dialog-destroy", "provider-scope", "backup-routing", "invalid-request"]) {
  test(`native camera insertion: ${name}`, () => {
    assert.match(execFileSync(java, ["-classpath", classpath, "com.betternotepad.android.CameraFixture", name, directory],
      { encoding: "utf8", timeout: 15000 }), new RegExp(`PASS ${name}`));
  });
}

test("camera insertion has an image-source choice and narrowly scoped temporary file access", () => {
  const main = readFileSync(new URL("../android/app/src/main/java/com/betternotepad/android/MainActivity.java", import.meta.url), "utf8");
  const manifest = readFileSync(new URL("../android/app/src/main/AndroidManifest.xml", import.meta.url), "utf8");
  assert.match(main, /new String\[\]\s*\{\s*"拍照",\s*"从相册选择"\s*\}/);
  assert.match(main, /MediaStore.ACTION_IMAGE_CAPTURE/);
  assert.match(main, /putExtra\(MediaStore.EXTRA_OUTPUT, cameraUri\)/);
  assert.match(main, /setClipData\(ClipData.newRawUri/);
  assert.match(manifest, /CameraProvider"[^>]*android:exported="false"[^>]*android:grantUriPermissions="true"/);
  assert.doesNotMatch(manifest, /android.permission.CAMERA|WRITE_EXTERNAL_STORAGE|MANAGE_EXTERNAL_STORAGE/);
  assert.match(main, /connect-src 'none'/);
  assert.doesNotMatch(main, /Uri.fromFile\(/);
});
