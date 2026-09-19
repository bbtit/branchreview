/**
 * In-memory stand-in for the `vscode` module so ReviewManager can run under Vitest
 * (aliased in vite.config.ts). Implements only what BranchReview touches.
 */

type Listener<T> = (event: T) => void;

export class Disposable {
  private readonly onDispose: () => void;

  constructor(onDispose: () => void) {
    this.onDispose = onDispose;
  }

  static from(...items: { dispose(): unknown }[]): Disposable {
    return new Disposable(() => {
      for (const item of items) {
        item.dispose();
      }
    });
  }

  dispose(): void {
    this.onDispose();
  }
}

export class EventEmitter<T> {
  private readonly listeners = new Set<Listener<T>>();

  readonly event = (listener: Listener<T>): Disposable => {
    this.listeners.add(listener);
    return new Disposable(() => {
      this.listeners.delete(listener);
    });
  };

  fire(event: T): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  dispose(): void {
    this.listeners.clear();
  }
}

export class Uri {
  readonly scheme = "file";
  readonly fsPath: string;

  private constructor(fsPath: string) {
    this.fsPath = fsPath;
  }

  static file(path: string): Uri {
    return new Uri(path);
  }

  static joinPath(base: Uri, ...segments: string[]): Uri {
    return new Uri([base.fsPath, ...segments].join("/"));
  }
}

export class Position {
  readonly line: number;
  readonly character: number;

  constructor(line: number, character: number) {
    this.line = line;
    this.character = character;
  }
}

export class Range {
  readonly start: Position;
  readonly end: Position;

  constructor(
    startOrLine: Position | number,
    endOrCharacter: Position | number,
    endLine?: number,
    endCharacter?: number,
  ) {
    if (typeof startOrLine === "number" && typeof endOrCharacter === "number") {
      this.start = new Position(startOrLine, endOrCharacter);
      this.end = new Position(endLine ?? startOrLine, endCharacter ?? endOrCharacter);
    } else {
      this.start = startOrLine as Position;
      this.end = endOrCharacter as Position;
    }
  }
}

export class Selection extends Range {
  readonly active: Position;

  constructor(anchor: Position, active: Position) {
    super(anchor, active);
    this.active = active;
  }
}

export class MarkdownString {
  readonly value: string;
  supportThemeIcons = false;

  constructor(value: string) {
    this.value = value;
  }
}

export class ThemeColor {
  readonly id: string;

  constructor(id: string) {
    this.id = id;
  }
}

export class ThemeIcon {
  readonly id: string;

  constructor(id: string) {
    this.id = id;
  }
}

export class RelativePattern {
  readonly base: Uri;
  readonly pattern: string;

  constructor(base: Uri, pattern: string) {
    this.base = base;
    this.pattern = pattern;
  }
}

export class TreeItem {
  readonly label: string;
  description?: string;
  tooltip?: string;
  contextValue?: string;
  iconPath?: unknown;
  command?: unknown;

  constructor(label: string) {
    this.label = label;
  }
}

export const StatusBarAlignment = { Left: 1, Right: 2 } as const;
export const OverviewRulerLane = { Left: 1, Center: 2, Right: 4, Full: 7 } as const;
export const DecorationRangeBehavior = {
  OpenOpen: 0,
  ClosedClosed: 1,
  OpenClosed: 2,
  ClosedOpen: 3,
} as const;
export const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 } as const;
export const TextEditorRevealType = { Default: 0, InCenter: 1 } as const;

export type FakeDecorationType = {
  readonly key: string;
  readonly options: { gutterIconPath?: Uri };
  dispose(): void;
};

export class FakeTextEditor {
  readonly document: {
    uri: Uri;
    lineCount: number;
    lineAt(line: number): { range: Range };
  };
  /** Latest ranges / options passed to `setDecorations`, per decoration type key. */
  readonly decorations = new Map<string, readonly unknown[]>();
  selection = new Selection(new Position(0, 0), new Position(0, 0));

  constructor(fsPath: string, lineCount = 200) {
    this.document = {
      uri: Uri.file(fsPath),
      lineCount,
      lineAt: (line) => ({ range: new Range(line, 0, line, 0) }),
    };
  }

  setDecorations(type: FakeDecorationType, rangesOrOptions: readonly unknown[]): void {
    this.decorations.set(type.key, rangesOrOptions);
  }

  revealRange(): void {}
}

