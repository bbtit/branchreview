import { join } from "node:path";
import * as vscode from "vscode";
import { GutterDecorations } from "../decorations/gutterDecorations.ts";
import { DiffPipeline } from "../diff/diffPipeline.ts";
import { gutterMarksFromHunks } from "../diff/gutterMarks.ts";
import type { GitClient } from "../git/gitClient.ts";
import { repoRelativePath } from "../git/repoPath.ts";
import { getGitContextForFile, type GitContext } from "../git/repository.ts";
import {
  changeTargetsFromFiles,
  findNextChangeTarget,
  findPreviousChangeTarget,
  type ChangeTarget,
} from "../navigation/changeTargets.ts";
import {
  CHANGES_VIEW_ID,
  ChangesTreeProvider,
  type OpenTreeFileArgs,
} from "../views/changesTreeView.ts";
import { orderBaseCandidates } from "./baseCandidates.ts";
import {
  clearPersistedReview,
  emptyPersistedRepoReview,
  emptyRuntimeRepoReview,
  formatStatusBarText,
  formatStatusBarTooltip,
  loadPersistedMap,
  stopOverlay,
  WORKSPACE_STATE_KEY,
  type PersistedRepoReview,
  type PersistedReviewMap,
  type RuntimeRepoReview,
} from "./reviewState.ts";

const ENTER_REVISION_LABEL = "$(edit) Enter revision…";

/**
 * Owns SideDiff review ON/OFF, base persistence, status bar, branch watch,
 * gutter decorations, Changes Tree, and change navigation on the normal editor.
 */
