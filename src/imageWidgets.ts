import { EditorState, StateField } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { isolateHistory } from "@codemirror/commands";
import { imageBlocks } from "./images.mjs";

class ImageWidget extends WidgetType {
  constructor(readonly path: string) { super(); }
  eq(other: ImageWidget) { return this.path === other.path; }

  toDOM(view: EditorView) {
    const figure = document.createElement("div");
    figure.className = "inline-image";
    figure.contentEditable = "false";
    const image = document.createElement("img");
    image.src = this.path;
    image.alt = "便签中的图片";
    image.onload = () => view.requestMeasure();
    image.onerror = () => { figure.classList.add("image-unavailable"); view.requestMeasure(); };
    const enlarge = document.createElement("button");
    enlarge.type = "button";
    enlarge.className = "view-image";
    enlarge.dataset.imagePath = this.path;
    enlarge.setAttribute("aria-label", "查看图片大图");
    enlarge.append(image);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-image";
    remove.textContent = "移除图片";
    remove.setAttribute("aria-label", "移除这张图片");
    remove.onclick = () => {
      const position = view.posAtDOM(figure);
      const block = imageBlocks(view.state.doc.toString()).find(item => item.from === position);
      if (!block) return;
      const line = view.state.doc.lineAt(block.from);
      const to = block.from === line.from && block.to === line.to ? Math.min(block.to + 1, view.state.doc.length) : block.to;
      view.dispatch({ changes: { from: block.from, to }, selection: { anchor: block.from }, userEvent: "delete", annotations: isolateHistory.of("full") });
      view.focus();
    };
    figure.append(enlarge, remove);
    return figure;
  }
}

function decorations(state: EditorState) {
  return Decoration.set(imageBlocks(state.doc.toString()).map(block =>
    Decoration.replace({ widget: new ImageWidget(block.path), block: true, inclusive: false }).range(block.from, block.to)));
}

export const inlineImages = StateField.define<DecorationSet>({
  create: decorations,
  update: (value, transaction) => transaction.docChanged ? decorations(transaction.state) : value,
  provide: field => [EditorView.decorations.from(field), EditorView.atomicRanges.of(view => view.state.field(field))],
});
