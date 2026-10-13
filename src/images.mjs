// Only app-owned raster images are embedded; never content:// or remote URLs.
export function isImagePath(path) {
  return typeof path === "string" && /^\/images\/[a-f0-9]{32}\.(jpg|png)$/.test(path);
}

export function imageBlocks(content) {
  return Array.from(content.matchAll(/!\[图片\]\((\/images\/[a-f0-9]{32}\.(?:jpg|png))\)/g), match => ({
    from: match.index, to: match.index + match[0].length, path: match[1],
  }));
}

export function bodyText(content) {
  let text = content;
  for (const block of imageBlocks(content).reverse()) text = text.slice(0, block.from) + text.slice(block.to);
  return text;
}

export function firstImage(content) {
  return imageBlocks(content)[0]?.path;
}

export function imageInsertion(content, from, to, path) {
  if (!isImagePath(path)) throw new Error("图片路径无效，请重新选择图片。");
  const insert = (from > 0 && content[from - 1] !== "\n" ? "\n" : "") + `![图片](${path})\n`;
  return { changes: { from, to, insert }, selection: { anchor: from + insert.length }, scrollIntoView: true, userEvent: "input" };
}

export function textAfterImage(content, end) {
  const hasBreak = content[end] === "\n";
  const from = hasBreak ? end + 1 : end;
  const insert = hasBreak ? (from === content.length || content[from] === "\n" ? "" : "\n") : (from === content.length ? "\n" : "\n\n");
  return { changes: { from, insert }, selection: { anchor: hasBreak ? from : from + 1 }, scrollIntoView: true, userEvent: insert ? "input" : "select" };
}
