# BranchReview — Product Decisions

Grilling で確定した判断。要件の正本は [`requirements.md`](./requirements.md)。本ドキュメントは実装時に参照する決定ログ。

製品名: **BranchReview**（ID: `branchreview`）

中心原則: **Diff is metadata, not the document.**

---

## Session lifecycle

| ID  | Decision                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | base を設定した瞬間から overlay が有効。`Stop Review` / `Clear Base` で消える                                                                                                  |
| D3  | base は workspace ごとに永続化するが、**起動時は overlay OFF**。`Resume Review` または `Set Base` で再開                                                                       |
| D4  | セッション系コマンド: `BranchReview: Set Base` / `BranchReview: Resume Review` / `BranchReview: Stop Review` / `BranchReview: Clear Base`。進捗系は Review status 節（D22 等） |
| D5  | レビュー中に別ブランチへ checkout したら **自動 Stop**（base 記憶は残す → Resume 可能）                                                                                        |
| D13 | overlay ON のまま同じブランチで HEAD が進んだら（commit / amend / pull 等）、`base...HEAD` を自動再取得して decoration / Tree を更新                                           |
| D15 | **detached HEAD ではレビュー開始不可**（branch に checkout してから、と案内）                                                                                                  |
| D17 | 無効な base（存在しない revision）はエラー表示して overlay を開始しない。前回の有効 base 記憶は触らない                                                                        |
| D14 | `Clear Base` は reviewed 進捗も破棄する                                                                                                                                        |
| D18 | コマンドプレフィックスは製品名で統一: `BranchReview: …`（要件書の `PR Review:` 表記は説明用）                                                                                  |

### Stop vs Clear

- **Stop Review** — overlay を止める。base 記憶は残す（Resume 可能）
- **Clear Base** — base 記憶を捨て、reviewed 進捗も破棄
- **Clear All Review Progress for This Repository** — 当該 repo の reviewed 進捗を全 `(base, branch)` 分破棄。base / overlay は維持（D22）

---

## Diff semantics

| ID  | Decision                                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D2  | gutter が示すのは常に **`base...HEAD`**。working tree の未 commit 変更と混ぜない。buffer が dirty でも行番号は HEAD 基準のまま。ずれは許容し、status bar で dirty を明示 |
| D8  | 行削除（ファイル残存）は、削除位置の隣接残存行に DELETE マーカーを置き、旧行は hover で表示する                                                                          |
| D12 | deleted ファイルは Changes Tree に出す。クリックしても開かず、情報メッセージのみ（「deleted on this branch」）。仮想ドキュメントや Diff Editor は使わない                |
| D26 | **Inline Old Code（§12）は作らない**。旧コードは hover で全文見えており、それで足りる                                                                                    |

### D26 の根拠（2026-09-20）

要件 §12 は「エディタ内に旧コードを展開する」だが、stable API ではエディタに**行を増やせない**。

- ファイルを書き換えれば行は増えるが、D2（diff は document ではない）に反する
- editor inset は **proposed API**（`@types/vscode` に存在しない）。「stable API のみ」の方針に反する
- デコレーションの `contentText` は文字列ひとつで改行できないため、既存の行に横付けする形にしかならない

