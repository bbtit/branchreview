import * as vscode from "vscode";
import { GitClient } from "./git/gitClient.ts";
import { formatGitContext, getGitContextForFile } from "./git/repository.ts";
import { ReviewManager } from "./review/reviewManager.ts";

export function activate(context: vscode.ExtensionContext): void {
  const git = new GitClient();
  const reviewManager = new ReviewManager(context, git);
  context.subscriptions.push(reviewManager);

  context.subscriptions.push(
    vscode.commands.registerCommand("branchreview.setBase", () => reviewManager.setBase()),
    vscode.commands.registerCommand("branchreview.resumeReview", () =>
      reviewManager.resumeReview(),
    ),
    vscode.commands.registerCommand("branchreview.stopReview", () => reviewManager.stopReview()),
    vscode.commands.registerCommand("branchreview.clearBase", () => reviewManager.clearBase()),
    vscode.commands.registerCommand("branchreview.clearReviewProgress", () =>
      reviewManager.clearReviewProgress(),
    ),
    vscode.commands.registerCommand("branchreview.nextChange", () => reviewManager.nextChange()),
    vscode.commands.registerCommand("branchreview.previousChange", () =>
      reviewManager.previousChange(),
    ),
    vscode.commands.registerCommand("branchreview.openTreeFile", (args) =>
      reviewManager.openTreeFile(args),
    ),
    vscode.commands.registerCommand("branchreview.markReviewed", (args) =>
      reviewManager.markReviewed(args),
    ),
    vscode.commands.registerCommand("branchreview.markUnreviewed", (args) =>
      reviewManager.markUnreviewed(args),
    ),
    vscode.commands.registerCommand("branchreview.showGitContext", async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        void vscode.window.showWarningMessage(
          "BranchReview: open a file in the editor to resolve Git context.",
        );
        return;
      }

      if (editor.document.uri.scheme !== "file") {
        void vscode.window.showWarningMessage("BranchReview: Git context requires a file on disk.");
        return;
      }

      const gitContext = await getGitContextForFile(git, editor.document.uri.fsPath);
      if (!gitContext) {
        void vscode.window.showWarningMessage(
          "BranchReview: this file is not inside a Git repository.",
        );
        return;
      }

      void vscode.window.showInformationMessage(`BranchReview: ${formatGitContext(gitContext)}`);
    }),
  );
}

export function deactivate(): void {}
