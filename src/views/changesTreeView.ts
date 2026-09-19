import * as vscode from "vscode";
import type { ChangedFile } from "../diff/types.ts";
import {
  changesTreeRowsFromSnapshot,
  type ChangesTreeRow,
  type ChangesTreeSnapshot,
} from "./changeTreeModel.ts";

export const CHANGES_VIEW_ID = "branchreview.changes";
export const OPEN_TREE_FILE_COMMAND = "branchreview.openTreeFile";

/** Payload for `branchreview.openTreeFile` (plain JSON — TreeItem command args). */
export type OpenTreeFileArgs = {
  repoRoot: string;
  path: string;
  status: ChangedFile["status"];
};

/** Payload for mark reviewed / unreviewed from the tree context menu. */
export type MarkTreeFileArgs = {
  repoRoot: string;
  path: string;
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
    if (element.kind === "message" || element.kind === "base" || element.kind === "progress") {
      const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
      item.description = element.description;
      item.contextValue = element.kind;
      if (element.kind === "base") {
        item.iconPath = new vscode.ThemeIcon("git-compare");
      } else if (element.kind === "progress") {
        item.iconPath = new vscode.ThemeIcon("checklist");
      }
      return item;
    }

    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    item.description = element.description;
    item.tooltip = tooltipForFileRow(element);
    item.contextValue = contextValueForFileRow(element);
    item.iconPath = iconForStatus(element.status, element.binary, element.reviewed);

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

function contextValueForFileRow(element: Extract<ChangesTreeRow, { kind: "file" }>): string {
  if (!element.openable) {
    return element.reviewed ? "branchreview.file.deleted.reviewed" : "branchreview.file.deleted";
  }
  if (element.binary) {
    return element.reviewed ? "branchreview.file.binary.reviewed" : "branchreview.file.binary";
  }
  return element.reviewed ? "branchreview.file.reviewed" : "branchreview.file";
}

function iconForStatus(
  status: ChangedFile["status"],
  binary: boolean,
  reviewed: boolean,
): vscode.ThemeIcon {
  if (reviewed) {
    return new vscode.ThemeIcon("pass");
  }
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
  const status = row.reviewed ? "reviewed" : "unreviewed";
  if (!row.openable) {
    return `${row.path} — deleted on this branch · ${status}`;
  }
  if (row.binary) {
    return `${row.path} — binary (no gutter decorations) · ${status}`;
  }
  return `${row.path} · ${status}`;
}
