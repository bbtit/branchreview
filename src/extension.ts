import * as vscode from "vscode";
import { GitClient } from "./git/gitClient.ts";
import { formatGitContext, getGitContextForFile } from "./git/repository.ts";

export function activate(context: vscode.ExtensionContext): void {
  const git = new GitClient();

  const disposable = vscode.commands.registerCommand("sidediff.showGitContext", async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      void vscode.window.showWarningMessage(
        "SideDiff: open a file in the editor to resolve Git context.",
      );
      return;
    }

    if (editor.document.uri.scheme !== "file") {
      void vscode.window.showWarningMessage("SideDiff: Git context requires a file on disk.");
      return;
    }

    const gitContext = await getGitContextForFile(git, editor.document.uri.fsPath);
    if (!gitContext) {
      void vscode.window.showWarningMessage("SideDiff: this file is not inside a Git repository.");
      return;
    }

    void vscode.window.showInformationMessage(`SideDiff: ${formatGitContext(gitContext)}`);
  });

  context.subscriptions.push(disposable);
}

export function deactivate(): void {}
