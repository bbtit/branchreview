# SideDiff

Codebase-aware PR review for VS Code: keep the PR branch’s normal editor as the source of truth, and treat diff as gutter/decorator metadata.

**Diff is metadata, not the document.**

## Requirements

- [pnpm](https://pnpm.io/) (see D20)
- [Vite+](https://viteplus.dev/) (`vp` CLI) (see D21)

Install Vite+ if needed:

```bash
curl -fsSL https://vite.plus | bash
```

## Develop

```bash
pnpm install
vp check
vp test
vp pack   # or: pnpm build
```

Press **F5** in VS Code / Cursor to launch an Extension Development Host.

Command Palette:

- `SideDiff: Set Base` / `Resume Review` / `Stop Review` / `Clear Base`
- `SideDiff: Next Change` / `Previous Change` (`Alt+]` / `Alt+[`)
- `SideDiff: Show Git Context` (debug: repo root / branch / HEAD)

Status bar shows `SideDiff: off` or `SideDiff: <base>` (and `· local changes` when the working tree is dirty during review).

Activity bar **SideDiff** → **Changes** lists files from `base...HEAD` while overlay is ON. Click opens the normal editor (deleted files show a message only; never Diff Editor).

### Manual check (MVP-08)

1. Set Base so overlay is ON → SideDiff activity bar **Changes** lists modified/added/deleted/renamed files with `+/-` (and `binary` when applicable).
2. Click a non-deleted file → opens in the normal editor with gutters (when text).
3. Click a deleted file → information message only; no Diff Editor.
4. Stop Review → tree shows “Review is off”; Set Base again with a different base → list updates.
5. Base header row shows the current base revision.

### Manual check (MVP-06)

1. Set Base so overlay is ON on a branch with changes in multiple files.
2. **Next Change** / `Alt+]` moves to the next hunk in the same file, then the first hunk of the next file.
3. At the last change, Next wraps to the first; **Previous Change** / `Alt+[` wraps the other way.
4. Jumping to an unopened file opens it in the normal editor with gutters visible (no Diff Editor).

### Manual check (MVP-03)

1. On a normal branch, **Set Base** → pick `main` (or another existing ref) → status bar shows `SideDiff: <base>` (overlay ON).
2. **Stop Review** → status bar `SideDiff: off`; **Resume Review** → ON again with the same base.
3. Reload the window → overlay is OFF but Resume still works (base persisted, D3).
4. Set Base → enter a bogus revision → error; previous base unchanged; overlay stays off if it was off (D17).
5. `git checkout --detach` then Set/Resume → message to check out a branch; review does not start (D15).
6. Start review, then `git checkout` another branch → overlay auto-stops; base remains for Resume (D5).
7. With overlay ON, edit a tracked file → status bar includes `local changes`.
8. None of the commands open a Diff Editor.

### Manual check (MVP-02)

1. Open a file on a normal branch → Show Git Context shows repo root, branch, HEAD.
2. In a multi-root workspace, switch the active editor to a file in another repo → repo root/branch switch with the file (D9).
3. `git checkout --detach` then run Show Git Context → detached / not reviewable (D15).

## Tooling

| Task                  | Command                  |
| --------------------- | ------------------------ |
| Install               | `pnpm install`           |
| Lint + format + types | `vp check`               |
| Tests                 | `vp test`                |
| Bundle extension      | `vp pack` / `pnpm build` |

ESLint, Prettier, Jest, and webpack are intentionally not used.

## Docs

- [`docs/requirements.md`](./docs/requirements.md) — product requirements
- [`docs/decisions.md`](./docs/decisions.md) — implementation decisions
- [`docs/backlog.md`](./docs/backlog.md) — MVP backlog order
