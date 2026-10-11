import test, { before } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { testJson } from "./test-json.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = join(root, "build/backup-tests");
let java, classpath;
before(async () => {
  const jdk = [process.env.JAVA_HOME, "C:/Program Files/Java/jdk-17"].find(home => home && existsSync(join(home, "bin/javac.exe")));
  assert.ok(jdk, "原生备份测试需要 JDK 17");
  java = join(jdk, "bin/java.exe");
  const jar = await testJson(root);
  mkdirSync(directory, { recursive: true });
  const sourceDirectory = join(root, "android/app/src/main/java/com/betternotepad/android");
  const source = readFileSync(join(sourceDirectory, "MainActivity.java"), "utf8");
  const names = ["pruneImages", "readNotebook", "writeNotebook", "clearBackupStage", "backupResult", "beginBackup", "handleBackupResult"];
  const methods = names.map(name => {
    const matches = [...source.matchAll(new RegExp(`^    private [^\\n]*?\\b${name}\\([^\\n]*\\) (?:throws [^\\n{]+ )?\\{[\\s\\S]*?^    \\}`, "gm"))];
    assert.ok(matches.length, `Production method missing: ${name}`); return matches.map(match => match[0]).join("\n");
  }).join("\n");
  const bridge = source.match(/^    public final class NotebookBridge \{[\s\S]*?^    \}/m)?.[0];
  assert.ok(bridge);
  const actual = `${methods}\n${bridge}`.replaceAll("@JavascriptInterface ", "").replaceAll("android.content.ActivityNotFoundException", "ActivityNotFoundException").replaceAll("MainActivity.this", "BackupFixture.this");
  const fixture = join(directory, "BackupFixture.java");
  writeFileSync(fixture, readFileSync(join(root, "tests/BackupFixture.java"), "utf8").replace("// MAIN_METHODS", actual));
  execFileSync(join(jdk, "bin/javac.exe"), ["-encoding", "UTF-8", "--release", "8", "-classpath", jar, "-d", directory,
    join(root, "tests/android-stubs/AtomicFile.java"), join(sourceDirectory, "NotebookStore.java"), join(sourceDirectory, "BackupArchive.java"), join(sourceDirectory, "BackupData.java"), fixture], { encoding: "utf8" });
  classpath = `${directory};${jar}`;
});

for (const name of ["roundtrip", "bad-paths", "duplicate", "truncated", "checksum", "limits", "schema", "missing-images", "rollback", "prune", "shared-image", "note-metadata", "bad-metadata", "checked-bridge", "widget-during-preview", "native-flow", "native-cancel", "native-empty", "native-error"]) {
  test(`native ZIP backup and restore: ${name}`, () => {
    const output = execFileSync(java, ["-Xmx256m", "-classpath", classpath, "com.betternotepad.android.BackupFixture", name, directory], { encoding: "utf8" });
    assert.match(output, new RegExp(`PASS ${name}`));
  });
}
