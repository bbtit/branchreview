# SideDiff

_English: [README.md](./README.md)_

**差分はメタデータであって、文書ではない。**

SideDiff は、レビュー対象のブランチを普通のエディタで開いたまま、差分を gutter のマークと hover として重ねる VS Code 拡張です。左右に並ぶ Diff Editor は開きません。

「使い方」の 1〜5 を順に読めば、ひととおり操作できます。その先のコマンド表や制約は、必要になったときに引いてください。

## Diff Editor では、コードベースに質問できない

Diff Editor に映っているのは 2 列のテキストで、あなたのプロジェクトではありません。だから、いま書き換えられた関数を誰が呼んでいるのか、40 行目の変数がどの型なのかを、その画面では確かめられません。読んでいる対象が、実体から切り離されたスナップショットだからです。

SideDiff はここを裏返します。読むのは実際のプロジェクトにある実際のファイルで、差分はその上に重なるメタデータです。レビューの最中も、定義へ飛び、参照を探し、リネームし、テストを走らせられます。

## 使い方

### 1. base を選ぶとレビューが始まる

レビューしたいブランチを checkout してから、コマンドパレット（`Ctrl+Shift+P`、macOS は `Cmd+Shift+P`）で **`SideDiff: Set Base`** を実行し、比較相手を選びます。ふつうは `main` や `origin/main` ですが、タグでもコミットでも構いません。

準備はこれだけです。ステータスバーの表示が `SideDiff: off` から `SideDiff: main` に変わります。

### 2. gutter のマークが変更行を示す

あとはいつもどおりファイルを開くだけです。変更のある行には、gutter にマークが付きます。

| マーク | 意味                                                             |
| ------ | ---------------------------------------------------------------- |
| 追加   | このブランチで足された行                                         |
| 変更   | このブランチで書き換えられた行                                   |
| 削除   | このブランチで消された行。マークは消えた位置の隣、残った行に付く |

**マークにマウスを載せると**、その hunk が diff として出ます。書き換えられる前の行も、消された行も、ここで全文を読めます。ファイルの中身には何も挿入しません。

### 3. `Alt+]` で次の変更へ飛ぶ

`Alt+]` で次の変更、`Alt+[` で前の変更に移動します。移動は**ファイルをまたぎます**。最後の変更まで行くと先頭に戻ります。まだ開いていないファイルへ飛んだときは、そのファイルが普通に開きます。

アクティビティバーの **SideDiff → Changes** には、変更されたファイルが `+n -n` 付きで並びます。クリックすれば、そのファイルが開きます。

### 4. 読み終えたファイルに印を付ける

Changes ビューでファイルを右クリックし、**Mark as Reviewed** を選ぶと ✓ が付き、進捗の行が増えます（`3 / 12 files reviewed`）。

進捗はリポジトリ・base・ブランチの組ごとに覚えています。同じブランチに新しいコミットが載っても、読み終えた印は消えません。

### 5. 中断しても base は残る

**`SideDiff: Stop Review`** で overlay を止めます。base は覚えたままなので、**`Resume Review`** で続きから再開できます。ウィンドウを再読み込みしたあとでも同じです。base ごと捨てるときは **`Clear Base`** を使います。このときは進捗も一緒に消えます。

レビュー中、ステータスバーには `SideDiff: <base>` が出ます。作業ツリーに未コミットの変更があるときは、末尾に `· local changes` が付きます。gutter が映しているのがコミット範囲であって手元の編集ではないことを、ここで区別できます。

## コマンド

| コマンド                                                  | 何をするか                                              |
| --------------------------------------------------------- | ------------------------------------------------------- |
| `SideDiff: Set Base`                                      | 比較相手を選んでレビューを始める                        |
| `SideDiff: Resume Review`                                 | 覚えている base でレビューを再開する                    |
| `SideDiff: Stop Review`                                   | overlay を止める。base は残す                           |
| `SideDiff: Clear Base`                                    | base と進捗を捨てる                                     |
| `SideDiff: Next Change` / `Previous Change`               | ファイルをまたいで次 / 前の変更へ移動する               |
| `SideDiff: Mark as Reviewed` / `Mark as Unreviewed`       | Changes ビューでファイルの既読・未読を切り替える        |
| `SideDiff: Clear All Review Progress for This Repository` | このリポジトリの進捗を全 base・全ブランチ分まとめて消す |
| `SideDiff: Show Git Context`                              | リポジトリの root・ブランチ・HEAD を表示する（調査用）  |

## キーバインド

| ショートカット              | コマンド        |
| --------------------------- | --------------- |
| `Alt+]`（macOS `Option+]`） | Next Change     |
| `Alt+[`（macOS `Option+[`） | Previous Change |

## 引っかかりやすいところ

- **未コミットの変更はレビューに入りません。** gutter は常に `base...HEAD` を映します。手元の編集は混ぜずに、ステータスバーで知らせます
- **削除されたファイルは開きません。** Changes ビューには出ますが、開く先のファイルがもう存在しないためです
- **バイナリファイルに gutter は付きません。** 一覧には `binary` と出ます
- **detached HEAD ではレビューを始められません。** 先にブランチを checkout してください
- レビュー中にブランチを切り替えると、overlay は自動で止まります。base は残るので `Resume Review` で戻れます

## 動作環境

- VS Code 1.96 以降
- `git` に PATH が通っていること

## 開発

```bash
pnpm install
pnpm check   # oxlint + oxfmt + 型チェック
pnpm test    # vitest
pnpm build   # dist/extension.cjs にバンドル
```

**F5** で Extension Development Host が起動します。ツールチェーンは [Vite+](https://viteplus.dev/)（`vp`）で、ESLint・Prettier・Jest・webpack は意図的に使っていません。

- [`docs/requirements.md`](./docs/requirements.md)：要件
- [`docs/decisions.md`](./docs/decisions.md)：実装上の決定と、その理由
- [`docs/research-vscode-apis.md`](./docs/research-vscode-apis.md)：設計の土台にした VS Code API 調査
- [`docs/manual-tests.md`](./docs/manual-tests.md)：手動テストの手順
- [`docs/next-steps.md`](./docs/next-steps.md)：残っている作業

## 困ったときは

動かない、挙動がおかしい、こういう機能が欲しい。どれも [GitHub issues](https://github.com/bbtit/sidediff/issues) で受け付けています。

## ライセンス

[MIT](./LICENSE)
