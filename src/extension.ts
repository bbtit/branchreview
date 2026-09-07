import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand("sidediff.hello", () => {
    void vscode.window.showInformationMessage("SideDiff is ready.");
  });
  context.subscriptions.push(disposable);
}

export function deactivate(): void {}
