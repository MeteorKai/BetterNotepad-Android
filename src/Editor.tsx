import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, drawSelection, keymap, placeholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, isolateHistory } from "@codemirror/commands";
import { imageInsertion, isImagePath } from "./images.mjs";
import { inlineImages } from "./imageWidgets";

export interface EditorHandle { captureImageInsertion(): (path: string | null) => boolean }

const Editor = forwardRef<EditorHandle, {
  content: string; onChange: (value: string) => void; onViewImage: (path: string) => void;
}>(function Editor({ content, onChange, onViewImage }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const change = useRef(onChange);
  const insertion = useRef<{ from: number; to: number } | null>(null);
  change.current = onChange;

  useImperativeHandle(ref, () => ({ captureImageInsertion() {
    const editor = view.current;
    if (!editor) return () => false;
    const { from, to } = editor.state.selection.main;
    insertion.current = { from, to };
    return path => {
      const range = insertion.current;
      insertion.current = null;
      if (!path || !range || view.current !== editor) return false;
      editor.dispatch({ ...imageInsertion(editor.state.doc.toString(), range.from, range.to, path), annotations: isolateHistory.of("full") });
      editor.focus();
      return true;
    };
  } }), []);

  useEffect(() => {
    const editor = new EditorView({
      parent: host.current!,
      state: EditorState.create({ doc: content, extensions: [
        history(), drawSelection(), keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.lineWrapping, placeholder("从这里开始，记下你的想法…"), inlineImages,
        EditorView.contentAttributes.of({ "aria-label": "便签内容", "autocapitalize": "sentences" }),
        EditorView.updateListener.of(update => {
          if (update.docChanged && insertion.current) insertion.current = {
            from: update.changes.mapPos(insertion.current.from, 1),
            to: update.changes.mapPos(insertion.current.to, 1),
          };
          if (update.docChanged) change.current(update.state.doc.toString());
        }),
        EditorView.theme({
          "&": { height: "100%", background: "transparent", color: "var(--ink)" },
          ".cm-scroller": { overflow: "auto", fontFamily: "inherit", lineHeight: "1.9" },
          ".cm-content": { padding: "16px 24px 120px", minHeight: "100%", caretColor: "var(--ink)" },
          ".cm-line": { padding: "0" },
          "&.cm-focused": { outline: "none" },
          ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { background: "var(--selection)" },
          ".cm-cursor": { borderLeftColor: "var(--ink)" },
          ".cm-placeholder": { color: "var(--faint)" },
        }),
      ] }),
    });
    view.current = editor;
    return () => { editor.destroy(); view.current = null; };
    // Each note gets its own editor; content is owned by CodeMirror while mounted.
  }, []);

  return <div className="editor-host" ref={host} onClick={event => {
    const button = (event.target as HTMLElement).closest?.<HTMLButtonElement>(".view-image");
    if (button && event.currentTarget.contains(button) && isImagePath(button.dataset.imagePath)) onViewImage(button.dataset.imagePath!);
  }} />;
});

export default Editor;
