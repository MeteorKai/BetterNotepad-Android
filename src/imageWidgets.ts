import { Annotation, EditorState, StateField } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import type { DecorationSet } from "@codemirror/view";
import { isolateHistory } from "@codemirror/commands";
import { imageBlocks, textAfterImage } from "./images.mjs";

export const confirmedImageRemoval = Annotation.define<boolean>();
export const protectImages = EditorState.transactionFilter.of(transaction => {
  if (!transaction.docChanged || transaction.annotation(confirmedImageRemoval) || transaction.isUserEvent("undo") || transaction.isUserEvent("redo")) return transaction;
  const blocks = imageBlocks(transaction.startState.doc.toString());
  let touchesImage = false;
  transaction.changes.iterChangedRanges((from, to) => {
    if (blocks.some(block => from < block.to && to > block.from)) touchesImage = true;
  });
  // Android IME edits can bypass key bindings. Reject the whole edit so the cursor stays put too.
  return touchesImage ? [] : transaction;
});

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
    remove.textContent = "移除";
    remove.dataset.imagePath = this.path;
    remove.setAttribute("aria-label", "移除这张图片（需确认）");
    const gap = document.createElement("button");
    gap.type = "button";
    gap.className = "image-input-gap";
    gap.setAttribute("aria-label", "在这张图片下方输入文字");
    gap.onclick = () => {
      const position = view.posAtDOM(figure);
      const content = view.state.doc.toString();
      const block = imageBlocks(content).find(item => item.from === position);
      if (!block) return;
      view.dispatch({ ...textAfterImage(content, block.to), annotations: isolateHistory.of("full") });
      view.focus();
    };
    figure.append(enlarge, gap, remove);
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
