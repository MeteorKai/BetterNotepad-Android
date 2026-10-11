import test, { before } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { testJson } from "./test-json.mjs";
import { updateStubs } from "./update-stubs.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = join(root, "build/update-tests");
const native = join(root, "android/app/src/main/java/com/betternotepad/android");
let java, classpath;
before(async () => {
  const jdk = [process.env.JAVA_HOME, "C:/Program Files/Java/jdk-17"].find(home => home && existsSync(join(home, "bin/javac.exe")));
  assert.ok(jdk); java = join(jdk, "bin/java.exe");
  const jar = await testJson(root), files = [];
  for (const [path, content] of Object.entries(updateStubs)) {
    const file = join(directory, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, content); files.push(file);
  }
  execFileSync(join(jdk, "bin/javac.exe"), ["-encoding", "UTF-8", "--release", "8", "-classpath", jar, "-d", directory,
    ...files, ...["UpdateSource", "AppUpdater", "UpdateProvider"].map(name => join(native, `${name}.java`)), join(root, "tests/UpdateFixture.java")], { encoding: "utf8" });
  classpath = `${directory};${jar}`;
});

for (const name of ["versions", "repository", "release", "assets", "network-errors", "download", "download-errors", "cancel", "redirects", "package-validation",
  "native-empty", "native-current", "native-older", "native-cancel", "native-permission", "native-old-android", "native-invalid-apk", "native-invalid-package", "native-cancel-install", "native-changed-apk", "native-installer-failure", "provider"]) {
  test(`native updater: ${name}`, () => {
    const result = execFileSync(java, ["-classpath", classpath, "com.betternotepad.android.UpdateFixture", name, directory], { encoding: "utf8", timeout: 15000 });
    assert.match(result, new RegExp(`PASS ${name}`));
  });
}

test("update source points to the public BetterNotepad Android releases", () => {
  const resource = readFileSync(join(root, "android/app/src/main/res/values/strings.xml"), "utf8");
  assert.match(resource, /name="update_repository"[^>]*>MeteorKai\/BetterNotepad-Android<\/string>/);
});

test("updater permissions and private APK sharing do not loosen the WebView boundary", () => {
  const manifest = readFileSync(join(root, "android/app/src/main/AndroidManifest.xml"), "utf8");
  for (const name of ["INTERNET", "REQUEST_INSTALL_PACKAGES"]) assert.match(manifest, new RegExp(`android.permission.${name}`));
  assert.match(manifest, /UpdateProvider"[^>]*android:exported="false"[^>]*android:grantUriPermissions="true"/);
  assert.doesNotMatch(manifest, /MANAGE_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE|usesCleartextTraffic="true"/);
  const main = readFileSync(join(native, "MainActivity.java"), "utf8");
  assert.match(main, /connect-src 'none'/); assert.match(main, /if \(!isLocal\(uri\)\) return response\(403/);
  assert.match(main, /addJavascriptInterface\(updater, "BetterNotepadUpdates"\)/); assert.match(main, /updater.close\(\)/);
});
