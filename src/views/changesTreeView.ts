import * as vscode from "vscode";
import type { ChangedFile } from "../diff/types.ts";
import {
  changesTreeRowsFromSnapshot,
  type ChangesTreeRow,
  type ChangesTreeSnapshot,
} from "./changeTreeModel.ts";

export const CHANGES_VIEW_ID = "sidediff.changes";
export const OPEN_TREE_FILE_COMMAND = "sidediff.openTreeFile";

/** Payload for `sidediff.openTreeFile` (plain JSON — TreeItem command args). */
export type OpenTreeFileArgs = {
  repoRoot: string;
  path: string;
  status: ChangedFile["status"];
};

/**
 * Sidebar Changes list. Opens normal editors only — never Diff Editor.
 */
export class ChangesTreeProvider
  implements vscode.TreeDataProvider<ChangesTreeRow>, vscode.Disposable
{
  private readonly changeEmitter = new vscode.EventEmitter<ChangesTreeRow | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  private snapshot: ChangesTreeSnapshot = {
    overlayActive: false,
    files: [],
  };
  private repoRoot: string | undefined;

  dispose(): void {
    this.changeEmitter.dispose();
  }

  /** Replace the rendered snapshot and refresh the view. */
  setSnapshot(repoRoot: string | undefined, snapshot: ChangesTreeSnapshot): void {
    this.repoRoot = repoRoot;
    this.snapshot = snapshot;
    this.changeEmitter.fire(undefined);
  }

  getTreeItem(element: ChangesTreeRow): vscode.TreeItem {
    if (element.kind === "message" || element.kind === "base") {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
      item.description = element.description;
      item.contextValue = element.kind;
      if (element.kind === "base") {
        item.iconPath = new vscode.ThemeIcon("git-compare");
      }
      return item;
    }

    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    item.description = element.description;
    item.tooltip = tooltipForFileRow(element);
    item.contextValue = element.openable
      ? element.binary
        ? "sidediff.file.binary"
        : "sidediff.file"
      : "sidediff.file.deleted";
    item.iconPath = iconForStatus(element.status, element.binary);

    if (this.repoRoot) {
      item.command = {
        command: OPEN_TREE_FILE_COMMAND,
        title: "Open",
        arguments: [
          {
            repoRoot: this.repoRoot,
            path: element.path,
            status: element.status,
          } satisfies OpenTreeFileArgs,
        ],
      };
    }

    return item;
  }

  getChildren(element?: ChangesTreeRow): ChangesTreeRow[] {
    if (element) {
      return [];
    }
    return changesTreeRowsFromSnapshot(this.snapshot);
  }
}

function iconForStatus(status: ChangedFile["status"], binary: boolean): vscode.ThemeIcon {
  if (binary) {
    return new vscode.ThemeIcon("file-binary");
  }
  switch (status) {
    case "added":
      return new vscode.ThemeIcon("diff-added");
    case "deleted":
      return new vscode.ThemeIcon("diff-removed");
    case "renamed":
      return new vscode.ThemeIcon("diff-renamed");
    case "modified":
      return new vscode.ThemeIcon("diff-modified");
  }
}

function tooltipForFileRow(row: Extract<ChangesTreeRow, { kind: "file" }>): string {
  if (!row.openable) {
    return `${row.path} — deleted on this branch`;
  }
  if (row.binary) {
    return `${row.path} — binary (no gutter decorations)`;
  }
  return row.path;
}
