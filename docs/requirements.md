# VS Code Extension: Codebase-aware PR Review

> **製品名:** SideDiff（`sidediff`）  
> **実装時の決定ログ:** [`decisions.md`](./decisions.md)（grilling で確定した判断。コマンド名などはそちらを優先）

## 1. Goal

PRのdiffだけを見るのではなく、PR branchの完成版コードを通常のVS Code editorで読みながら、base branchとの差分をgutter/decoratorとして常時表示できるVS Code拡張を作る。

### 解決したい問題

通常のPRレビューでは、

```
PR diff
  ↓
変更箇所を見る
  ↓
「このコード、既存のcodebaseに馴染んでいる？」
  ↓
別ファイルを開く
  ↓
contextを調べる
  ↓
PR diffに戻る
```

となり、変更箇所とcodebaseのcontextを行き来するコストが高い。

一方、PR branchをcheckoutして普通にコードを読むと、

「このコードはPRで変更された箇所だっけ？」

が分からなくなる。

この拡張では、

**PR branchのコードを主役にし、diffはコード上に付加されるmetadataとして扱う。**

---

## 2. Core UX

ユーザーが以下の状態にいるとする。

```
main
  │
  └── feature/my-pr
```

`feature/my-pr` をcheckoutしている。

拡張でbaseを `main` に設定すると、

```
┌───────────────────────────────────────────┐
│ VS Code Editor                            │
│                                           │
│   10 │ const user = getUser(id);          │
│   11 │                                   │
│ + 12 │ const account = user.account;      │
│ + 13 │ if (!account.enabled) {            │
│ + 14 │   throw new Error("disabled");     │
│   15 │ }                                  │
│   16 │                                    │
│   17 │ return process(user);              │
│                                           │
└───────────────────────────────────────────┘
```

のように表示する。

**重要: editorに表示されるdocumentはPR branch側の実ファイルであること。**

diff editorを主役にしてはいけない。

---

## 3. Functional Requirements

### P0: Base revisionの指定

ユーザーが比較対象となるGit revisionを指定できる。

例:

- `origin/main`
- `main`
- `origin/develop`
- `abc1234`

最低限、

`origin/main`

をサポートする。

UI例:

```
PR Review: Base Branch
──────────────────────
origin/main
origin/develop
main
develop
```

可能なら自動検出:

- `upstream/main`
- `origin/main`

などを候補として提示する。

---

## 4. P0: Base vs Current Branch Diff

現在のworkspaceのファイルを、

`BASE...HEAD`

として比較する。

例えば、

```
git diff origin/main...HEAD
```

相当の結果を取得する。

重要なのは、

working tree vs HEAD

ではなく、

**base branch vs current branch**

であること。

---

## 5. P0: Editor Gutter Decorations

現在のeditorに対して変更箇所を表示する。

最低限以下を区別する。

- ADD
- CHANGE
- DELETE

例:

```
  20 │ const foo = getFoo();
+ 21 │ const bar = getBar();
+ 22 │ return bar;
  23 │
```

VS Codeでは `TextEditorDecorationType` / `TextEditor.setDecorations()` を利用する。

VS Code公式APIにはeditor decorationのためのAPIが用意されており、gutter/overview ruler等への表示が可能。公式のdecorator-sampleも参考にすること。

参考:

- VS Code Extension API
- VS Code Decorator Sample

---

## 6. P0: Diff情報は通常のEditorを邪魔しない

ユーザーは通常通り、

- Go to Definition
- Peek Definition
- Find References
- Rename
- IntelliSense
- Search
- GitLens等
- Debug
- 編集

を利用できること。

拡張は既存のeditor navigationを置き換えない。

diff表示のために独自editorを作らない。

---

## 7. P0: Next / Previous Change

変更箇所間を移動できる。

Commands:

- `PR Review: Next Change`
- `PR Review: Previous Change`

キーバインドはユーザーが設定できるようにする。

動作:

```
Change 1
   ↓
Change 2
   ↓
Change 3
   ↓
...
```

ファイルを跨いでもよい。

---

## 8. P1: Hover Diff

変更箇所にhoverすると、そのhunkのdiffを表示する。

例:

```
┌─────────────────────────────────┐
│ PR Change                       │
│                                 │
│ - const account = user.profile; │
│ + const account = user.account; │
│ + account.activate();           │
└─────────────────────────────────┘
```

通常時は、

PR branchのコード

だけを表示し、

hover

したときだけdiffを出す。

---

## 9. P1: Changes Tree View

VS Code sidebarにPR変更ファイル一覧を表示する。

例:

```
PR Review
├── Base: origin/main
│
├── Changes
│   ├── M src/user.ts       +12 -4
│   ├── M src/account.ts    +8 -2
│   ├── A src/service.ts    +84
│   └── D src/old.ts        -42
│
└── Review Progress
    2 / 4 files reviewed
```

Tree View APIを利用する。

VS Code公式にはTree View用のAPIとサンプルがある。

- VS Code Tree View API

---

## 10. P1: Changes Treeから開く場合もdiff editorにしない

