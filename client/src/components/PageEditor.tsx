import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { EditorState, Compartment } from "@codemirror/state";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  rectangularSelection,
  crosshairCursor,
  highlightSpecialChars,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  HighlightStyle,
  bracketMatching,
} from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { tags as t } from "@lezer/highlight";
import { markdown } from "@codemirror/lang-markdown";

interface Props {
  initial: string;
  onChange: (value: string) => void;
  theme: "light" | "dark";
  /** When set, scroll the editor + place the caret at this 1-based line. */
  jumpToLine?: number | null;
  /** Called after a jump has been applied so the parent can clear the request. */
  onJumped?: () => void;
}

const lightHighlight = HighlightStyle.define([
  { tag: t.heading1, color: "#1c1c1b", fontWeight: "700" },
  { tag: t.heading2, color: "#1c1c1b", fontWeight: "700" },
  { tag: t.heading3, color: "#1c1c1b", fontWeight: "600" },
  { tag: t.heading, color: "#1c1c1b", fontWeight: "600" },
  { tag: t.strong, color: "#1c1c1b", fontWeight: "700" },
  { tag: t.emphasis, color: "#1c1c1b", fontStyle: "italic" },
  { tag: t.link, color: "#4f46e5", textDecoration: "underline" },
  { tag: t.url, color: "#4f46e5" },
  { tag: t.monospace, color: "#b91c1c", background: "#fef2f2" },
  { tag: t.contentSeparator, color: "#9ca3af" },
  { tag: t.list, color: "#4f46e5" },
  { tag: t.quote, color: "#5a5a58", fontStyle: "italic" },
  { tag: t.meta, color: "#8a8a88" },
  { tag: t.processingInstruction, color: "#8a8a88" },
]);

const darkHighlight = HighlightStyle.define([
  { tag: t.heading1, color: "#ececec", fontWeight: "700" },
  { tag: t.heading2, color: "#ececec", fontWeight: "700" },
  { tag: t.heading3, color: "#ececec", fontWeight: "600" },
  { tag: t.heading, color: "#ececec", fontWeight: "600" },
  { tag: t.strong, color: "#ececec", fontWeight: "700" },
  { tag: t.emphasis, color: "#ececec", fontStyle: "italic" },
  { tag: t.link, color: "#a5b4fc", textDecoration: "underline" },
  { tag: t.url, color: "#a5b4fc" },
  { tag: t.monospace, color: "#fca5a5", background: "#3a1f1f" },
  { tag: t.contentSeparator, color: "#7a7a7a" },
  { tag: t.list, color: "#a5b4fc" },
  { tag: t.quote, color: "#b3b3b3", fontStyle: "italic" },
  { tag: t.meta, color: "#7a7a7a" },
  { tag: t.processingInstruction, color: "#7a7a7a" },
]);

function buildTheme(mode: "light" | "dark") {
  const isDark = mode === "dark";
  return EditorView.theme(
    {
      "&": {
        fontSize: "13.5px",
        height: "100%",
        backgroundColor: isDark ? "#232323" : "#ffffff",
        color: isDark ? "#ececec" : "#1c1c1b",
      },
      ".cm-scroller": {
        fontFamily:
          "JetBrains Mono, SF Mono, Consolas, monospace",
        lineHeight: "1.55",
      },
      ".cm-content": { padding: "16px 4px 80px" },
      ".cm-gutters": {
        backgroundColor: isDark ? "#1a1a1a" : "#fafaf9",
        color: isDark ? "#7a7a7a" : "#a0a0a0",
        border: "none",
        borderRight: isDark ? "1px solid #333" : "1px solid #e5e5e3",
      },
      ".cm-activeLine": {
        backgroundColor: isDark
          ? "rgba(129,140,248,0.07)"
          : "rgba(99,102,241,0.05)",
      },
      ".cm-activeLineGutter": {
        backgroundColor: isDark
          ? "rgba(129,140,248,0.12)"
          : "rgba(99,102,241,0.08)",
        color: isDark ? "#a5b4fc" : "#4f46e5",
      },
      ".cm-selectionBackground, ::selection": {
        backgroundColor: isDark ? "#2b2d50" : "#eef0ff !important",
      },
      ".cm-cursor": {
        borderLeftColor: isDark ? "#a5b4fc" : "#4f46e5",
      },
      ".cm-line": { padding: "0 12px" },
    },
    { dark: isDark },
  );
}

