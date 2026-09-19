# SideDiff これからやるべきこと

最終更新: 2026-09-20

MVP の実装 issue（#1〜#11、#14〜#16）はすべて完了し、実際の VS Code 上でも動作を確認済み。
このドキュメントは **MVP を閉じたあとに何が残っているか** を1か所にまとめたもの。
実装済みの内容は各 issue のクローズコメントとコミットにあるので、ここでは繰り返さない。

- 要件: [`requirements.md`](./requirements.md) / 決定: [`decisions.md`](./decisions.md)
- MVP の進行: [`backlog.md`](./backlog.md) / 手動手順: [`manual-tests.md`](./manual-tests.md)
- issue: https://github.com/bbtit/sidediff/issues

---

## 1. MVP は完了

2026-09-20 に §25 の受け入れ項目を実際の VS Code 上ですべて確認し、
[#12](https://github.com/bbtit/sidediff/issues/12) / Epic [#13](https://github.com/bbtit/sidediff/issues/13) / Milestone MVP を閉じた。
これ以降の作業は次節以降。

---

## 2. 既知の不具合

### 2.1 空白・非 ASCII を含むファイル名で gutter が出ない — 修正済み

issue: [#17](https://github.com/bbtit/sidediff/issues/17)

原因は、git が出すパス表記を素通ししていたこと。3点を直した。

- `git -c core.quotepath=false diff …` にして、非 ASCII パスが8進エスケープにならないようにした
- `---` / `+++` 行の行末タブを落とす。名前の中のタブはエスケープされるので、最初のタブが必ず終端になる
- C 形式クォート（`"…"` + エスケープ）の解除を `src/diff/gitPathQuoting.ts` に置き、
  raw のステータス行と patch の両方で通す

加えて `diff --git a/… b/…` は、空白入りの名前だと一意に分割できない（`a/sp ace.txt b/sp ace.txt`）。
そのため rename 以外は左右が同じであることを使って中央で割り、
それでも決まらないときは **raw のステータス行が報告したパス一覧を正として** 突き合わせる。
ついでに、hunk の中の `+++ x`（`++ x` という行の追加）をファイルヘッダと誤読するバグも直した。

テスト: `tests/edge-cases.test.ts` に空白入り・日本語・`"` を含む名前の end-to-end、
`tests/diff-parser.test.ts` にパーサ単体を追加。いずれも修正前のコードで落ちることを確認済み。

残り: 実 VS Code での確認（手順は [`manual-tests.md`](./manual-tests.md) のケース12）。

### 2.2 multi-root の同時レビュー

2つ以上のリポジトリで同時に overlay を ON にする経路は、自動テスト（`tests/diff-pipeline.test.ts` のキャッシュ分離）では見ているが、
実 VS Code での手動確認をしていない。`manual-tests.md` にケースを追加する。

---

## 3. リリース準備

2026-09-20 に一通り揃えた。**公開そのものはまだ行っていない。**

済み:

- `LICENSE`（MIT / 2026 bbtit）を置いた
- `README.md` を Marketplace 向けに書き直した（何が嬉しいか・コマンド表・キーバインド・制約）。開発者向けの内容は末尾に小さく残した
- `.vscodeignore` を追加。`pnpm package` で実際に VSIX を作って中身を確認した
  → **11ファイル / 27.6 KB**。`dist/extension.cjs` と `media/` と `package.json` / `README` / `LICENSE` のみで、
  `src` / `tests` / `docs` / sourcemap は入らない
- `package.json`: `icon`（`media/icon.png` 128×128）、`categories` に `SCM Providers`、`keywords` / `homepage` / `bugs` を追加。
  `version` は `0.0.1` のまま（意図的）
- `vscode:prepublish` を廃止し `pnpm package` に集約した。理由は [`decisions.md`](./decisions.md) の Release / publishing を参照
  （vsce がこのスクリプトを `npm run` で実行するため、`devEngines` の pnpm 指定と衝突して必ず失敗する）
- 公開手順を `decisions.md` の D23〜D25 に記録した
- CI: `.github/workflows/ci.yml`（push / PR で `pnpm check` → `pnpm test` → `pnpm build`）

残り:

- **CI をまだ一度も走らせていない**。push するまで green かどうかは分からない
- スクリーンショット / GIF が無い。Marketplace のページとしては弱い
- 実際の公開と、そのためのアカウント・トークンの準備
- `version` を上げるタイミングの判断（今は `0.0.1`）

---

## 4. 品質の宿題

各 issue のクローズコメントに散っているものを集約。

- **Extension Host の自動テストが無い**。現在は Node 上の Vitest + fake `vscode`（`tests/fakes/vscode.ts`）。
  D21 に「必要になったら後続 ticket で追加」とあるので、判断はそのとき
- **watcher を作れないリポジトリ**では、ブランチ切り替えの検知がウィンドウのフォーカス復帰まで遅れる（[#14](https://github.com/bbtit/sidediff/issues/14) のトレードオフ）
- **64MB 超の diff** は未検証。型付きエラーと文言の経路で担保している（[#16](https://github.com/bbtit/sidediff/issues/16)）
- **`index.lock` の実競合**は再現していない。`--no-optional-locks` の付与で担保（[#15](https://github.com/bbtit/sidediff/issues/15)）

---

## 5. P2（MVP 外）

要件に定義済みで、MVP から意図的に外したもの。着手するならこの順に価値が高い。

1. **GitHub PR 連携**（§13）— PR URL からレビュー開始。GitHub 依存は分離したまま入れる
2. **Review comments**（§14）— 行コメントと PR への投稿

**Inline Old Code（§12）は作らないことにした**（2026-09-20 / [`decisions.md`](./decisions.md) D26）。
旧コードは hover で全文見えており、それで足りるという判断。
stable API ではエディタに行を増やせず、作れるのは行内に重ねる代替だけで、それは hover と役割が重なる。

AI レビューは非目標（§15）。この製品の価値は、人間が codebase の文脈を持ったままレビューできることにある。