ここは重要。

例えば、

`src/user.ts`

をクリックした場合、

❌ Diff Editor

ではなく、

✅ `src/user.ts` のPR branch側の通常editor

を開く。

そしてgutterに変更箇所を表示する。

---

## 11. P1: Review Status

各変更ファイルについて、

- unreviewed
- reviewing
- reviewed

を管理する。

UI:

```
Changes

✓ user.ts
✓ account.ts
→ service.ts
  payment.ts
```

最低限、

- Mark as Reviewed
- Mark as Unreviewed

を実装する。

---

## 12. P2: Inline Old Code

変更箇所に対して、

```
+ new code
```

だけでなく、必要に応じて

```
- old code
+ new code
```

をeditor内に展開できるようにする。

ただしMVPでは不要。

---

## 13. P2: GitHub PR Integration

将来的にGitHub PR URLから直接レビューを開始できるようにする。

例:

`PR Review: Open Pull Request`

```
https://github.com/foo/bar/pull/123
```

自動的に、

- repository
- base branch
- head branch
- PR metadata
- changed files

を取得する。

GitHub固有機能はMVPから分離する。

---

## 14. P2: Review Comments

将来的には変更行に対して、

Add Review Comment

できるようにする。

例:

```
+ 42 │ const result = calculate(value);
       │
       └── Add comment
```

GitHub PR review commentへの投稿まで対応する。

ただし、MVPではGitHub APIを使わない。

---

## 15. Non-Goals

MVPでは以下をやらない。

### Diff editorの再実装

VS Codeのdiff editorそのものを置き換えることは目的ではない。

### AI review

「このコードにはバグがあります」

などのAIレビューはMVPの対象外。

このプロダクトの価値は、

AIにレビューさせることではなく、人間がcodebase contextを持ってPRをレビューしやすくすること。

### GitHub専用にしない

GitHub APIへの依存をMVPに入れない。

まずは、

```
local Git repository
+
base revision
+
current working tree
```

だけで動作させる。

---

## 16. Technical Architecture

推奨構成:

```
src/
├── extension.ts
│
├── git/
│   ├── gitClient.ts
│   ├── diffParser.ts
│   └── repository.ts
│
├── review/
│   ├── reviewManager.ts
│   ├── reviewState.ts
│   └── changeTracker.ts
│
├── decorations/
│   ├── gutterDecorations.ts
│   ├── overviewDecorations.ts
│   └── hoverProvider.ts
│
├── views/
│   └── changesTreeView.ts
│
└── commands/
    ├── nextChange.ts
    ├── previousChange.ts
    └── markReviewed.ts
```

---

## 17. Git Layer

Git操作は最初はCLIを利用してよい。

例えば、

```
git rev-parse --show-toplevel
git rev-parse HEAD
git diff --unified=0 <base>...HEAD
git diff --name-status <base>...HEAD
```

を利用する。

ただしGit command executionは一箇所に集約する。

```typescript
interface GitClient {
  getRepositoryRoot(): Promise<string>;
  getCurrentRevision(): Promise<string>;
  getDiff(base: string, head?: string): Promise<GitDiff>;
  getChangedFiles(base: string, head?: string): Promise<ChangedFile[]>;
}
```

---

## 18. Diff Parser

Gitのunified diffを内部モデルに変換する。

```typescript
interface ChangedFile {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  changes: DiffChange[];
}

interface DiffChange {
  type: "add" | "delete" | "context";
  oldLine?: number;
  newLine?: number;
  content: string;
}
```

diff parserとVS Code UIを分離する。

---

## 19. Decorations Layer

DiffHunk / DiffChangeから現在のdocument上のline rangeを計算する。

例えば、

```
Git diff
    ↓
DiffHunk
    ↓
newLine numbers
    ↓
TextEditorDecoration
    ↓
gutter
```

とする。

ファイルのline numberがずれるケースを必ず考慮する。

---

## 20. Important Edge Cases

最低限テストする。

### Added file

`A src/foo.ts`

### Deleted file

deleted fileは現在のPR branchには存在しないため、通常editorへのgutter表示方法を別途考える。

MVPでは、

Changes Treeには表示

だけでもよい。

### Renamed file

`old.ts → new.ts`

### Binary file

diff decoration対象外。

### Untracked changes

PRレビュー対象は原則、

`base...HEAD`

とし、working treeの未commit変更は別扱いにする。

### Dirty working tree

PR branchをcheckoutしたあとにlocal変更がある場合、

`base...HEAD`

と

working tree

を混ぜない。

UI上で、

`PR Review: clean`

または

`PR Review: working tree has local changes`

と明示する。

---

## 21. Performance Requirements

大きなrepositoryでもeditor操作を重くしない。

- Git diffは非同期
- decoration更新も非同期
- editor変更ごとにGit diffを実行しない
- repository単位でdiff結果をcache
- 同一revision/baseならcacheを再利用
- 現在表示中のファイルを優先してdecoration生成

---

## 22. Important UX Rule

最重要ルール:

