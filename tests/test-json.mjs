import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";

const digest = "3cf6cd6892e32e2b4c1c39e0f52f5248a2f5b37646fdfbb79a66b46b618414ed";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
export async function testJson(root) {
  const directory = join(root, "build/test-dependencies"), jar = join(directory, "json-20240303.jar");
  if (!existsSync(jar)) {
    const response = await fetch("https://repo.maven.apache.org/maven2/org/json/json/20240303/json-20240303.jar");
    assert.ok(response.ok); const bytes = Buffer.from(await response.arrayBuffer()); assert.equal(hash(bytes), digest);
    mkdirSync(directory, { recursive: true });
    const temporary = `${jar}.${randomUUID()}.tmp`; writeFileSync(temporary, bytes);
    try {
      // Parallel Java suites may complete the same first download together.
      if (!existsSync(jar)) {
        try { renameSync(temporary, jar); }
        catch (error) { if (!existsSync(jar) || hash(readFileSync(jar)) !== digest) throw error; }
      }
    } finally { if (existsSync(temporary)) unlinkSync(temporary); }
  }
  assert.equal(hash(readFileSync(jar)), digest);
  return jar; // Test-only JVM JSON, never included in the APK.
}
