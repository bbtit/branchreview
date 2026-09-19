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

## 2. 既知の不具合 — 最優先

### 2.1 空白・非 ASCII を含むファイル名で gutter が出ない

issue: [#17](https://github.com/bbtit/sidediff/issues/17)（再現手順・原因・終了条件はそちら）

MVP-11 のエッジケース検証に **入っていなかった穴**。日本語のファイル名は日常的に出るため、実用上の影響が大きい。

実測（2026-09-20、`main` = `9aac40d` 時点）:

| ファイル名   | Changes ツリー                                        | hunks | gutter / hover / ± |
| ------------ | ----------------------------------------------------- | ----: | ------------------ |
| `plain.txt`  | 正常                                                  |     1 | 出る               |
| `sp ace.txt` | 名前は正しい                                          |     0 | **出ない**         |
| `日本語.txt` | `"\346\227\245\346\234\254\350\252\236.txt"` と化ける |     0 | **出ない**         |

原因は2つ:

1. `+++ b/sp ace.txt<TAB>` — git は空白を含むパスの `---` / `+++` 行に行末タブを付ける。
   これを含めたままパスにしているため、hunk がどのファイルにも紐づかない
   （`src/diff/parseUnifiedDiff.ts` の `pathFromPlusMinusLine`）
2. git は既定（`core.quotepath=true`）で非 ASCII パスを C 形式（`"\346..."`）でクォートして出す。
   raw のステータス行・patch のどちらもクォートを解除していない
   （`src/diff/parseDiffStatus.ts` / `src/diff/parseUnifiedDiff.ts`）

対応案:

- `git -c core.quotepath=false diff …` を使い、非 ASCII のクォートを避ける
- `--raw -z`（NUL 区切り）でパス一覧を確実に取り、そのパス一覧を正として patch の各セクションを対応づける
- `---` / `+++` 行の行末タブを落とす。C 形式クォート（`"…"` + 8進エスケープ）の解除も実装する
- 終了条件には「空白入り・日本語・`"` を含む名前で gutter / hover / ± が出る」を入れる

### 2.2 multi-root の同時レビュー

2つ以上のリポジトリで同時に overlay を ON にする経路は、自動テスト（`tests/diff-pipeline.test.ts` のキャッシュ分離）では見ているが、
実 VS Code での手動確認をしていない。`manual-tests.md` にケースを追加する。

---

## 3. リリース準備（未着手）

公開を目指すなら、いずれも MVP とは別に必要になる。

- **LICENSE ファイルが無い**。`package.json` は MIT を宣言しているので実体を置く
- **README が開発者向け**。Marketplace 用の説明（何が嬉しいか、GIF、キーバインド、コマンド一覧）が無い
- **`.vscodeignore` が無い** → `docs/` `tests/` などが VSIX に同梱される
- `package.json`: `icon` 未設定、`version` は `0.0.1` のまま、`categories` は `Other` のみ
- 公開手順（`vsce` / `ovsx`）を決めて `decisions.md` に残す（D21 のツール方針と整合させる）
- **CI が無い**（`.github/` なし）。push / PR で `vp check` + `vp test` + `vp build` を回す

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

1. **Inline Old Code**（§12）— 変更箇所に旧コードを展開する。hover の次の一手
2. **GitHub PR 連携**（§13）— PR URL からレビュー開始。GitHub 依存は分離したまま入れる
3. **Review comments**（§14）— 行コメントと PR への投稿

AI レビューは非目標（§15）。この製品の価値は、人間が codebase の文脈を持ったままレビューできることにある。
