# AGENTS.md

## Architecture (class vs function)

VS Code 拡張の定石に合わせる。全部 class / 全部関数にしない。

- **class**: 寿命・状態・dispose があるもの。`TreeDataProvider` / Hover など API に渡すオブジェクト、Review session / decorations の Manager。公式サンプルや大きめ拡張もこの境界は class が多い
- **function**: 入出力がはっきりした純ロジック。`getGitContextForFile`、diff parser など
- **`GitClient`**: class でも `createGitClient` でもよい。本質は Git CLI 実行の集約

## Naming

- 名前だけで **何をするか・何に対してか** が分かること
- `resolve` / `handle` / `process` など曖昧な動詞は避ける
- 良い例: `getGitContextForFile`（ファイルが属する repo の root / branch / HEAD を返す）
- 悪い例: `resolveGitContext`（何を resolve しているか不明）

## Tests

- テストケース名は **振る舞い** を書く（実装詳細・API 名・決定 ID は入れない）
- 良い例: `refuses review when HEAD is detached`
- 悪い例: `marks detached HEAD as not reviewable` / `GitClient is the single execution entry` / `… (D9)`

## Workflow

- **Diff Editor をレビュー導線に使わない**。レビューは常に通常のエディタ上で完結させる（`vscode.diff` を呼ばない）
- **決定を変えるときは、先に [`docs/decisions.md`](./docs/decisions.md) を更新する**。コードを書いてから辻褄を合わせない
- 品質ゲートは `pnpm check` + `pnpm test`。バグ修正はまず**落ちるテスト**を書いてから直す
