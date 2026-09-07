# Research: VS Code APIs for single-buffer PR gutter diffs

**Date:** 2026-09-07  
**Goal:** Show git PR diffs as gutter decorations on the normal editor buffer (not a Diff Editor).  
**Scope:** Primary sources only — official Extension API, Microsoft samples, gitsigns.nvim UX, neo-reviewer patterns.

---

## Executive summary

**MVP (gutter icons + overview ruler + hover + changed-files TreeView + next/prev change) does not need proposed APIs.** Stable `TextEditorDecorationType` / `setDecorations`, Tree View, and Commands cover it on the normal text editor.

Proposed surfaces (`quickDiffProvider`, `textEditorDiffInformation`, `documentDiff`, `editorInsets`) are optional later for SCM-gutter integration, built-in diff math, or rich inline insets — not required to ship the MVP.

Closest UX references: **gitsigns.nvim** (`change_base` against an arbitrary revision, signcolumn hunks, `nav_hunk`, `preview_hunk`) and **neo-reviewer** (single-buffer PR review with gutter signs + change navigation). Transfer patterns only; do not copy implementations.

---

## Stable APIs that cover MVP

### 1. Editor decorations (gutter + overview + hover)

| Capability                    | Stable API                                                                           | Notes                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| Create styled decoration type | `window.createTextEditorDecorationType(DecorationRenderOptions)`                     | Returns `TextEditorDecorationType`; dispose when done.   |
| Gutter mark                   | `ThemableDecorationRenderOptions.gutterIconPath` (`string \| Uri`), `gutterIconSize` | Absolute path or URI to an image in the gutter.          |
| Overview scrollbar            | `overviewRulerColor` (`string \| ThemeColor`), `overviewRulerLane`                   | Same type options as other decorations.                  |
| Per-range hover               | `DecorationOptions.hoverMessage` (`MarkdownString` / marked string)                  | Applied via `setDecorations` with `DecorationOptions[]`. |
| Apply / replace               | `TextEditor.setDecorations(type, Range[] \| DecorationOptions[])`                    | Replaces all decorations for that type; `[]` clears.     |
| Edit edge behavior            | `DecorationRenderOptions.rangeBehavior`                                              | Defaults to `OpenOpen`; tune when buffer edits.          |
| Optional inline preview text  | `before` / `after` attachments (`contentText`)                                       | Single-line injected text; not multiline virtual lines.  |