export class ReviewManager implements vscode.Disposable {
  private readonly statusBar: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly diffPipeline: DiffPipeline;
  private readonly gutters: GutterDecorations;
  private readonly changesTree: ChangesTreeProvider;
  private persisted: PersistedReviewMap;
  private readonly runtime = new Map<string, RuntimeRepoReview>();
  private readonly headWatchers = new Map<string, vscode.FileSystemWatcher>();
  private refreshSerial = 0;
  private gutterSerial = 0;
  private treeSerial = 0;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly git: GitClient,
  ) {
    this.persisted = loadPersistedMap(context.workspaceState.get(WORKSPACE_STATE_KEY));
    this.diffPipeline = new DiffPipeline(git);
    this.gutters = new GutterDecorations(context.extensionUri);
    this.changesTree = new ChangesTreeProvider();
    this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.statusBar.command = "sidediff.setBase";
    this.statusBar.show();
    this.disposables.push(
      this.statusBar,
      this.gutters,
      this.changesTree,
      vscode.window.createTreeView(CHANGES_VIEW_ID, {
        treeDataProvider: this.changesTree,
        showCollapseAll: false,
      }),
    );

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => {
        void this.refreshStatusBar();
        void this.refreshGutters();
        void this.refreshChangesTree();
      }),
      vscode.workspace.onDidSaveTextDocument(() => {
        void this.refreshStatusBar();
      }),
      vscode.window.onDidChangeVisibleTextEditors(() => {
        void this.refreshGutters();
      }),
      vscode.window.onDidChangeWindowState((state) => {
        if (state.focused) {
          void this.onPossibleHeadChange();
        }
      }),
    );

    void this.refreshStatusBar();
    void this.refreshGutters();
    void this.refreshChangesTree();
  }

  dispose(): void {
    for (const watcher of this.headWatchers.values()) {
      watcher.dispose();
    }
    this.headWatchers.clear();
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  async setBase(): Promise<void> {
    const gitContext = await this.requireReviewableContext("Set Base");
    if (!gitContext) {
      return;
    }

    const stored = this.getPersisted(gitContext.root);
    const refs = await this.git.listBranchRefs(gitContext.root);
    const candidates = orderBaseCandidates(refs, stored.base);

    const items: vscode.QuickPickItem[] = [
      ...candidates.map((ref) => ({
        label: ref,
        description: ref === stored.base ? "current base" : undefined,
      })),
      { label: ENTER_REVISION_LABEL, alwaysShow: true },
    ];

    const picked = await vscode.window.showQuickPick(items, {
      title: "SideDiff: Set Base",
      placeHolder: "Compare current branch to…",
      matchOnDescription: true,
    });
    if (!picked) {
      return;
    }

    let revision = picked.label;
    if (picked.label === ENTER_REVISION_LABEL) {
      const input = await vscode.window.showInputBox({
        title: "SideDiff: Set Base",
        prompt: "Git revision (branch, tag, or commit)",
        value: stored.base,
        placeHolder: "origin/main",
      });
      if (!input) {
        return;
      }
      revision = input.trim();
    }

    await this.applyBase(gitContext, revision);
  }

  async resumeReview(): Promise<void> {
    const gitContext = await this.requireReviewableContext("Resume Review");
    if (!gitContext) {
      return;
    }

    const stored = this.getPersisted(gitContext.root);
    if (!stored.base) {
      void vscode.window.showWarningMessage(
        "SideDiff: no base remembered for this repository. Use Set Base first.",
      );
      return;
    }

    await this.applyBase(gitContext, stored.base);
  }

  async stopReview(): Promise<void> {
    const gitContext = await this.resolveActiveGitContext();
    if (!gitContext) {
      void vscode.window.showWarningMessage("SideDiff: open a file inside a Git repository.");
      return;
    }

    const runtime = this.getRuntime(gitContext.root);
    if (!runtime.overlayActive) {
      void vscode.window.showInformationMessage("SideDiff: review is already off.");
      await this.refreshStatusBar();
      return;
    }

    this.runtime.set(gitContext.root, stopOverlay(runtime));
    this.diffPipeline.clearCache();
    this.gutters.clearAll();
    void vscode.window.showInformationMessage(
      `SideDiff: stopped (base ${this.getPersisted(gitContext.root).base ?? "none"} kept).`,
    );
    await this.refreshStatusBar();
    await this.refreshChangesTree();
  }

  async clearBase(): Promise<void> {
    const gitContext = await this.resolveActiveGitContext();
    if (!gitContext) {
      void vscode.window.showWarningMessage("SideDiff: open a file inside a Git repository.");
      return;
    }

    const previous = this.getPersisted(gitContext.root);
    if (!previous.base && previous.reviewedPaths.length === 0) {
      void vscode.window.showInformationMessage("SideDiff: no base to clear.");
      return;
    }

    this.persisted[gitContext.root] = clearPersistedReview(previous);
    this.runtime.set(gitContext.root, emptyRuntimeRepoReview());
    this.diffPipeline.clearCache();
    this.gutters.clearAll();
    await this.savePersisted();
    void vscode.window.showInformationMessage("SideDiff: base cleared.");
    await this.refreshStatusBar();
    await this.refreshChangesTree();
  }

  async nextChange(): Promise<void> {
    await this.navigateChange("next");
  }

  async previousChange(): Promise<void> {
    await this.navigateChange("previous");
  }

  /**
   * Open a Changes Tree file in the normal editor (D12: deleted → message only).
   * Never opens Diff Editor.
   */
  async openTreeFile(args: OpenTreeFileArgs): Promise<void> {
    if (args.status === "deleted") {
      void vscode.window.showInformationMessage(
        `SideDiff: ${args.path} was deleted on this branch.`,
      );
      return;
    }

    const abs = join(args.repoRoot, ...args.path.split("/"));
    const uri = vscode.Uri.file(abs);
    let document: vscode.TextDocument;
    try {
      document = await vscode.workspace.openTextDocument(uri);
    } catch {
      void vscode.window.showWarningMessage(`SideDiff: could not open ${args.path}`);
      return;
    }

    await vscode.window.showTextDocument(document, {
      preview: false,
      preserveFocus: false,
    });
    await this.refreshGutters();
  }

  /** Exposed for tests / future decoration layer. */
  getSessionSnapshot(repoRoot: string): {
    base?: string;
    overlayActive: boolean;
    reviewedPaths: string[];
  } {
    const persisted = this.getPersisted(repoRoot);
    const runtime = this.getRuntime(repoRoot);
    return {
      base: persisted.base,
      overlayActive: runtime.overlayActive,
      reviewedPaths: [...persisted.reviewedPaths],
    };
  }

  private async applyBase(gitContext: GitContext, revision: string): Promise<void> {
    if (!revision) {
      void vscode.window.showErrorMessage("SideDiff: base revision is empty.");
      return;
    }

    const exists = await this.git.revisionExists(gitContext.root, revision);
    if (!exists) {
      // D17: reject invalid base; keep previous remembered base.
      void vscode.window.showErrorMessage(
        `SideDiff: revision "${revision}" not found. Base unchanged.`,
      );
      await this.refreshStatusBar();
      return;
    }

    if (!gitContext.branch) {
      void vscode.window.showErrorMessage(
        "SideDiff: check out a branch before starting a review (detached HEAD is not supported).",
      );
      return;
    }

    const persisted = this.getPersisted(gitContext.root);
    this.persisted[gitContext.root] = {
      ...persisted,
      base: revision,
    };
    this.runtime.set(gitContext.root, {
      overlayActive: true,
      branchWhenStarted: gitContext.branch,
    });
    await this.savePersisted();
    this.diffPipeline.clearCache();
    this.ensureHeadWatcher(gitContext.root);
    void vscode.window.showInformationMessage(`SideDiff: reviewing against ${revision}`);
    await this.refreshStatusBar();
    await this.refreshGutters();
    await this.refreshChangesTree();
  }

  private async requireReviewableContext(action: string): Promise<GitContext | undefined> {
    const gitContext = await this.resolveActiveGitContext();
    if (!gitContext) {
      void vscode.window.showWarningMessage(
        `SideDiff: open a file inside a Git repository to ${action}.`,
      );
      return undefined;
    }
    if (gitContext.detached || !gitContext.reviewable) {
      // D15
      void vscode.window.showErrorMessage(
        "SideDiff: check out a branch before starting a review (detached HEAD is not supported).",
      );
      return undefined;
    }
    return gitContext;
  }

  private async resolveActiveGitContext(): Promise<GitContext | undefined> {
    const editor = vscode.window.activeTextEditor;
    if (editor && editor.document.uri.scheme === "file") {
      return getGitContextForFile(this.git, editor.document.uri.fsPath);
    }

    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return undefined;
    }
    return getGitContextForFile(this.git, folder.uri.fsPath);
  }

  private getPersisted(repoRoot: string): PersistedRepoReview {
    return this.persisted[repoRoot] ?? emptyPersistedRepoReview();
  }

  private getRuntime(repoRoot: string): RuntimeRepoReview {
    return this.runtime.get(repoRoot) ?? emptyRuntimeRepoReview();
  }

  private async savePersisted(): Promise<void> {
    await this.context.workspaceState.update(WORKSPACE_STATE_KEY, this.persisted);
  }

  private ensureHeadWatcher(repoRoot: string): void {
    if (this.headWatchers.has(repoRoot)) {
      return;
    }
    const pattern = new vscode.RelativePattern(vscode.Uri.file(repoRoot), ".git/HEAD");
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const onChange = (): void => {
      void this.onPossibleHeadChange();
    };
    watcher.onDidChange(onChange);
    watcher.onDidCreate(onChange);
    watcher.onDidDelete(onChange);
    this.headWatchers.set(repoRoot, watcher);
  }

  /** D5: overlay OFF on branch change; base kept. Returns true when it stopped. */
  private autoStopIfBranchChanged(repoRoot: string, currentBranch: string | null): boolean {
    const runtime = this.getRuntime(repoRoot);
    if (!runtime.overlayActive || !runtime.branchWhenStarted) {
      return false;
    }
    if (currentBranch === runtime.branchWhenStarted) {
      return false;
    }
    this.runtime.set(repoRoot, stopOverlay(runtime));
    this.diffPipeline.clearCache();
    this.gutters.clearAll();
    void vscode.window.showInformationMessage(
      `SideDiff: stopped after branch change (base ${this.getPersisted(repoRoot).base ?? "none"} kept).`,
    );
    return true;
  }

  private async onPossibleHeadChange(): Promise<void> {
    for (const [repoRoot, runtime] of this.runtime.entries()) {
      if (!runtime.overlayActive) {
        continue;
      }
      try {
        const branch = await this.git.getBranchName(repoRoot);
        this.autoStopIfBranchChanged(repoRoot, branch);
      } catch {
        // Repo may have vanished; ignore.
      }
    }
    await this.refreshStatusBar();
    await this.refreshGutters();
    await this.refreshChangesTree();
  }

  private async navigateChange(direction: "next" | "previous"): Promise<void> {
    const session = await this.requireActiveReviewSession();
    if (!session) {
      return;
    }
    const { gitContext, base } = session;

    const files = await this.diffPipeline.getChangedFiles({
      repoRoot: gitContext.root,
      base,
      head: gitContext.head,
      overlayActive: true,
    });
    if (!files) {
      void vscode.window.showInformationMessage("SideDiff: no changes to navigate.");
      return;
    }

    const targets = changeTargetsFromFiles(files);
    if (targets.length === 0) {
      void vscode.window.showInformationMessage("SideDiff: no changes to navigate.");
      return;
    }

    const cursor = this.cursorInRepo(gitContext.root);
    const target =
      direction === "next"
        ? findNextChangeTarget(targets, cursor)
        : findPreviousChangeTarget(targets, cursor);

    if (!target) {
      void vscode.window.showInformationMessage("SideDiff: no changes to navigate.");
      return;
    }

    await this.revealChangeTarget(gitContext.root, target);
  }

  /**
   * Overlay must be ON with a base; otherwise navigation has nothing to walk.
   */
  private async requireActiveReviewSession(): Promise<
    { gitContext: GitContext; base: string } | undefined
  > {
    const gitContext = await this.resolveActiveGitContext();
    if (!gitContext) {
      void vscode.window.showWarningMessage("SideDiff: open a file inside a Git repository.");
      return undefined;
    }

    const stopped = this.autoStopIfBranchChanged(gitContext.root, gitContext.branch);
    if (stopped) {
      void this.refreshChangesTree();
    }
    const runtime = this.getRuntime(gitContext.root);
    const persisted = this.getPersisted(gitContext.root);
    if (!runtime.overlayActive || !persisted.base) {
      void vscode.window.showInformationMessage(
        "SideDiff: start a review (Set Base or Resume Review) to navigate changes.",
      );
      return undefined;
    }
    return { gitContext, base: persisted.base };
  }

  private cursorInRepo(repoRoot: string): { path: string; line: number } | undefined {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== "file") {
      return undefined;
    }
    const rel = repoRelativePath(repoRoot, editor.document.uri.fsPath);
    if (rel.startsWith("..") || rel === "") {
      return undefined;
    }
    return {
      path: rel,
      line: editor.selection.active.line + 1,
    };
  }

  /** Open in the normal text editor and reveal the hunk line (never Diff Editor). */
  private async revealChangeTarget(repoRoot: string, target: ChangeTarget): Promise<void> {
    const abs = join(repoRoot, ...target.path.split("/"));
    const uri = vscode.Uri.file(abs);
    let document: vscode.TextDocument;
    try {
      document = await vscode.workspace.openTextDocument(uri);
    } catch {
      void vscode.window.showWarningMessage(`SideDiff: could not open ${target.path}`);
      return;
    }

    const editor = await vscode.window.showTextDocument(document, {
      preview: false,
      preserveFocus: false,
    });
    const maxLine = Math.max(document.lineCount, 1);
    const line = Math.min(Math.max(target.line, 1), maxLine) - 1;
    const pos = new vscode.Position(line, 0);
    editor.selection = new vscode.Selection(pos, pos);
    editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    await this.refreshGutters();
  }

  /**
   * Paint gutters on visible editors from cached `base...HEAD` (no per-keystroke Git).
   */
  async refreshGutters(): Promise<void> {
    const serial = ++this.gutterSerial;
    const editors = vscode.window.visibleTextEditors.filter(
      (e) => e.document.uri.scheme === "file",
    );

    if (editors.length === 0) {
      this.gutters.clearAll();
      return;
    }

    for (const editor of editors) {
      if (serial !== this.gutterSerial) {
        return;
      }

      const gitContext = await getGitContextForFile(this.git, editor.document.uri.fsPath);
      if (serial !== this.gutterSerial) {
        return;
      }

      if (!gitContext) {
        this.gutters.clearEditor(editor);
        continue;
      }

      this.autoStopIfBranchChanged(gitContext.root, gitContext.branch);
      const runtime = this.getRuntime(gitContext.root);
      const persisted = this.getPersisted(gitContext.root);

      if (!runtime.overlayActive || !persisted.base) {
        this.gutters.clearEditor(editor);
        continue;
      }

      const files = await this.diffPipeline.getChangedFiles({
        repoRoot: gitContext.root,
        base: persisted.base,
        head: gitContext.head,
        overlayActive: true,
      });

      if (serial !== this.gutterSerial) {
        return;
      }

      if (!files) {
        this.gutters.clearEditor(editor);
        continue;
      }

      const rel = repoRelativePath(gitContext.root, editor.document.uri.fsPath);
      const changed = files.find((f) => f.path === rel);
      if (!changed || changed.status === "deleted" || changed.binary) {
        this.gutters.clearEditor(editor);
        continue;
      }

      this.gutters.setMarks(editor, gutterMarksFromHunks(changed.hunks));
    }
  }

  /**
   * Refresh the SideDiff Changes sidebar from cached `base...HEAD`.
   */
  async refreshChangesTree(): Promise<void> {
    const serial = ++this.treeSerial;
    const gitContext = await this.resolveActiveGitContext();
    if (serial !== this.treeSerial) {
      return;
    }

    if (!gitContext) {
      this.changesTree.setSnapshot(undefined, {
        overlayActive: false,
        files: [],
      });
      return;
    }

    this.autoStopIfBranchChanged(gitContext.root, gitContext.branch);
    const runtime = this.getRuntime(gitContext.root);
    const persisted = this.getPersisted(gitContext.root);

    if (!runtime.overlayActive || !persisted.base) {
      this.changesTree.setSnapshot(gitContext.root, {
        overlayActive: false,
        base: persisted.base,
        files: [],
      });
      return;
    }

    const files = await this.diffPipeline.getChangedFiles({
      repoRoot: gitContext.root,
      base: persisted.base,
      head: gitContext.head,
      overlayActive: true,
    });

    if (serial !== this.treeSerial) {
      return;
    }

    this.changesTree.setSnapshot(gitContext.root, {
      overlayActive: true,
      base: persisted.base,
      files: files ?? [],
    });
  }

  async refreshStatusBar(): Promise<void> {
    const serial = ++this.refreshSerial;
    const gitContext = await this.resolveActiveGitContext();
    if (serial !== this.refreshSerial) {
      return;
    }

    if (!gitContext) {
      this.statusBar.text = "SideDiff: off";
      this.statusBar.tooltip = "Open a file in a Git repository";
      return;
    }

    this.ensureHeadWatcher(gitContext.root);
    if (this.autoStopIfBranchChanged(gitContext.root, gitContext.branch)) {
      void this.refreshChangesTree();
      void this.refreshGutters();
    }

    if (serial !== this.refreshSerial) {
      return;
    }

    const latestRuntime = this.getRuntime(gitContext.root);
    const persisted = this.getPersisted(gitContext.root);
    let dirty = false;
    try {
      dirty = await this.git.isWorkingTreeDirty(gitContext.root);
    } catch {
      dirty = false;
    }

    if (serial !== this.refreshSerial) {
      return;
    }

    this.statusBar.text = formatStatusBarText({
      overlayActive: latestRuntime.overlayActive,
      base: persisted.base,
      dirty: latestRuntime.overlayActive && dirty,
    });
    this.statusBar.tooltip = formatStatusBarTooltip({
      overlayActive: latestRuntime.overlayActive,
      base: persisted.base,
      branch: gitContext.branch,
      dirty,
      repoRoot: gitContext.root,
    });
  }
}
