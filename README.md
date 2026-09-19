# SideDiff

_日本語: [README.ja.md](./README.ja.md)_

**Diff is metadata, not the document.**

Review a pull request without leaving your codebase. SideDiff keeps the branch open in the **normal editor** — IntelliSense, go-to-definition, find-references, your own extensions, all of it — and paints the diff on top as gutter marks and hovers.

It never opens a side-by-side Diff Editor.

## Why

A Diff Editor shows two columns of text. It cannot tell you who calls the function you just changed, or what the type on line 40 actually is, because the thing you are reading is not your project — it is a snapshot in a scratch buffer.

SideDiff turns that around. You read the real file, in the real project, and the diff rides along as metadata in the gutter. Reviewing stays a codebase activity.

## Features

- **Gutter marks** for added, changed, and deleted lines across `base...HEAD`
- **Hover** on a mark to see the old code a change or deletion replaced
- **Changes view** in the activity bar: every changed file with `+n -n`, plus `binary` and rename hints
- **Mark files reviewed** from the tree; progress survives new commits on the same branch
- **Jump between changes** across files with `Alt+]` / `Alt+[`, wrapping at the ends
- **Three-dot comparison** (`base...HEAD`): you see what the branch changed, never your own uncommitted work
- **Multi-root aware**: the active editor decides which repository is under review

## How to use it

### 1. Start a review

Check out the branch you want to review. Then open the Command Palette (`Ctrl+Shift+P`, macOS `Cmd+Shift+P`), run **`SideDiff: Set Base`**, and pick what to compare against — usually `main` or `origin/main`, but any branch, tag, or commit works.

That is the whole setup. The status bar switches from `SideDiff: off` to `SideDiff: main`.

### 2. Read the code

Open files the way you always do. Changed lines now carry a gutter mark:

| Mark        | Meaning                                                                         |
| ----------- | ------------------------------------------------------------------------------- |
| **Added**   | lines this branch introduced                                                    |
| **Changed** | lines this branch rewrote                                                       |
| **Deleted** | lines this branch removed — the mark sits on the surviving line next to the gap |

**Hover any mark** to see that hunk as a diff, including the old code that was replaced or deleted. Nothing is ever injected into your file.

Because this is your real file in your real project, everything else still works while you review: go-to-definition, find-references, rename, your linter, your tests.

### 3. Walk the changes

`Alt+]` goes to the next change, `Alt+[` to the previous one — **across files**, wrapping from the last change back to the first. Jumping into a file you have not opened yet just opens it normally.

The activity bar **SideDiff → Changes** lists every changed file with its `+n -n`. Click a file to open it at its changes.

### 4. Keep track of what you have read

Right-click a file in the Changes view and choose **Mark as Reviewed**. It gets a ✓, and the progress row counts up (`3 / 12 files reviewed`).

Progress is remembered per repository, base, and branch — so when new commits land on the same branch, what you already reviewed stays reviewed.

### 5. Finish, or come back later

**`SideDiff: Stop Review`** turns the overlay off but keeps the base, so **`Resume Review`** picks it straight back up — including after a window reload. **`Clear Base`** forgets the base and the reviewed progress.

While a review is on, the status bar reads `SideDiff: <base>`, with `· local changes` appended when your working tree is dirty — so you always know the gutter is showing the commit range and not your own uncommitted edits.

## Commands

| Command                                                   | What it does                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------- |
| `SideDiff: Set Base`                                      | Pick the revision to compare against and start the review     |
| `SideDiff: Resume Review`                                 | Restart the review with the remembered base                   |
| `SideDiff: Stop Review`                                   | Turn the overlay off, keep the base for later                 |
| `SideDiff: Clear Base`                                    | Forget the base and the reviewed progress                     |
| `SideDiff: Next Change` / `Previous Change`               | Move to the next / previous hunk, across files                |
| `SideDiff: Mark as Reviewed` / `Mark as Unreviewed`       | Toggle a file's reviewed state from the Changes view          |
| `SideDiff: Clear All Review Progress for This Repository` | Drop reviewed progress for every base and branch in this repo |
| `SideDiff: Show Git Context`                              | Show the repository root, branch, and HEAD (debugging)        |

## Keybindings

| Shortcut                   | Command         |
| -------------------------- | --------------- |
| `Alt+]` (macOS `Option+]`) | Next Change     |
| `Alt+[` (macOS `Option+[`) | Previous Change |

## Good to know

- **Uncommitted changes are not part of the review.** The gutter always reflects `base...HEAD`; the status bar flags a dirty working tree instead of mixing the two.
- **Deleted files** appear in the Changes view but do not open — there is no file left to show.
- **Binary files** are listed without gutter decorations.
- **A detached HEAD cannot start a review**; check out a branch first.
- Switching branches mid-review stops the overlay automatically and keeps the base for **Resume Review**.

## Requirements

- VS Code 1.96 or newer
- `git` on your `PATH`

## Development

```bash
pnpm install
pnpm check   # oxlint + oxfmt + types
pnpm test    # vitest
pnpm build   # bundle to dist/extension.cjs
```

Press **F5** to launch an Extension Development Host. The toolchain is [Vite+](https://viteplus.dev/) (`vp`); ESLint, Prettier, Jest, and webpack are intentionally not used.

- [`docs/requirements.md`](./docs/requirements.md) — product requirements
- [`docs/decisions.md`](./docs/decisions.md) — implementation decisions, and why
- [`docs/research-vscode-apis.md`](./docs/research-vscode-apis.md) — the VS Code API survey the design rests on
- [`docs/manual-tests.md`](./docs/manual-tests.md) — manual QA steps
- [`docs/next-steps.md`](./docs/next-steps.md) — what is left

## License

[MIT](./LICENSE)
