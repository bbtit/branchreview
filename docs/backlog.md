# SideDiff MVP Backlog

アジャイル運用: **同時 In Progress は1つ。番号順に消化。**  
各 issue に **前提条件** と **終了条件** がある。終了条件を満たすまで次へ進まない。  
パッケージマネージャは **pnpm**（`docs/decisions.md` D20。npm は使わない）。

- Epic: https://github.com/bbtit/sidediff/issues/13
- Milestone: https://github.com/bbtit/sidediff/milestone/1
- 要件: [`requirements.md`](./requirements.md)
- 決定: [`decisions.md`](./decisions.md)

## 実行順

| Order | Issue | 価値（なぜ今か） |
|------:|-------|------------------|
| 1 | [#1 MVP-01](https://github.com/bbtit/sidediff/issues/1) Scaffold | 拡張が動く土台 |
| 2 | [#2 MVP-02](https://github.com/bbtit/sidediff/issues/2) Git context | 対象 repo の確定 |
| 3 | [#3 MVP-03](https://github.com/bbtit/sidediff/issues/3) Review session | ON/OFF・base がデモ可能 |
| 4 | [#4 MVP-04](https://github.com/bbtit/sidediff/issues/4) Diff pipeline | UI 非依存の差分モデル |
| 5 | [#5 MVP-05](https://github.com/bbtit/sidediff/issues/5) Gutter | **核心: diff = metadata** |
| 6 | [#6 MVP-06](https://github.com/bbtit/sidediff/issues/6) Navigation | 変更を辿れる |
| 7 | [#7 MVP-07](https://github.com/bbtit/sidediff/issues/7) Hover / overview | 必要なときだけ旧diff |
| 8 | [#8 MVP-08](https://github.com/bbtit/sidediff/issues/8) Tree View | 変更ファイルの俯瞰 |
| 9 | [#9 MVP-09](https://github.com/bbtit/sidediff/issues/9) Review status | 進捗の永続 |
| 10 | [#10 MVP-10](https://github.com/bbtit/sidediff/issues/10) Live sync | HEAD 追従・性能 |
| 11 | [#11 MVP-11](https://github.com/bbtit/sidediff/issues/11) Edge cases | §20 の穴埋め |
| 12 | [#12 MVP-12](https://github.com/bbtit/sidediff/issues/12) Acceptance | §25 合格で MVP 完了 |

## WIP / DoD

1. 前提条件の issue が **Closed** であること
2. その ticket の終了条件チェックリストをすべて満たすこと
3. Diff Editor をレビュー導線に使っていないこと
4. 決定変更があれば先に `decisions.md` を更新すること
5. P2（GitHub PR / comments / inline old code / AI）はこのバックログに混ぜない
