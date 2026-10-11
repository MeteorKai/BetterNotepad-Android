import test, { before } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const directory = fileURLToPath(new URL("../build/picker-tests/", import.meta.url));
let java;
before(() => {
  const source = readFileSync(new URL("../android/app/src/main/java/com/betternotepad/android/GalleryActivity.java", import.meta.url), "utf8");
  const main = readFileSync(new URL("../android/app/src/main/java/com/betternotepad/android/MainActivity.java", import.meta.url), "utf8");
  const launcher = source.match(/    private void openSystemPicker\(\) \{[\s\S]*?\n    \}/)?.[0];
  assert.ok(launcher, "原生相册选择入口应存在");
  assert.match(main, /imageRequest = requestId;\s+openImagePicker\(\);/);
  assert.match(main, /new Intent\(this, GalleryActivity.class\)/);
  assert.match(source, /system.setOnClickListener\(view -> openSystemPicker\(\)\)/);
  const jdk = [process.env.JAVA_HOME, "C:/Program Files/Java/jdk-17"].find(home => home && existsSync(join(home, "bin/javac.exe")));
  assert.ok(jdk, "原生选择器回归测试需要 JDK 17");
  java = join(jdk, "bin/java.exe");
  mkdirSync(directory, { recursive: true });
  const fixture = join(directory, "PickerFixture.java");
  // Compile the production launch method, not a JavaScript reimplementation.
  // Only Android Intent/Activity boundaries are faked; this is not device testing.
  writeFileSync(fixture, `import java.util.*;
public class PickerFixture {
    static final int PICK_IMAGE = 41;
    static class ActivityNotFoundException extends RuntimeException { }
    static class MediaStore {
        static final String ACTION_PICK_IMAGES = "android.provider.action.PICK_IMAGES";
        static class Images { static class Media {
            static final String EXTERNAL_CONTENT_URI = "content://media/external/images/media";
        } }
    }
    static class Intent {
        static final String ACTION_PICK = "android.intent.action.PICK";
        static final String ACTION_GET_CONTENT = "android.intent.action.GET_CONTENT";
        static final String CATEGORY_OPENABLE = "android.intent.category.OPENABLE";
        final String action;
        String data, type;
        final Set<String> categories = new HashSet<>();
        Intent(String action) { this.action = action; }
        Intent setType(String type) { this.type = type; data = null; return this; }
        Intent setDataAndType(String data, String type) { this.data = data; this.type = type; return this; }
        Intent addCategory(String category) { categories.add(category); return this; }
    }
    final String mode;
    final List<Intent> attempts = new ArrayList<>();
    Intent selected;
    static class TextView { String text; void setText(String text) { this.text = text; } }
    final TextView status = new TextView();
    PickerFixture(String mode) { this.mode = mode; }
    void startActivityForResult(Intent intent, int code) {
        check(code == PICK_IMAGE, "request code");
        attempts.add(intent);
        if (mode.equals("denied-all") || (mode.equals("denied-system") && intent.action.equals(MediaStore.ACTION_PICK_IMAGES))) throw new SecurityException();
        String available = mode.equals("system") ? MediaStore.ACTION_PICK_IMAGES :
            mode.equals("gallery") || mode.equals("denied-system") ? Intent.ACTION_PICK :
            mode.equals("files") ? Intent.ACTION_GET_CONTENT : "none";
        if (!intent.action.equals(available)) throw new ActivityNotFoundException();
        selected = intent;
    }
${launcher}
    static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }
    public static void main(String[] args) {
        PickerFixture app = new PickerFixture(args[0]);
        app.openSystemPicker();
        String[] order = { MediaStore.ACTION_PICK_IMAGES, Intent.ACTION_PICK, Intent.ACTION_GET_CONTENT };
        int count = args[0].equals("system") ? 1 : args[0].equals("gallery") || args[0].equals("denied-system") ? 2 : 3;
        check(app.attempts.size() == count, "fallback count");
        for (int i = 0; i < count; i++) {
            Intent intent = app.attempts.get(i);
            check(intent.action.equals(order[i]), "picker priority");
            check("image/*".equals(intent.type), "images only");
            if (i == 1) check(MediaStore.Images.Media.EXTERNAL_CONTENT_URI.equals(intent.data), "gallery collection URI retained");
            if (i == 2) check(intent.categories.contains(Intent.CATEGORY_OPENABLE), "file fallback is openable");
        }
        if (args[0].equals("none") || args[0].equals("denied-all")) {
            check(app.selected == null && app.status.text.contains("相册"), "gallery displays an unavailable-picker message");
        } else check(app.selected == app.attempts.get(count - 1) && app.status.text == null, "stop after successful launch");
        System.out.println("PASS: " + args[0]);
    }
}`, "utf8");
  execFileSync(join(jdk, "bin/javac.exe"), ["-encoding", "UTF-8", "--release", "8", "-d", directory, fixture], { timeout: 30000, encoding: "utf8" });
});

for (const [mode, label] of [
  ["system", "prefer the system photo picker"],
  ["gallery", "fall back to the gallery with an image collection URI"],
  ["files", "use files only when both photo and gallery pickers are missing"],
  ["none", "display unavailable system pickers inside the gallery"],
  ["denied-system", "fall back to the gallery when launching the photo picker is denied"],
  ["denied-all", "report an error without crashing when all pickers are denied"],
]) {
  test(`native image picker: ${label}`, () => {
    assert.match(execFileSync(java, ["-cp", directory, "PickerFixture", mode], { timeout: 10000, encoding: "utf8" }), new RegExp(`PASS: ${mode}`));
  });
}
