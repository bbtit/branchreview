# SideDiff — Product Decisions

Grilling で確定した判断。要件の正本は [`requirements.md`](./requirements.md)。本ドキュメントは実装時に参照する決定ログ。

製品名: **SideDiff**（ID: `sidediff`）

中心原則: **Diff is metadata, not the document.**

---

## Session lifecycle

| ID  | Decision                                                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | base を設定した瞬間から overlay が有効。`Stop Review` / `Clear Base` で消える                                                        |
| D3  | base は workspace ごとに永続化するが、**起動時は overlay OFF**。`Resume Review` または `Set Base` で再開                             |
| D4  | コマンドは次の4つ: `SideDiff: Set Base` / `SideDiff: Resume Review` / `SideDiff: Stop Review` / `SideDiff: Clear Base`               |
| D5  | レビュー中に別ブランチへ checkout したら **自動 Stop**（base 記憶は残す → Resume 可能）                                              |
| D13 | overlay ON のまま同じブランチで HEAD が進んだら（commit / amend / pull 等）、`base...HEAD` を自動再取得して decoration / Tree を更新 |
| D15 | **detached HEAD ではレビュー開始不可**（branch に checkout してから、と案内）                                                        |
| D17 | 無効な base（存在しない revision）はエラー表示して overlay を開始しない。前回の有効 base 記憶は触らない                              |
| D14 | `Clear Base` は reviewed 進捗も破棄する                                                                                              |
| D18 | コマンドプレフィックスは製品名で統一: `SideDiff: …`（要件書の `PR Review:` 表記は説明用）                                            |

### Stop vs Clear

- **Stop Review** — overlay を止める。base 記憶は残す（Resume 可能）
- **Clear Base** — base 記憶を捨て、reviewed 進捗も破棄

---

## Diff semantics

| ID  | Decision                                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D2  | gutter が示すのは常に **`base...HEAD`**。working tree の未 commit 変更と混ぜない。buffer が dirty でも行番号は HEAD 基準のまま。ずれは許容し、status bar で dirty を明示 |
| D8  | 行削除（ファイル残存）は、削除位置の隣接残存行に DELETE マーカーを置き、旧行は hover で表示。editor 内への旧コード展開は P2                                              |
| D12 | deleted ファイルは Changes Tree に出す。クリックしても開かず、情報メッセージのみ（「deleted on this branch」）。仮想ドキュメントや Diff Editor は使わない                |

---

## Base selection

| ID  | Decision                                                                                                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D6  | Set Base の QuickPick 優先順位: **前回 base（あれば）** → `upstream/main` → `origin/main` → `origin/master` → `main` → `master` → `develop` 系 → その他 local/remote → 自由入力 |

---

## Navigation

| ID  | Decision                                                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| D7  | Next / Previous Change は **全変更ファイル横断**。末尾の次は先頭に **wrap**                                                                   |
| D19 | デフォルトキーバインド: Next = `Alt+]`（Mac: Option+]）、Previous = `Alt+[`（Mac: Option+[）。`Ctrl+[`/`]` はインデントと衝突するため使わない |

---

## Workspace / multi-root

| ID  | Decision                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------ |
| D9  | multi-root workspace では、**アクティブ editor が属する folder の Git repo** を対象にする。base 等の状態も repo 単位で紐づける |

---

## Review status

| ID  | Decision                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------- |
| D10 | reviewed 状態のキーは **`(repo, base, branch名)`**。同じ feature branch 上なら commit が増えても維持。HEAD tip 単位ではリセットしない |

---

## UI chrome

| ID  | Decision                                                                                                                                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D11 | status bar を出す。例: `SideDiff: origin/main` / `SideDiff: off` / `… local changes`。ON/OFF・base・dirty が一目で分かるようにする                         |
| D16 | 表示名 `SideDiff`、パッケージ ID `sidediff`                                                                                                                |
| D20 | パッケージマネージャは **pnpm**（npm / yarn は使わない）。lockfile は `pnpm-lock.yaml` をコミット。VS Code 拡張で必要なら `.npmrc` で hoist を調整してよい |
| D21 | 開発ツールチェーンは **VoidZero / Vite+**（`vp` CLI）を正とする。ESLint / Prettier / Jest / webpack は使わない                                             |

### Tooling (D21) — 詳細

| 用途           | ツール                                                            | コマンド                                   |
| -------------- | ----------------------------------------------------------------- | ------------------------------------------ |
| 依存関係       | pnpm（D20）。`vp install` を使っても最終的に pnpm でよい          | `pnpm install` / `vp install`              |
| テスト         | **Vitest**（Vite+ 同梱）                                          | `vp test`（package script もこれに揃える） |
| Lint           | **Oxlint**                                                        | `vp check` に含める                        |
| Format         | **Oxfmt**                                                         | `vp check` / `vp check --fix`              |
| 型チェック     | Vite+ の check 経路（tsgo 等）                                    | `vp check`                                 |
| 拡張のバンドル | VoidZero 系（**tsdown** または Vite library build）。webpack 禁止 | `vp build` または `pnpm build` → `vp` 経由 |

運用ルール:

- 日常の品質ゲートは **`vp check` + `vp test`**
- ユニットテストは Node 環境の Vitest（まずは `diffParser` 等の純ロジック）。Extension Host 結合は必要になったら後続 ticket で追加
- 設定は可能な限り `vite.config.ts`（Vite+ 統合 config）に集約。個別の `.eslintrc` / `.prettierrc` / `jest.config` は作らない
- Vite+ は alpha でも採用する（ユーザー方針）。壊れたら upstream に合わせて直し、代替に ESLint/Jest へ戻さない

---

## Naming notes

- リポジトリ名 `guitarfish` はそのままでよい（コードネーム）
- ユーザー向け製品名は SideDiff
- [`requirements.md`](./requirements.md) 内の「PR Review:」コマンド例は、実装では `SideDiff:` に読み替える

---

## Explicitly unchanged from requirements

- Diff Editor を主役にしない / `vscode.diff` をレビュー導線に使わない
- GitHub API・AI review・Inline Old Code は MVP 外
- stable VS Code API のみ
- 比較は `base...HEAD`（three-dot）
- 実装順序は requirements §26 の Phase 1→6
