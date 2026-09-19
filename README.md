# SideDiff

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

## Getting started

1. Check out the branch you want to review.
2. Run **`SideDiff: Set Base`** and pick a base (`main`, `origin/main`, a tag, any revision).
3. Gutter marks appear, and the activity bar **SideDiff → Changes** lists the changed files.
4. Walk the change list with `Alt+]`, or click a file in the tree to open it.
5. Run **`SideDiff: Stop Review`** when you are done. **`Resume Review`** picks the same base back up.

The status bar shows `SideDiff: off`, or `SideDiff: <base>` while a review is on — with `· local changes` appended when the working tree is dirty, so you always know the gutter is showing the commit range and not your edits.

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
- [`docs/decisions.md`](./docs/decisions.md) — implementation decisions
- [`docs/manual-tests.md`](./docs/manual-tests.md) — manual QA steps
- [`docs/next-steps.md`](./docs/next-steps.md) — what is left

## License

[MIT](./LICENSE)
