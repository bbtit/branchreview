import * as vscode from "vscode";
import type { GutterKind, GutterMark } from "../diff/gutterMarks.ts";

/**
 * Applies ADD / CHANGE / DELETE gutter icons on the normal text editor.
 * Does not open Diff Editor or rewrite the document (MVP-05).
 */
export class GutterDecorations implements vscode.Disposable {
  private readonly addType: vscode.TextEditorDecorationType;
  private readonly changeType: vscode.TextEditorDecorationType;
  private readonly deleteType: vscode.TextEditorDecorationType;
  private readonly trackedEditors = new Set<vscode.TextEditor>();

  constructor(extensionUri: vscode.Uri) {
    this.addType = createGutterType(extensionUri, "gutter-add.svg");
    this.changeType = createGutterType(extensionUri, "gutter-change.svg");
    this.deleteType = createGutterType(extensionUri, "gutter-delete.svg");
  }

  /** Replace gutter marks on one editor (empty clears). */
  setMarks(editor: vscode.TextEditor, marks: readonly GutterMark[]): void {
    this.trackedEditors.add(editor);
    const lineCount = editor.document.lineCount;
    const byKind: Record<GutterKind, vscode.Range[]> = {
      add: [],
      change: [],
      delete: [],
    };

    for (const mark of marks) {
      if (mark.line < 1 || mark.line > lineCount) {
        continue;
      }
      const lineIndex = mark.line - 1;
      const line = editor.document.lineAt(lineIndex);
      byKind[mark.kind].push(line.range);
    }

    editor.setDecorations(this.addType, byKind.add);
    editor.setDecorations(this.changeType, byKind.change);
    editor.setDecorations(this.deleteType, byKind.delete);
  }

  clearEditor(editor: vscode.TextEditor): void {
    this.setMarks(editor, []);
    this.trackedEditors.delete(editor);
  }

  clearAll(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      editor.setDecorations(this.addType, []);
      editor.setDecorations(this.changeType, []);
      editor.setDecorations(this.deleteType, []);
    }
    for (const editor of this.trackedEditors) {
      try {
        editor.setDecorations(this.addType, []);
        editor.setDecorations(this.changeType, []);
        editor.setDecorations(this.deleteType, []);
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
  }
}

function createGutterType(
  extensionUri: vscode.Uri,
  fileName: string,
): vscode.TextEditorDecorationType {
  return vscode.window.createTextEditorDecorationType({
    gutterIconPath: vscode.Uri.joinPath(extensionUri, "media", fileName),
    // Stretch to the full gutter cell so consecutive lines form one bar.
    gutterIconSize: "100%",
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  });
}
