import test, { before } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { stubs } from "./widget-stubs.mjs";
import { testJson } from "./test-json.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = join(root, "build/widget-tests");
const sourceDirectory = join(root, "android/app/src/main/java/com/betternotepad/android");
let java, classpath;
before(async () => {
  const jdk = [process.env.JAVA_HOME, "C:/Program Files/Java/jdk-17"].find(home => home && existsSync(join(home, "bin/javac.exe")));
  assert.ok(jdk); java = join(jdk, "bin/java.exe");
  const jar = await testJson(root);
  const files = [];
  function write(path, content) { const file = join(directory, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, content); files.push(file); }
  for (const [path, content] of Object.entries(stubs)) write(path, content);
  write("android/widget/TextView.java", 'package android.widget;public class TextView{public String text;public void setText(String value){text=value;}}');
  const provider = readFileSync(join(sourceDirectory, "NoteWidgetProvider.java"), "utf8");
  const config = readFileSync(join(sourceDirectory, "WidgetConfigActivity.java"), "utf8");
  const apply = config.match(/^    private void apply\(\) \{[\s\S]*?^    \}/m)?.[0]; assert.ok(apply);
  const pinStatus = ["showStatus", "checkPinResult", "onResume", "onSaveInstanceState"].map(name => {
    const method = config.match(new RegExp(`^    (?:@Override )?(?:private|protected) [^\\n]*?\\b${name}\\([^\\n]*\\) \\{[\\s\\S]*?^    \\}`, "m"))?.[0];
    assert.ok(method, name); return method;
  }).join("\n");
  const restorePin = config.match(/        if \(state != null\) \{[\s\S]*?^        \}/m)?.[0]; assert.ok(restorePin);
  write("com/betternotepad/android/WidgetConfigActivity.java", `package com.betternotepad.android;
import android.app.*;import android.appwidget.*;import android.content.*;import android.os.*;import android.widget.*;import java.util.*;
public class WidgetConfigActivity extends Activity {int widgetId,fallbacks;String selected;ArrayList<String> noteIds=new ArrayList<>();boolean saving;
boolean pinPending;String pendingNote;int[] beforePinIds=new int[0];
Button confirm=new Button();ListView list=new ListView();TextView message=new TextView(),status=new TextView();
WidgetConfigActivity(Context c,int id,String note){files=c.files;widgetId=id;selected=note;noteIds.add(note);}void unsupported(){fallbacks++;}void runApply(){apply();}
void restore(android.os.Bundle state){${restorePin}}
${pinStatus}
${apply}
}`);
  const main = readFileSync(join(sourceDirectory, "MainActivity.java"), "utf8");
  const lifecycle = ["onResume", "onPause", "onNewIntent", "notifyResume"].map(name => {
    const method = main.match(new RegExp(`^    @Override protected void ${name}\\([^\\n]*\\) \\{[^\\n]+`, "m"))?.[0]
      ?? main.match(new RegExp(`^    (?:@Override )?(?:protected|private) [^\\n]*?\\b${name}\\([^\\n]*\\) \\{[\\s\\S]*?^    \\}`, "m"))?.[0];
    assert.ok(method, name); return method;
  }).join("\n");
  write("com/betternotepad/android/MainActivity.java", `package com.betternotepad.android;
import android.app.Activity;import android.content.Intent;import org.json.JSONObject;import java.util.*;
public class MainActivity extends Activity {boolean webReady,resumed;String pendingNote;Web web=new Web();void testNotify(){notifyResume();}
static class Web {String handled="true";List<String> scripts=new ArrayList<>();void evaluateJavascript(String script,java.util.function.Consumer<String> callback){scripts.add(script);callback.accept(handled);}}
${lifecycle}
}`);
  const references = [...provider.matchAll(/R\.(id|layout|drawable)\.(\w+)/g)];
  const kinds = ["id", "layout", "drawable"];
  let next = 1;
  write("com/betternotepad/android/R.java", `package com.betternotepad.android;class R {${kinds.map(kind => `static class ${kind}{${[...new Set(references.filter(match => match[1] === kind).map(match => match[2]))].map(name => `static final int ${name}=${next++};`).join("")}}`).join("")}}`);
  const fixture = join(root, "tests/WidgetFixture.java");
  execFileSync(join(jdk, "bin/javac.exe"), ["-encoding", "UTF-8", "--release", "8", "-classpath", jar, "-d", directory,
    ...files, join(root, "tests/android-stubs/AtomicFile.java"), ...["NotebookStore", "BackupData", "BackupArchive", "NoteWidgetProvider", "WidgetActionReceiver"].map(name => join(sourceDirectory, `${name}.java`)), fixture], { encoding: "utf8" });
  classpath = `${directory};${jar}`;
});

for (const name of ["store-cas", "store-rollback", "store-concurrency", "store-metadata", "private-model", "multi-render", "resize-theme", "todo-click", "stale-targets", "deleted-and-restored", "failures", "bindings", "pin-confirmation", "pin-fallback", "pin-not-created", "pin-not-registered", "pin-restored", "public-private-receivers", "configuration", "launch-lifecycle"]) {
  test(`native desktop widget: ${name}`, () => {
    const output = execFileSync(java, ["-Xmx256m", "-classpath", classpath, "com.betternotepad.android.WidgetFixture", name, directory], { encoding: "utf8", timeout: 15000 });
    assert.match(output, new RegExp(`PASS ${name}`));
  });
}

test("widget manifest/layouts expose only the intended entry points and supported RemoteViews", () => {
  const manifest = readFileSync(join(root, "android/app/src/main/AndroidManifest.xml"), "utf8");
  assert.match(manifest, /NoteWidgetProvider" android:exported="true" android:permission="android.permission.BIND_APPWIDGET"/);
  assert.match(manifest, /WidgetActionReceiver" android:exported="false"/);
  assert.match(manifest, /WidgetConfigActivity" android:exported="true"/);
  assert.doesNotMatch(manifest, /android:process=|<uses-permission[^>]*BIND_APPWIDGET|SYSTEM_ALERT_WINDOW/);
  assert.doesNotMatch(manifest.match(/<receiver android:name=".WidgetActionReceiver"[^>]*\/>/)[0], /meta-data|intent-filter/);
  const metadata = readFileSync(join(root, "android/app/src/main/res/xml/note_widget.xml"), "utf8");
  assert.match(metadata, /updatePeriodMillis="0"/); assert.match(metadata, /resizeMode="horizontal\|vertical"/);
  for (const name of ["note_widget", "widget_todo"]) {
    const xml = readFileSync(join(root, `android/app/src/main/res/layout/${name}.xml`), "utf8");
    for (const match of xml.matchAll(/<([A-Z]\w*)\b/g)) assert.ok(["LinearLayout", "TextView", "ImageView"].includes(match[1]));
  }
});
