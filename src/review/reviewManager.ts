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
  type MarkTreeFileArgs,
  type OpenTreeFileArgs,
} from "../views/changesTreeView.ts";
import { debounce } from "../util/debounce.ts";
import { orderBaseCandidates } from "./baseCandidates.ts";
import { orderEditorsActiveFirst } from "./editorOrder.ts";
import {
  clearPersistedReview,
  clearReviewedProgress,
  emptyPersistedRepoReview,
  emptyRuntimeRepoReview,
  formatStatusBarText,
  formatStatusBarTooltip,
  getReviewedPaths,
  loadPersistedMap,
  markPathReviewed,
  markPathUnreviewed,
  stopOverlay,
  WORKSPACE_STATE_KEY,
  type PersistedRepoReview,
  type PersistedReviewMap,
  type RuntimeRepoReview,
} from "./reviewState.ts";

const ENTER_REVISION_LABEL = "$(edit) Enter revision…";
/** Quiet window before reacting to Git tip / ref file events (MVP-10). */
const HEAD_CHANGE_DEBOUNCE_MS = 200;

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
  /** Composite disposables for git-dir watchers (HEAD tip + branch refs). */
  private readonly headWatchers = new Map<string, vscode.Disposable>();
  private readonly headWatcherStarting = new Set<string>();
  /** Last observed HEAD SHA per repo — skip gutter/Tree refetch when unchanged. */
  private readonly lastSeenHead = new Map<string, string>();
  private readonly scheduleHeadChangeCheck: (() => void) & { cancel(): void };
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
    this.scheduleHeadChangeCheck = debounce(() => {
      void this.onPossibleHeadChange();
    }, HEAD_CHANGE_DEBOUNCE_MS);
    this.disposables.push(
      this.statusBar,
      this.gutters,
      this.changesTree,
      vscode.window.createTreeView(CHANGES_VIEW_ID, {
        treeDataProvider: this.changesTree,
        showCollapseAll: false,
      }),
      { dispose: () => this.scheduleHeadChangeCheck.cancel() },
    );

    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => {
        // Multi-root (D9): active editor's repo drives status / Tree; gutters are per-editor.
        void this.refreshStatusBar();
        void this.refreshGutters();
        void this.refreshChangesTree();
      }),
      vscode.workspace.onDidSaveTextDocument(() => {
        // Dirty flag only — never re-run `git diff` on buffer edits (D2 / §21).
        void this.refreshStatusBar();
      }),
      vscode.window.onDidChangeVisibleTextEditors(() => {
        void this.refreshGutters();
      }),
      vscode.window.onDidChangeWindowState((state) => {
        if (state.focused) {
          this.scheduleHeadChangeCheck();
        }
      }),
    );

    void this.refreshStatusBar();
    void this.refreshGutters();
    void this.refreshChangesTree();
  }

  dispose(): void {
    this.scheduleHeadChangeCheck.cancel();
    for (const watcher of this.headWatchers.values()) {
      watcher.dispose();
    }
    this.headWatchers.clear();
    this.headWatcherStarting.clear();
    this.lastSeenHead.clear();
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
    this.lastSeenHead.delete(gitContext.root);
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
    if (!previous.base && Object.keys(previous.reviewedBySession).length === 0) {
      void vscode.window.showInformationMessage("SideDiff: no base to clear.");
      return;
    }

    this.persisted[gitContext.root] = clearPersistedReview(previous);
    this.runtime.set(gitContext.root, emptyRuntimeRepoReview());
    this.diffPipeline.clearCache();
    this.gutters.clearAll();
    this.lastSeenHead.delete(gitContext.root);
    await this.savePersisted();
    void vscode.window.showInformationMessage("SideDiff: base cleared.");
    await this.refreshStatusBar();
    await this.refreshChangesTree();
  }

  /** Drop all (base, branch) reviewed progress for this repo; keep base / overlay (D22). */
  async clearReviewProgress(): Promise<void> {
    const gitContext = await this.resolveActiveGitContext();
    if (!gitContext) {
      void vscode.window.showWarningMessage("SideDiff: open a file inside a Git repository.");
      return;
    }

    const previous = this.getPersisted(gitContext.root);
    const sessionCount = Object.keys(previous.reviewedBySession).length;
    if (sessionCount === 0) {
      void vscode.window.showInformationMessage(
        "SideDiff: no review progress in this repository to clear.",
      );
      return;
    }

    this.persisted[gitContext.root] = clearReviewedProgress(previous);
    await this.savePersisted();
    void vscode.window.showInformationMessage(
      `SideDiff: cleared all review progress for this repository (${sessionCount} session${sessionCount === 1 ? "" : "s"}).`,
    );
    await this.refreshChangesTree();
  }

  /** Mark the active editor (or tree-selected) file as reviewed (D10). */
  async markReviewed(args?: unknown): Promise<void> {
    await this.setReviewedState(true, args);
  }

  /** Mark the active editor (or tree-selected) file as unreviewed. */
  async markUnreviewed(args?: unknown): Promise<void> {
    await this.setReviewedState(false, args);
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

  /**
   * Exposed for tests / future decoration layer.
   * `reviewedPaths` are for the given branch under the remembered base (D10).
   */
  getSessionSnapshot(
    repoRoot: string,
    branch?: string | null,
  ): {
    base?: string;
    overlayActive: boolean;
    reviewedPaths: string[];
  } {
    const persisted = this.getPersisted(repoRoot);
    const runtime = this.getRuntime(repoRoot);
    return {
      base: persisted.base,
      overlayActive: runtime.overlayActive,
      reviewedPaths: getReviewedPaths(persisted, persisted.base, branch ?? null),
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
    this.lastSeenHead.set(gitContext.root, gitContext.head);
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
    if (this.headWatchers.has(repoRoot) || this.headWatcherStarting.has(repoRoot)) {
      return;
    }
    this.headWatcherStarting.add(repoRoot);
    void this.startHeadWatcher(repoRoot);
  }

  /**
   * Watch git-dir tip files so same-branch commits / amend / pull refresh overlay (D13).
   * `.git/HEAD` alone is not enough — its contents stay `ref: refs/heads/…` on commit.
   */
  private async startHeadWatcher(repoRoot: string): Promise<void> {
    try {
      if (this.headWatchers.has(repoRoot)) {
        return;
      }
      const gitDir = await this.git.getGitDir(repoRoot);
      if (this.headWatchers.has(repoRoot)) {
        return;
      }

      const gitDirUri = vscode.Uri.file(gitDir);
      const patterns = ["HEAD", "logs/HEAD", "refs/heads/**", "packed-refs"];
      const watchers: vscode.FileSystemWatcher[] = [];
      const onChange = (): void => {
        this.scheduleHeadChangeCheck();
      };

      for (const pattern of patterns) {
        const watcher = vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(gitDirUri, pattern),
        );
        watcher.onDidChange(onChange);
        watcher.onDidCreate(onChange);
        watcher.onDidDelete(onChange);
        watchers.push(watcher);
      }

      this.headWatchers.set(repoRoot, vscode.Disposable.from(...watchers));
    } catch {
      // Repo may have vanished; ignore.
    } finally {
      this.headWatcherStarting.delete(repoRoot);
    }
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
    this.lastSeenHead.delete(repoRoot);
    void vscode.window.showInformationMessage(
      `SideDiff: stopped after branch change (base ${this.getPersisted(repoRoot).base ?? "none"} kept).`,
    );
    return true;
  }

  /**
   * D13: when tip advances on the same branch, refetch `base...HEAD` and refresh
   * gutters / Tree / navigation (cache key includes HEAD). Debounced by callers.
   */
  private async onPossibleHeadChange(): Promise<void> {
    let tipOrSessionChanged = false;

    for (const [repoRoot, runtime] of this.runtime.entries()) {
      if (!runtime.overlayActive) {
        continue;
      }
      try {
        const branch = await this.git.getBranchName(repoRoot);
        if (this.autoStopIfBranchChanged(repoRoot, branch)) {
          tipOrSessionChanged = true;
          continue;
        }
        const head = await this.git.getCurrentRevision(repoRoot);
        const previous = this.lastSeenHead.get(repoRoot);
        if (previous !== head) {
          this.lastSeenHead.set(repoRoot, head);
          tipOrSessionChanged = true;
        }
      } catch {
        // Repo may have vanished; ignore.
      }
    }

    // Dirty status can change without HEAD moving.
    await this.refreshStatusBar();
    if (tipOrSessionChanged) {
      // New HEAD → DiffPipeline cache miss; no manual clear needed.
      await this.refreshGutters();
      await this.refreshChangesTree();
    }
  }

  private async setReviewedState(reviewed: boolean, args?: unknown): Promise<void> {
    const session = await this.requireActiveReviewSession("update review status");
    if (!session) {
      return;
    }
    const { gitContext, base } = session;
    const branch = gitContext.branch;
    if (!branch) {
      void vscode.window.showErrorMessage(
        "SideDiff: check out a branch before updating review status (detached HEAD is not supported).",
      );
      return;
    }

    const target = resolveMarkTarget(args);
    if (target?.repoRoot && target.repoRoot !== gitContext.root) {
      void vscode.window.showWarningMessage(
        "SideDiff: that file belongs to a different repository than the active review.",
      );
      return;
    }

    const path = target?.path ?? this.cursorInRepo(gitContext.root)?.path;
    if (!path) {
      void vscode.window.showWarningMessage(
        "SideDiff: open a changed file (or use the Changes tree) to update review status.",
      );
      return;
    }

    const previous = this.getPersisted(gitContext.root);
    this.persisted[gitContext.root] = reviewed
      ? markPathReviewed(previous, base, branch, path)
      : markPathUnreviewed(previous, base, branch, path);
    await this.savePersisted();
    void vscode.window.showInformationMessage(
      reviewed ? `SideDiff: marked ${path} as reviewed` : `SideDiff: marked ${path} as unreviewed`,
    );
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
   * Overlay must be ON with a base; otherwise review actions have nothing to bind to.
   */
  private async requireActiveReviewSession(
    purpose = "navigate changes",
  ): Promise<{ gitContext: GitContext; base: string } | undefined> {
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
        `SideDiff: start a review (Set Base or Resume Review) to ${purpose}.`,
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
   * Active editor is decorated first (requirements §21).
   */
  async refreshGutters(): Promise<void> {
    const serial = ++this.gutterSerial;
    const visible = vscode.window.visibleTextEditors.filter(
      (e) => e.document.uri.scheme === "file",
    );
    const active =
      vscode.window.activeTextEditor?.document.uri.scheme === "file"
        ? vscode.window.activeTextEditor
        : undefined;
    const editors = orderEditorsActiveFirst(visible, active);

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

      this.lastSeenHead.set(gitContext.root, gitContext.head);

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
        reviewedPaths: [],
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
      reviewedPaths: getReviewedPaths(persisted, persisted.base, gitContext.branch),
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

/** Accept tree row, MarkTreeFileArgs, or undefined (fall back to active editor). */
function resolveMarkTarget(args: unknown): MarkTreeFileArgs | undefined {
  if (!args || typeof args !== "object") {
    return undefined;
  }
  const record = args as Record<string, unknown>;
  if (typeof record.path !== "string" || record.path.length === 0) {
    return undefined;
  }
  return {
    path: record.path,
    repoRoot: typeof record.repoRoot === "string" ? record.repoRoot : "",
  };
}
