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

### 9. HEAD 追従（D13）

同じブランチで HEAD が進んだとき、手動リフレッシュなしで `base...HEAD` を取り直すことを確認する。
**差分の内容が変わるコミット**でないと画面上は何も変わらないので、必ず中身を変えて commit する。
（`--allow-empty` や `base...HEAD` の結果が同じになるコミットでは、再取得は走るが表示は変わらないため確認にならない。）

- `added.txt` を開いたままにする。この時点で gutter マークは 1〜3 行目、Changes ツリーの説明は `+3`
- ターミナルで4行目を足して commit する（`keep.txt` の未 commit 変更はケース5で使うので巻き込まない）

  ```sh
  printf 'added1\nadded2\nadded3\nadded4\n' > added.txt
  git add added.txt && git commit -m "more"
  ```

- **期待**: 操作しなくても数百 ms 以内に、gutter マークが 4 行目まで伸び、Changes ツリーの説明が `+4` になる
- 変形として `git commit --amend -m "amended"` や `git pull` でも、差分が変われば同じように追従する

### 10. 自動 Stop（D5）と再開

- レビュー中に `git checkout main` を実行する
- **期待**: `SideDiff: stopped after branch change …` が出て overlay が止まり、gutter が消える。ステータスバーは `SideDiff: off`
- `git checkout feature/demo` に戻して `SideDiff: Resume Review` を実行する
- **期待**: base の記憶（`main`）が残っているので、base を選び直さずにレビューが再開し、gutter が戻る

### 11. 大きな diff（MVP-10c）

- 20万行規模のファイルを1コミットで追加したブランチを base と比較する
- **期待**: 通常どおり gutter と Changes ツリーが出る（64MB までは読む）
- 64MB を超える場合、`SideDiff: could not load …` のエラーと、Changes ツリーの `Could not load changes` 行が出る（「No changes」とは出ない）

### 12. 空白・非 ASCII・`"` を含むファイル名（#17）

自動テストは `tests/edge-cases.test.ts` で通っているが、**実 VS Code での確認はこのケースで行う**。
上の検証用リポジトリとは別に、名前だけを問題にする小さなリポジトリを作る。

```sh
mkdir sidediff-names && cd sidediff-names
git init -b main
git config user.email you@example.com
git config user.name "You"

printf 'l1\nl2\n' > "sp ace.txt"
printf 'l1\nl2\n' > "日本語.txt"
printf 'l1\nl2\n' > 'qu"ote.txt'
printf 'keep1\nkeep2\nkeep3\n' > "旧 name.txt"
printf 'gone\n' > "削除 file.txt"
printf '\x00\x01\x02\x03' > "画像.bin"
git add -A && git commit -m base

git checkout -b feature/names
printf 'l1\nCHANGED\n' > "sp ace.txt"
printf 'l1\nCHANGED\n' > "日本語.txt"
printf 'l1\nCHANGED\n' > 'qu"ote.txt'
git mv "旧 name.txt" "新 name.txt"        # 中身は変えない → R 判定
rm "削除 file.txt"
printf 'new1\nnew2\n' > "追加 file.txt"
printf '\x09\x09\x09\x09\x09' > "画像.bin"
git add -A && git commit -m names
```

このフォルダを VS Code で開き、`SideDiff: Set Base` → `main` を選ぶ。

- **期待（Changes ツリー）**: 表示名が実ファイル名と一致し、`"\346\227\245..."` のような化け方をしない

  | 行                | 説明            |
  | ----------------- | --------------- |
  | `M sp ace.txt`    | `+1 -1`         |
  | `M 日本語.txt`    | `+1 -1`         |
  | `M qu"ote.txt`    | `+1 -1`         |
  | `A 追加 file.txt` | `+2`            |
  | `D 削除 file.txt` | `-1`            |
  | `M 画像.bin`      | `binary`        |
  | `R 新 name.txt`   | `旧 name.txt →` |

- `sp ace.txt` / `日本語.txt` / `qu"ote.txt` をそれぞれ開く
- **期待**: どれも2行目に変更の gutter マークが出て、hover に旧行 `l2` が出る（`#17` 以前はマークが1つも出なかった）
- `R 新 name.txt` をクリック → 新しいパスで通常のエディタが開く
- `D 削除 file.txt` をクリック → 情報メッセージのみ

## 後片付け

```sh
cd .. && rm -rf sidediff-manual sidediff-names
```
