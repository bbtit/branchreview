# SideDiff 手動テスト手順

要件 [`requirements.md`](./requirements.md) §20 のエッジケースと §25 の受け入れ条件を、実際の VS Code 上で確認するための手順。
自動テストは Node 上の Vitest（fake `vscode`）で動くため、**Extension Host の実挙動はここで確認する**。

決定の正本は [`decisions.md`](./decisions.md)。コマンドはすべて `SideDiff: …`。

## 準備

任意の場所で以下を実行し、検証用リポジトリを作る。

```sh
mkdir sidediff-manual && cd sidediff-manual
git init -b main
git config user.email you@example.com
git config user.name "You"

printf 'keep1\nkeep2\nkeep3\n' > keep.txt
printf 'gone1\ngone2\n' > del.txt
printf 'ren1\nren2\nren3\n' > ren-old.txt
printf '\x00\x01\x02\x03' > logo.bin
git add -A && git commit -m base

git checkout -b feature/demo
printf 'added1\nadded2\nadded3\n' > added.txt      # A
rm del.txt                                          # D
git mv ren-old.txt ren-new.txt
printf 'ren1\nCHANGED\nren3\n' > ren-new.txt        # R + 変更
printf 'keep1\nKEEP-CHANGED\nkeep3\n' > keep.txt    # M
printf '\x09\x09\x09\x09\x09' > logo.bin            # binary M
git add -A && git commit -m feature

printf 'not tracked\n' > untracked.txt              # untracked（レビュー対象外）
printf 'keep1\nKEEP-CHANGED\nkeep3\nLOCAL EDIT\n' > keep.txt  # dirty（未 commit）
```

VS Code でこのフォルダを開き、`F5`（拡張の開発ホスト）または拡張をインストールした状態で以下を実行する。

1. コマンドパレット → `SideDiff: Set Base` → `main` を選ぶ
2. ステータスバーが `SideDiff: main · local changes` になる

## ケース別の確認

### 1. Added（追加ファイル）

- `added.txt` を開く
- **期待**: 通常のエディタで開く。1〜3行目すべてに追加の gutter マークが出る
- Changes ツリーに `A added.txt` が出る

### 2. Deleted（削除ファイル）— D12

- Changes ツリーに `D del.txt` が出る
- `D del.txt` をクリックする
- **期待**: エディタも Diff Editor も開かない。`SideDiff: del.txt was deleted on this branch.` という情報メッセージのみ

### 3. Renamed（リネーム）

- Changes ツリーの `R ren-new.txt`（説明に `ren-old.txt →`）をクリック
- **期待**: 新しいパス `ren-new.txt` が通常のエディタで開き、2行目に変更の gutter マークが出る

### 4. Binary（バイナリ）

- Changes ツリーに `logo.bin` が `binary` という説明付きで出る
- クリックする
- **期待**: VS Code の標準的なバイナリ表示になる。**例外やエラー通知が出ない**。gutter マークは付かない

### 5. Dirty working tree — D2 / D11

- `keep.txt` を開く（4行目に未 commit の `LOCAL EDIT` がある）
- **期待**:
  - gutter は `main...HEAD` のまま。変更マークは2行目だけで、4行目には付かない
  - ステータスバーに `· local changes` が出る
  - ツールチップに `Working tree has local changes (gutter stays base…HEAD)` が出る
- さらに `keep.txt` を編集して保存する
- **期待**: gutter の対象は変わらない（未 commit の変更は混ざらない）

### 6. Untracked（未追跡）

- **期待**: `untracked.txt` は Changes ツリーに出ない。開いても gutter マークは付かない

### 7. Diff Editor を開く導線が無いこと（回帰）

- Changes ツリーのどの行をクリックしても、左右分割の Diff Editor が開かない
- `SideDiff:` で始まるコマンド一覧に、Diff Editor を開くものが無い
- **期待**: レビュー導線は常に通常のエディタ

### 8. Next / Previous Change（D7）

- `Alt+]` / `Alt+[`（Mac も同じ）を押す
- **期待**: 変更箇所をファイルを跨いで移動する。末尾の次は先頭に戻る。削除ファイルには移動しない

### 9. HEAD 追従（D13）と自動 Stop（D5）

- レビュー中に `git commit --allow-empty -m more` を実行する
- **期待**: 手動リフレッシュなしで Changes ツリーと gutter が新しい HEAD 基準になる
- `git checkout main` を実行する
- **期待**: `SideDiff: stopped after branch change …` が出て overlay が止まり、gutter が消える。base の記憶は残るので `SideDiff: Resume Review` で再開できる

### 10. 大きな diff（MVP-10c）

- 20万行規模のファイルを1コミットで追加したブランチを base と比較する
- **期待**: 通常どおり gutter と Changes ツリーが出る（64MB までは読む）
- 64MB を超える場合、`SideDiff: could not load …` のエラーと、Changes ツリーの `Could not load changes` 行が出る（「No changes」とは出ない）

## 後片付け

```sh
cd .. && rm -rf sidediff-manual
```