一次情報は [`research-vscode-apis.md`](./research-vscode-apis.md)（設計前の API 調査）にある。
`contentText` が単一行で lsp_lines 相当の virtual lines を作れないことは
[VS Code #63600](https://github.com/microsoft/vscode/issues/63600) として、`editorInsets` が proposed であることも
そこで調査済みだった。2026-09-20 に `@types/vscode` の型定義で再確認している。

残る代替（行末に重ねる / CodeLens で開閉）はどれも「ひと手間かけて旧コードを見る」形になり、
既に実装済みの hover と役割が重なる。よって作らない。

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

| ID  | Decision                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D10 | reviewed 状態のキーは **`(repo, base, branch名)`**。同じ feature branch 上なら commit が増えても維持。HEAD tip 単位ではリセットしない                               |
| D22 | `BranchReview: Clear All Review Progress for This Repository` は当該 repo の reviewed 進捗を **全 `(base, branch)` 分** 破棄する。base と overlay ON/OFF は触らない |

---

## UI chrome

| ID  | Decision                                                                                                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D11 | status bar を出す。例: `BranchReview: origin/main` / `BranchReview: off` / `… local changes`。ON/OFF・base・dirty が一目で分かるようにする。dirty は overlay ON のときだけ判定する（OFF 中は `git status` を実行しない） |
| D16 | 表示名 `BranchReview`、パッケージ ID `branchreview`                                                                                                                                                                      |
| D20 | パッケージマネージャは **pnpm**（npm / yarn は使わない）。lockfile は `pnpm-lock.yaml` をコミット。VS Code 拡張で必要なら `.npmrc` で hoist を調整してよい                                                               |
| D21 | 開発ツールチェーンは **VoidZero / Vite+**（`vp` CLI）を正とする。ESLint / Prettier / Jest / webpack は使わない                                                                                                           |
| D27 | 製品名を **SideDiff → BranchReview** に改名（2026-09-20、初公開前）。拡張 ID は `bbtit.branchreview`                                                                                                                     |

### D27 の根拠（2026-09-20）

初公開の直前に改名した。拡張 ID（`publisher.name`）は**公開後に変更できない**。変えるには別 ID で出し直してインストール数と評価を捨てることになるため、判断できる最後の機会だった。

- **`SideDiff` をやめた理由**: 「Side」が side-by-side を連想させる。この拡張の最も際立った特徴は左右分割の Diff Editor を絶対に開かないことなので、名前が製品の拒否している体験を約束していた
- **`BranchDiff` を選ばなかった理由**: Open VSX に `Encryptioner.branchdiff`（920 DL）が既にあり、同じブランチレビュー領域で正面衝突する（VS Code Marketplace 側は空いていた）
- **`BranchReview` にした理由**: 両マーケットで空いており、`Diff` を頭に置かないので「diff 画面へ連れて行かない」という製品の主張と矛盾しない

候補のうち `Baseline`（`dmytroulianov.baseline`）と `Sightline`（`LucidLayer.sightline-extension`）は既存拡張との衝突で除外した。

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

## Release / publishing

| ID  | Decision                                                                                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D23 | 配布先は **VS Code Marketplace（`vsce`）と Open VSX（`ovsx`）の両方**。どちらも `pnpm dlx` で都度実行し、devDependencies には足さない（D21 を崩さない） |
| D24 | VSIX に入れるのは `dist/extension.cjs` と `media/` だけ。`src` / `tests` / `docs` / tooling config は `.vscodeignore` で除外する                        |
| D25 | CI（GitHub Actions）は push / PR で `pnpm check` → `pnpm test` → `pnpm build`。**公開は CI から行わない**（トークンを CI に置かない）                   |

公開手順:

```sh
pnpm package                      # vp pack → VSIX を作る
unzip -l branchreview-<version>.vsix  # dist と media だけか確認する
pnpm dlx @vscode/vsce publish --packagePath branchreview-<version>.vsix  # Marketplace
pnpm dlx ovsx publish branchreview-<version>.vsix                        # Open VSX
```

npm を経由しないこと（D20 の帰結。2026-09-20 に実際に踏んだ）:

- **`npx` は使えない**。`devEngines.packageManager` が pnpm なので、npm が `EBADDEVENGINES` で止まる
- **`vscode:prepublish` は置かない**。vsce はこのスクリプトを **`npm run` で** 実行するため、同じ理由で失敗する。
  ビルドは `pnpm package`（`vp pack && …`）が先に済ませ、公開は `--packagePath` で作成済みの VSIX を渡す
- `private: true` が付いたままでも `vsce package` は通る（確認済み）

---

## Naming notes

- GitHub リポジトリ名は `bbtit/branchreview`（D27 で製品名に合わせた。旧 URL は GitHub がリダイレクトする）
- ローカルの作業ディレクトリ名は `vscode-diff` のままで、揃える必要はない
- ユーザー向け製品名は BranchReview
- [`requirements.md`](./requirements.md) 内の「PR Review:」コマンド例は、実装では `BranchReview:` に読み替える

---

## Explicitly unchanged from requirements

- Diff Editor を主役にしない / `vscode.diff` をレビュー導線に使わない
- GitHub API・AI review・Inline Old Code は MVP 外
- stable VS Code API のみ
- 比較は `base...HEAD`（three-dot）
- 実装順序は requirements §26 の Phase 1→6