export interface CursorContext {
  /** True when the caret is on a line that lives inside a fenced block
   *  (between an open ``` line and its closing ``` line). */
  inFence: boolean;
  /** The fence language tag (e.g. "html-embed", "steps") when
   *  inFence is true; empty otherwise. */
  fenceLang: string;
}

export interface PageEditorHandle {
  /**
   * Insert `text` at the current cursor position. If the editor has a
   * selection the selection is replaced. The caret ends up right after
   * the inserted text and the editor gets focus.
   */
  insertAtCursor: (text: string) => void;
  /**
   * Inspect the document up to the caret and report whether the caret
   * is currently inside a fenced block (and which kind). Useful for
   * choosing a context-appropriate insertion shape.
   */
  getCursorContext: () => CursorContext;
}

export const PageEditor = forwardRef<PageEditorHandle, Props>(function PageEditor(
  { initial, onChange, theme, jumpToLine, onJumped }: Props,
  handleRef,
) {
  const ref = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const themeRef = useRef(new Compartment());
  const highlightRef = useRef(new Compartment());

  // Mount once, never recreate (or we lose cursor/scroll state on theme toggle).
  useEffect(() => {
    if (!ref.current) return;
    const state = EditorState.create({
      doc: initial,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        EditorState.allowMultipleSelections.of(true),
        bracketMatching(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...searchKeymap,
          indentWithTab,
        ]),
        markdown(),
        EditorView.lineWrapping,
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        highlightRef.current.of(
          syntaxHighlighting(theme === "dark" ? darkHighlight : lightHighlight),
        ),
        themeRef.current.of(buildTheme(theme)),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChange(u.state.doc.toString());
        }),
      ],
    });
    const view = new EditorView({ state, parent: ref.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Scroll + place the cursor at a requested 1-based line. Runs once per
  // change of `jumpToLine`, then asks the parent to clear the request.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || jumpToLine == null) return;
    const totalLines = view.state.doc.lines;
    const line = Math.max(1, Math.min(jumpToLine, totalLines));
    const pos = view.state.doc.line(line).from;
    view.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: "start", yMargin: 80 }),
    });
    view.focus();
    onJumped?.();
  }, [jumpToLine, onJumped]);

  // Hot-swap theme without re-mounting the editor.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: [
        themeRef.current.reconfigure(buildTheme(theme)),
        highlightRef.current.reconfigure(
          syntaxHighlighting(theme === "dark" ? darkHighlight : lightHighlight),
        ),
      ],
    });
  }, [theme]);

  useImperativeHandle(
    handleRef,
    () => ({
      insertAtCursor(text) {
        const view = viewRef.current;
        if (!view) return;
        const sel = view.state.selection.main;
        view.dispatch({
          changes: { from: sel.from, to: sel.to, insert: text },
          selection: { anchor: sel.from + text.length },
          scrollIntoView: true,
        });
        view.focus();
      },
      getCursorContext() {
        const view = viewRef.current;
        if (!view) return { inFence: false, fenceLang: "" };
        const doc = view.state.doc;
        const cursorLine = doc.lineAt(view.state.selection.main.head).number;
        // Walk every line strictly before the caret's line, tracking
        // fence open/close state. The caret's own line counts as
        // "inside" only when the walker is in-fence at that point —
        // a caret sitting on the open-fence line itself is "outside".
        let inFence = false;
        let fenceMarker = "";
        let lang = "";
        for (let i = 1; i < cursorLine; i++) {
          const line = doc.line(i).text;
          if (!inFence) {
            const open = /^\s*(```+)\s*([A-Za-z0-9_-]*)/.exec(line);
            if (open) {
              inFence = true;
              fenceMarker = open[1];
              lang = (open[2] || "").toLowerCase();
            }
          } else {
            const close = new RegExp(`^\\s*${fenceMarker}\\s*$`);
            if (close.test(line)) {
              inFence = false;
              fenceMarker = "";
              lang = "";
            }
          }
        }
        return { inFence, fenceLang: inFence ? lang : "" };
      },
    }),
    [],
  );

  return <div ref={ref} className="page-editor" />;
});
