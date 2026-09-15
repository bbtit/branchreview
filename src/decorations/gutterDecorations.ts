import * as vscode from "vscode";
import type { GutterKind, GutterMark } from "../diff/gutterMarks.ts";
import type { HunkHover } from "../diff/hunkHover.ts";

/**
 * Applies ADD / CHANGE / DELETE gutter icons + overview ruler + hunk hover on the
 * normal text editor. Does not open Diff Editor or rewrite the document.
 */
export class GutterDecorations implements vscode.Disposable {
  private readonly addType: vscode.TextEditorDecorationType;
  private readonly changeType: vscode.TextEditorDecorationType;
  private readonly deleteType: vscode.TextEditorDecorationType;
  /** Unstyled; one decoration per hunk carries its hover so payload tracks diff size. */
  private readonly hoverType: vscode.TextEditorDecorationType;
  private readonly trackedEditors = new Set<vscode.TextEditor>();

  constructor(extensionUri: vscode.Uri) {
    this.addType = createGutterType(
      extensionUri,
      "gutter-add.svg",
      "editorOverviewRuler.addedForeground",
    );
    this.changeType = createGutterType(
      extensionUri,
      "gutter-change.svg",
      "editorOverviewRuler.modifiedForeground",
    );
    this.deleteType = createGutterType(
      extensionUri,
      "gutter-delete.svg",
      "editorOverviewRuler.deletedForeground",
    );
    this.hoverType = vscode.window.createTextEditorDecorationType({
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    });
  }

  /** Replace gutter / overview marks and hunk hovers on one editor (empty clears). */
  setMarks(
    editor: vscode.TextEditor,
    marks: readonly GutterMark[],
    hovers: readonly HunkHover[],
  ): void {
    this.trackedEditors.add(editor);
    const document = editor.document;
    const lineCount = document.lineCount;
    const byKind: Record<GutterKind, vscode.Range[]> = {
      add: [],
      change: [],
      delete: [],
    };

    for (const mark of marks) {
      if (mark.line < 1 || mark.line > lineCount) {
        continue;
      }
      byKind[mark.kind].push(document.lineAt(mark.line - 1).range);
    }

    const hoverOptions: vscode.DecorationOptions[] = [];
    for (const hover of hovers) {
      const startLine = Math.max(hover.startLine, 1);
      const endLine = Math.min(hover.endLine, lineCount);
      if (startLine > endLine) {
        continue;
      }
      const hoverMessage = new vscode.MarkdownString(hover.markdown);
      hoverMessage.supportThemeIcons = false;
      hoverOptions.push({
        range: new vscode.Range(
          document.lineAt(startLine - 1).range.start,
          document.lineAt(endLine - 1).range.end,
        ),
        hoverMessage,
      });
    }

    editor.setDecorations(this.addType, byKind.add);
    editor.setDecorations(this.changeType, byKind.change);
    editor.setDecorations(this.deleteType, byKind.delete);
    editor.setDecorations(this.hoverType, hoverOptions);
  }

  clearEditor(editor: vscode.TextEditor): void {
    this.setMarks(editor, [], []);
    this.trackedEditors.delete(editor);
  }

  clearAll(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      this.clearDecorations(editor);
    }
    for (const editor of this.trackedEditors) {
      try {
        this.clearDecorations(editor);
      } catch {
        // Editor may already be disposed.
      }
    }
    this.trackedEditors.clear();
  }

  dispose(): void {
    this.clearAll();
    this.addType.dispose();
    this.changeType.dispose();
    this.deleteType.dispose();
    this.hoverType.dispose();
  }

  private clearDecorations(editor: vscode.TextEditor): void {
    editor.setDecorations(this.addType, []);
    editor.setDecorations(this.changeType, []);
    editor.setDecorations(this.deleteType, []);
    editor.setDecorations(this.hoverType, []);
  }
}

function createGutterType(
  extensionUri: vscode.Uri,
  fileName: string,
  overviewRulerColorId: string,
): vscode.TextEditorDecorationType {
  return vscode.window.createTextEditorDecorationType({
    gutterIconPath: vscode.Uri.joinPath(extensionUri, "media", fileName),
    // Stretch to the full gutter cell so consecutive lines form one bar.
    gutterIconSize: "100%",
    overviewRulerColor: new vscode.ThemeColor(overviewRulerColorId),
    overviewRulerLane: vscode.OverviewRulerLane.Center,
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  });
}