export class FakeFileSystemWatcher {
  readonly pattern: RelativePattern;
  private readonly changed = new EventEmitter<Uri>();
  private readonly created = new EventEmitter<Uri>();
  private readonly deleted = new EventEmitter<Uri>();
  readonly onDidChange = this.changed.event;
  readonly onDidCreate = this.created.event;
  readonly onDidDelete = this.deleted.event;

  constructor(pattern: RelativePattern) {
    this.pattern = pattern;
  }

  fireChange(): void {
    this.changed.fire(Uri.joinPath(this.pattern.base, this.pattern.pattern));
  }

  dispose(): void {
    this.changed.dispose();
    this.created.dispose();
    this.deleted.dispose();
  }
}

const activeEditorChanged = new EventEmitter<FakeTextEditor | undefined>();
const visibleEditorsChanged = new EventEmitter<readonly FakeTextEditor[]>();
const windowStateChanged = new EventEmitter<{ focused: boolean }>();
const documentSaved = new EventEmitter<unknown>();

export type FakeStatusBarItem = {
  text: string;
  tooltip: string;
  command: string;
  show(): void;
  dispose(): void;
};

export type FakeTreeDataProvider = { getChildren(element?: unknown): unknown[] };

export const decorationTypes: FakeDecorationType[] = [];
export const fileSystemWatchers: FakeFileSystemWatcher[] = [];
export const shownMessages: string[] = [];
export const statusBarItems: FakeStatusBarItem[] = [];
export const treeDataProviders: FakeTreeDataProvider[] = [];
/** Paths passed to `openTextDocument`, so tests can prove nothing was opened. */
export const openedDocuments: string[] = [];

async function recordMessage(message: string): Promise<undefined> {
  shownMessages.push(message);
  return undefined;
}

export const window = {
  activeTextEditor: undefined as FakeTextEditor | undefined,
  visibleTextEditors: [] as FakeTextEditor[],
  onDidChangeActiveTextEditor: activeEditorChanged.event,
  onDidChangeVisibleTextEditors: visibleEditorsChanged.event,
  onDidChangeWindowState: windowStateChanged.event,
  createStatusBarItem: (): FakeStatusBarItem => {
    const item: FakeStatusBarItem = {
      text: "",
      tooltip: "",
      command: "",
      show(): void {},
      dispose(): void {},
    };
    statusBarItems.push(item);
    return item;
  },
  createTreeView: (
    _id: string,
    options: { treeDataProvider: FakeTreeDataProvider },
  ): Disposable => {
    treeDataProviders.push(options.treeDataProvider);
    return new Disposable(() => {});
  },
  createTextEditorDecorationType: (options: { gutterIconPath?: Uri }): FakeDecorationType => {
    const type = { key: `decoration-${decorationTypes.length}`, options, dispose(): void {} };
    decorationTypes.push(type);
    return type;
  },
  showInformationMessage: recordMessage,
  showWarningMessage: recordMessage,
  showErrorMessage: recordMessage,
  showQuickPick: async (): Promise<undefined> => undefined,
  showInputBox: async (): Promise<undefined> => undefined,
  showTextDocument: async (): Promise<undefined> => undefined,
};

export const workspace = {
  workspaceFolders: undefined as { uri: Uri }[] | undefined,
  onDidSaveTextDocument: documentSaved.event,
  createFileSystemWatcher: (pattern: RelativePattern): FakeFileSystemWatcher => {
    const watcher = new FakeFileSystemWatcher(pattern);
    fileSystemWatchers.push(watcher);
    return watcher;
  },
  openTextDocument: async (uri: Uri): Promise<{ uri: Uri }> => {
    openedDocuments.push(uri.fsPath);
    return { uri };
  },
};

/** A document save, which VS Code reports after the file has been written. */
export function saveDocument(): void {
  documentSaved.fire({});
}

/** A tab switch: VS Code fires visible- and active-editor events back to back. */
export function switchToEditor(active: FakeTextEditor, visible: FakeTextEditor[]): void {
  window.activeTextEditor = active;
  window.visibleTextEditors = visible;
  visibleEditorsChanged.fire(visible);
  activeEditorChanged.fire(active);
}

/** Forget editors, decoration types, watchers, and messages between tests. */
export function resetFakeVscode(): void {
  window.activeTextEditor = undefined;
  window.visibleTextEditors = [];
  workspace.workspaceFolders = undefined;
  for (const watcher of fileSystemWatchers) {
    watcher.dispose();
  }
  decorationTypes.length = 0;
  fileSystemWatchers.length = 0;
  shownMessages.length = 0;
  statusBarItems.length = 0;
  treeDataProviders.length = 0;
  openedDocuments.length = 0;
}