**Primary defs:** [vscode.d.ts — decorations](https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.d.ts) (`ThemableDecorationRenderOptions` ~L987+, `DecorationOptions` ~L1206+, `setDecorations` ~L1352, `createTextEditorDecorationType` ~L11262).  
**Published docs:** [VS Code API reference](https://code.visualstudio.com/api/references/vscode-api) (anchors: `#DecorationRenderOptions`, `#DecorationOptions`, `#TextEditorDecorationType`, `#TextEditor.setDecorations`).

**Sample (official):** [decorator-sample](https://github.com/microsoft/vscode-extension-samples/tree/main/decorator-sample) — creates types with `overviewRulerColor` / theme colors, builds `DecorationOptions` with `hoverMessage`, calls `activeEditor.setDecorations`, refreshes on `onDidChangeActiveTextEditor` and throttled `onDidChangeTextDocument` ([extension.ts](https://raw.githubusercontent.com/microsoft/vscode-extension-samples/main/decorator-sample/src/extension.ts), [USAGE.md](https://github.com/microsoft/vscode-extension-samples/blob/main/decorator-sample/USAGE.md)).

**MVP mapping:** one decoration type per change kind (add / modify / delete-marker); ranges from unified-diff hunks mapped to buffer lines; hover shows deleted/old snippet or hunk summary via Markdown.

### 2. Tree View (changed files list)

| Capability      | Stable API                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------- |
| Contribute view | `contributes.views` / `viewsContainers` in `package.json`                                         |
| Data            | `TreeDataProvider` (`getChildren`, `getTreeItem`, optional `onDidChangeTreeData`)                 |
| Register        | `window.registerTreeDataProvider` or `window.createTreeView` (need `TreeView` for reveal/message) |
| Actions         | `commands` + `menus` (`view/title`, `view/item/context`)                                          |
| Workspace root  | `workspace.workspaceFolders`                                                                      |

**Primary docs:** [Tree View API guide](https://code.visualstudio.com/api/extension-guides/tree-view).  
**Sample:** [tree-view-sample](https://github.com/microsoft/vscode-extension-samples/tree/main/tree-view-sample) — views, containers, refresh command, `workspaceFolders[0]` ([README](https://github.com/microsoft/vscode-extension-samples/blob/main/tree-view-sample/README.md)).

### 3. Commands + next/prev change

| Capability    | Stable API                                                                                           |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| Register      | `commands.registerCommand` + `contributes.commands` / keybindings                                    |
| Jump          | Maintain ordered hunk ranges; `editor.selection` + `editor.revealRange(range, TextEditorRevealType)` |
| Hover actions | Command URIs in trusted `MarkdownString` (`command:…`)                                               |

**Primary docs:** [Commands guide](https://code.visualstudio.com/api/extension-guides/command).  
`revealRange` is stable on `TextEditor` ([vscode.d.ts](https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.d.ts)).

### 4. Proposed APIs — **not needed for MVP**

| Proposed                                                                                                                                   | Purpose                                | Why skip for MVP                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- | ------------------------------------------------- |
| [`quickDiffProvider`](https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.proposed.quickDiffProvider.d.ts)                 | Register alternate SCM quick-diff base | Built-in SCM gutter; MVP uses custom decorations. |
| [`textEditorDiffInformation`](https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.proposed.textEditorDiffInformation.d.ts) | Observe SCM diff hunks on editors      | SCM-primary diffs, not arbitrary PR base.         |
| [`documentDiff` / `getTextDiff`](https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.proposed.documentDiff.d.ts)           | Host diff algorithm                    | Nice-to-have; `git diff` / own Myers is fine.     |
| [`editorInsets`](https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.proposed.editorInsets.d.ts)                           | Webview inset in editor                | Overkill for hover/preview.                       |

Shipping Marketplace extensions should prefer stable APIs; proposed APIs require Insiders / special enablement.

---

## Gaps / edge cases

### Deleted files

Decorations attach to an open `TextEditor`. A file deleted on the PR branch has no working-tree buffer to decorate. Handle in the TreeView (open base/old content via `TextDocumentContentProvider` / virtual document, or link to Diff Editor for that path only). Neo-reviewer’s architecture still treats missing content as a review-tree concern, not a gutter on an absent buffer ([neo-reviewer README](https://github.com/dglsparsons/neo-reviewer)).

### Pure deletions (lines removed, file still present)

Gutter icons need a non-empty `Range` ([DecorationOptions.range](https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.d.ts) — “must not be empty”). Anchor a zero-width/marker range on the adjacent surviving line (common gitsigns pattern: delete sign on the line after the removal). Full deleted text belongs in `hoverMessage` or a command-opened peek — **not** multiline virtual lines. Stable `before`/`after` `contentText` is single-line; multiline always-visible inline deleted blocks are not a supported decoration feature ([VS Code #63600](https://github.com/microsoft/vscode/issues/63600) / community confirmation that `contentText` cannot do lsp_lines-style virtual lines).

### Dirty working tree / line mapping

Hunk line numbers from `git diff base...head` (or PR files API) refer to a specific blob. If the open buffer has unsaved edits, those lines drift.

Stable mitigations (no proposed API):

1. Diff **PR base blob → current `document.getText()`** (or base → HEAD, then map HEAD→dirty with a second diff).
2. Recompute on throttled `workspace.onDidChangeTextDocument` (as decorator-sample does).
3. Use `rangeBehavior` so decorations survive trivial edge edits; still recompute for correctness.
4. Surface staleness in hover/status when `document.isDirty` and mapping confidence is low.

`TextEditorDiffInformation.isStale` (proposed) mirrors this idea for SCM; for PR base, own versioning (document version + base SHA) is enough.

### Diff Editor vs normal buffer

`vscode.diff` / Diff Editor is a separate surface. Official GitHub PR extension opens Diff Editors for review ([marketplace](https://marketplace.visualstudio.com/items?itemName=GitHub.vscode-pull-request-github)). This product explicitly stays on the normal buffer — decorations only.

---

## UX lessons from gitsigns and neo-reviewer

Transferable patterns only (not implementation).

### gitsigns.nvim ([doc/gitsigns.txt](https://github.com/lewis6991/gitsigns.nvim/blob/main/doc/gitsigns.txt), [repo](https://github.com/lewis6991/gitsigns.nvim))

| Pattern                                                                                          | Transfer to VS Code                                                                                  |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| **`change_base(rev)`** — signs vs arbitrary revision (e.g. `HEAD~1`, commit SHA), not only index | Treat PR merge-base / base SHA as the decoration base; command to retarget base.                     |
| **Signcolumn kinds** — add / change / delete / untracked glyphs                                  | Distinct `gutterIconPath` (or colors) per hunk type; optional overview ruler colors.                 |
| **`nav_hunk` / next-prev** with wrap, optional auto-preview                                      | Commands: next/prev change; `revealRange`; optional open hover/preview after jump.                   |
| **`preview_hunk` (float) vs `preview_hunk_inline`**                                              | Prefer hover / Quick Pick / small Webview panel for deleted lines; avoid fake multiline decorations. |
| **`setqflist` of hunks**                                                                         | TreeView or Problems-like list of changes across files.                                              |
| **Debounced refresh on buffer change**                                                           | Throttle decoration updates on edit (decorator-sample pattern).                                      |

### neo-reviewer ([dglsparsons/neo-reviewer](https://github.com/dglsparsons/neo-reviewer))

| Pattern                                                        | Transfer to VS Code                                                                                                   |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Single-buffer review** — current file state + gutter (+/−/~) | Core product shape: decorate working buffer, not Diff Editor.                                                         |
| **Change navigation** (`next_change` / `prev_change`, wrap)    | Same as gitsigns nav → VS Code commands + keybindings.                                                                |
| **Expandable old-code preview** (toggle)                       | MVP: hover with old lines; later: command to toggle peek / content provider. Not required as always-on virtual lines. |
| **File picker for changed files**                              | TreeView of PR files (tree-view-sample).                                                                              |
| **CLI parses unified diffs → change blocks**                   | Architecture: git/GitHub fetch + parse hunks → decoration ranges (language-agnostic core).                            |
| **Review comments / approve**                                  | Out of MVP decoration scope; Comments API later if needed.                                                            |

---

## Recommendations for architecture

```
┌─────────────────────────────────────────────────────────┐
│ Extension host                                          │
│  DiffService: resolve PR base SHA, run git/API diff     │
│  HunkModel: file → sorted hunks (add/change/delete)     │
│  DecorationController: types + setDecorations per editor│
│  Navigation: next/prev over HunkModel for active URI    │
│  TreeProvider: changed files → open + focus first hunk  │
└─────────────────────────────────────────────────────────┘
```

1. **Stay on stable decoration APIs** for MVP. No proposed enablement for Marketplace v1.
2. **Separate DiffService from UI** — compute hunks once; drive decorations, tree, and navigation from one model (neo-reviewer’s CLI/parse split is the right _shape_).
3. **Three decoration types** (add / modify / delete-anchor) with shared overview colors; per-hunk `hoverMessage` for detail.
4. **Dirty buffers:** always re-diff against live document text (or map through HEAD); never trust static PR line numbers alone.
5. **Deleted files:** tree entry only; open virtual old content or optional Diff Editor escape hatch — don’t pretend a gutter exists.
6. **Borrow UX verbs from gitsigns:** “change base”, next/prev change, preview hunk — implement with VS Code commands/hovers.
7. **Defer** Quick Diff Provider, Comments API, and multiline inline old-code until after MVP validates gutter+tree+nav.

### Sources (index)

- [vscode.d.ts decorations / setDecorations / workspaceFolders / TreeView](https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.d.ts)
- [VS Code API reference](https://code.visualstudio.com/api/references/vscode-api)
- [Tree View guide](https://code.visualstudio.com/api/extension-guides/tree-view)
- [Commands guide](https://code.visualstudio.com/api/extension-guides/command)
- [decorator-sample](https://github.com/microsoft/vscode-extension-samples/tree/main/decorator-sample)
- [tree-view-sample](https://github.com/microsoft/vscode-extension-samples/tree/main/tree-view-sample)
- [gitsigns.nvim docs](https://github.com/lewis6991/gitsigns.nvim/blob/main/doc/gitsigns.txt)
- [neo-reviewer](https://github.com/dglsparsons/neo-reviewer)
- Proposed (reference only): [quickDiffProvider](https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.proposed.quickDiffProvider.d.ts), [textEditorDiffInformation](https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.proposed.textEditorDiffInformation.d.ts), [documentDiff](https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.proposed.documentDiff.d.ts), [editorInsets](https://github.com/microsoft/vscode/blob/main/src/vscode-dts/vscode.proposed.editorInsets.d.ts)
