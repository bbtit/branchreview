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

Press **F5** in VS Code / Cursor to launch an Extension Development Host. Command Palette → `SideDiff: Show Git Context` (active file’s repo root / branch / HEAD; detached HEAD is marked not reviewable).

### Manual check (MVP-02)

1. Open a file on a normal branch → command shows repo root, branch, HEAD.
2. In a multi-root workspace, switch the active editor to a file in another repo → repo root/branch switch with the file (D9).
3. `git checkout --detach` then run the command → detached / not reviewable (D15).

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