**レビュー中のユーザーが「diffを見るために通常のコードリーディングを中断しない」こと。**

理想的な操作フロー:

```
PR branch checkout
        ↓
PR Review開始
        ↓
src/foo.tsを開く
        ↓
通常のコードを読む
        ↓
gutterを見る
        ↓
「ここがPR変更だ」
        ↓
Go to Definition
        ↓
関連コードを見る
        ↓
Find References
        ↓
codebase全体を理解する
        ↓
変更箇所に戻る
        ↓
Next Change
```

---

## 23. Reference Implementations

### A. gitsigns.nvim — 最重要参考

[gitsigns.nvim](https://github.com/lewis6991/gitsigns.nvim)

今回の 「通常buffer + Git差分gutter」 のUXについて最も参考になる。

特に、

- sign column
- hunk navigation
- hunk preview
- change base revision

を参考にする。

gitsigns.nvim は `:Gitsigns change_base <REVISION>` によって比較対象revisionを変更できるため、今回の「PR branchを読みながらmainとの差分を見る」という設計に非常に近い。

### B. neo-reviewer — PR Review UXの参考

[neo-reviewer](https://github.com/dglsparsons/neo-reviewer)

特に参考にする部分:

- single-buffer inline diff
- gutter indicators
- change navigation
- old code preview
- review state
- PR comments

neo-reviewerは実際に「current file stateを表示しながらgutterに変更を表示する」設計になっているので、今回の要件との一致度が非常に高い。

### C. VS Code Extension Samples

[VS Code Extension Samples](https://github.com/microsoft/vscode-extension-samples)

特に、

- decorator-sample
- tree-view-sample

を見る。

VS Code公式sampleにはDecoration APIとTree View APIの実装例がある。

---

## 24. VS Code API

主に使うAPI:

- `vscode.window.createTextEditorDecorationType()`
- `vscode.TextEditor.setDecorations()`
- `vscode.window.onDidChangeActiveTextEditor`
- `vscode.workspace.onDidChangeTextDocument`
- `vscode.window.createTreeView()`
- `vscode.commands.registerCommand()`

Decorationについては VS Codeの `TextEditorDecorationType` / `setDecorations()` を利用する。

Tree Viewは VS Codeの Tree View API を利用する。

可能な限りstable APIだけでMVPを実装する。

Proposed APIへの依存は避ける。VS CodeのProposed APIはInsiders向けで、公開extensionでは利用できないため。

---

## 25. MVP Acceptance Criteria

以下を満たしたらMVP完成とする。

### Scenario

Repository:

```
main
└── feature/pr-123
```

現在、

```
git checkout feature/pr-123
```

している。

VS Codeでextensionを起動し、

```
PR Review: Set Base
→ origin/main
```

を指定する。

その後 `src/foo.ts` を開く。

### Expected

- `src/foo.ts` は通常のeditorで表示される
- 内容は `feature/pr-123` のコード
- `origin/main...HEAD` で変更された行がgutterに表示される
- diff editorを開かなくても変更箇所が分かる
- Go to Definitionが通常通り動く
- Find Referencesが通常通り動く
- Next Changeで次の変更へ移動できる
- Previous Changeで前の変更へ移動できる
- 変更箇所hoverでhunk diffを確認できる
- sidebarから変更ファイル一覧を確認できる
- sidebarからファイルを開いても通常editorが開く
- baseを `origin/main` から `origin/develop` に変更すると表示が更新される

---

## 26. Implementation Order

AIは以下の順番で実装すること。

```
Phase 1
├── VS Code extension scaffold
├── Git repository detection
├── current HEAD detection
└── base revision設定

Phase 2
├── git diff execution
├── unified diff parser
└── internal diff model

Phase 3
├── editor gutter decorations
├── active editor synchronization
└── change navigation

Phase 4
├── hover diff
└── overview ruler

Phase 5
├── Changes Tree View
└── review status

Phase 6
├── performance optimization
├── edge cases
└── tests

Phase 7+
├── GitHub PR integration
├── review comments
└── AI features
```

---

## 27. 実装AIへの指示（冒頭に付けること）

Do not start by implementing the full feature.

First inspect the reference implementations and the current VS Code Extension API.
Then propose the architecture and MVP implementation plan.

The key UX constraint is:

The PR branch's normal editor buffer must remain the primary source of truth. Diff information is an overlay/decorator, not a separate document.

The extension must allow developers to explore the entire codebase using normal VS Code navigation while continuously seeing which lines belong to the PR diff against an arbitrary base revision.

Prefer stable VS Code APIs. Do not use proposed APIs unless there is a demonstrated blocker and explicitly explain the trade-off first.

Use gitsigns.nvim and neo-reviewer as UX/reference implementations, but do not copy their implementation. Build an idiomatic VS Code extension architecture.

---

## 仕様の中心

特に **「Diff is metadata, not the document」** を仕様の中心に置くのが重要。

ここが曖昧だと、ありがちな「VS Code内にもう一個diff viewerを作る拡張」を実装してしまう。
