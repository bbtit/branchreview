import * as vscode from "vscode";
import { GitClient } from "./git/gitClient.ts";
import { formatGitContext, getGitContextForFile } from "./git/repository.ts";
import { ReviewManager } from "./review/reviewManager.ts";

export function activate(context: vscode.ExtensionContext): void {
  const git = new GitClient();
  const reviewManager = new ReviewManager(context, git);
  context.subscriptions.push(reviewManager);

  context.subscriptions.push(
    vscode.commands.registerCommand("sidediff.setBase", () => reviewManager.setBase()),
    vscode.commands.registerCommand("sidediff.resumeReview", () => reviewManager.resumeReview()),
    vscode.commands.registerCommand("sidediff.stopReview", () => reviewManager.stopReview()),
    vscode.commands.registerCommand("sidediff.clearBase", () => reviewManager.clearBase()),
    vscode.commands.registerCommand("sidediff.nextChange", () => reviewManager.nextChange()),
    vscode.commands.registerCommand("sidediff.previousChange", () =>
      reviewManager.previousChange(),
    ),
    vscode.commands.registerCommand("sidediff.openTreeFile", (args) =>
      reviewManager.openTreeFile(args),
    ),
    vscode.commands.registerCommand("sidediff.showGitContext", async () => {
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
        void vscode.window.showWarningMessage(
          "SideDiff: this file is not inside a Git repository.",
        );
        return;
      }

      void vscode.window.showInformationMessage(`SideDiff: ${formatGitContext(gitContext)}`);
    }),
  );
}

export function deactivate(): void {}
