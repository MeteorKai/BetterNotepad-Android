import test from "node:test";
import assert from "node:assert/strict";
import { bodyText, firstImage, imageBlocks, imageInsertion, isImagePath } from "../src/images.mjs";
import { createNote, displayTitle, emptyState, parseState, updateNote } from "../src/notes.mjs";

const path = "/images/0123456789abcdef0123456789abcdef.jpg";
const marker = `![图片](${path})`;

test("image paths accept only private, generated raster filenames", () => {
  assert.ok(isImagePath(path));
  assert.ok(isImagePath(path.replace(".jpg", ".png")));
  for (const bad of [null, "", "https://example.org/a.jpg", "content://a", "data:image/png;base64,a", "/images/../notebook-v1.json", `${path}?x`, path.replace(".jpg", ".svg"), path.toUpperCase()]) {
    assert.equal(isImagePath(bad), false);
  }
});

test("inserting an image at a text cursor keeps both paragraphs", () => {
  const result = imageInsertion("前文后文", 2, 2, path);
  const { from, to, insert } = result.changes;
  const content = "前文后文".slice(0, from) + insert + "前文后文".slice(to);
  assert.equal(content, `前文\n${marker}\n后文`);
  assert.equal(content.slice(result.selection.anchor), "后文");
  assert.equal(bodyText(content).replace(/\n/g, ""), "前文后文");
});

test("image-only notes have a writable line and safe card/title text", () => {
  const result = imageInsertion("", 0, 0, path);
  assert.equal(result.changes.insert, `${marker}\n`);
  assert.equal(result.selection.anchor, result.changes.insert.length);
  assert.equal(bodyText(result.changes.insert).trim(), "");
  assert.equal(firstImage(result.changes.insert), path);
  assert.equal(displayTitle({ title: "", content: result.changes.insert }), "无标题便签");
});

test("only private image markers become image blocks, including when adjacent line breaks are edited", () => {
  const content = `文字\n${marker}\n![图片](${path.replace(".jpg", ".png")})\n![图片](https://example.org/a.jpg)\n行内${marker}`;
  const blocks = imageBlocks(content);
  assert.equal(blocks.length, 3);
  assert.equal(content.slice(blocks[0].from, blocks[0].to), marker);
  assert.match(bodyText(content), /https:\/\/example.org/);
  assert.match(bodyText(content), /行内$/);
  assert.throws(() => imageInsertion("", 0, 0, "https://example.org/a.jpg"), /图片路径无效/);
});

test("multiple inline images survive v1 persistence without a schema migration", () => {
  const original = { ...emptyState(), notes: [createNote("old", 1), { ...createNote("new", 2), content: `前文\n${marker}\n中间\n${marker}\n后文` }] };
  const restored = parseState(JSON.stringify(original));
  assert.deepEqual(restored, original);
  assert.equal(imageBlocks(restored.notes[1].content).length, 2);
  const removed = updateNote(restored.notes, "new", { content: bodyText(restored.notes[1].content) }, 3);
  assert.equal(imageBlocks(removed[1].content).length, 0);
  assert.deepEqual(removed[0], original.notes[0]);
});
