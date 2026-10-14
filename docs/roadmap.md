# Pergamum ロードマップ

## この文書の目的

この文書は、Pergamum のこれまでの到達点、現在の開発状況、今後の開発方針を示す。

実装スコープの正本は GitHub Issue とする。個別の仕様・検証結果・設計判断は、Issue / PR / [ADR](./adr/README.md) を参照する。

Pergamum は、小説を書く人のための open-source IDE である。作者の本文を中心に置き、本文を勝手に書き換えない。本文を変更する補助機能はユーザーの明示的な操作として扱い、Export は提出用・閲覧用の派生物を生成する。

## 現在の開発状況

Pergamum は現在、Windows 向けの [BETA / Pre-release](https://github.com/Pergamum-IDE/Pergamum-IDE/releases) として公開している。NSIS インストーラーを提供しており、macOS / Linux 向けの公式ビルドは配布していない。

最新の公開バージョンと配布物は [GitHub Releases](https://github.com/Pergamum-IDE/Pergamum-IDE/releases) を参照する。

小説 IDE としての主要な執筆・参照・出力機能と、BETA 版を配布する基盤が成立した段階である。今後も実利用を通じて保守と品質改善を続ける。

公開版の機能・導入方法・制限は [README](../README.md)、操作方法は [ユーザーマニュアル](./manual/ja/README.md) を参照する。

## これまでの到達点

以下は、実装と main への取り込みを確認できた主要機能群の要約である。過去の全計画や、各 Phase の当初項目すべての完了を示すものではない。

Phase 番号は過去の開発経緯を示す補助情報として残す。機能は後続の開発でも拡張されており、Phase と公開バージョンを一対一には対応させない。

### 初期基盤

- Electron / React / CodeMirror による編集環境。
- プロジェクトと文書の管理、ファイル選択、複数タブでの編集。
- 構造化データの保存、Settings、表示言語切り替えの基盤。

初期基盤を Phase 1 の正式なスコープとして再定義しない。

### Glossary と執筆支援の基盤（Phase 2・3）

- Glossary の編集、本文との照合、Preview 上の装飾と Hover Card。
- 照合境界の制御と出現箇所への移動。
- Workbench / Utility Window、Debug logging の基盤。

その後、Glossary は tags による分類、補完、検索、説明文の編集・出力などへ拡張された。旧 kind モデルを前提とする将来案は、現在の実装予定として扱わない。

### デスクトップアプリと本文保護（Phase 4・5）

- プロジェクトファイル、設定、read-only handling、write lock、起動時のファイル受付。
- Windows installer とファイル関連付け、About dialog。
- 改行の保持・診断、文字数表示、明示的な段落字下げ command。
- 文書を開いていない zero-tab / Welcome 状態。
- 設定可能な不可視文字表示。

不可視文字表示は、かつて保留していたが、[PR #282](https://github.com/Pergamum-IDE/Pergamum-IDE/pull/282) で CodeMirror の独立した描画レイヤーを使う方式として実装された。

### Session と Document Recovery（Phase 6）

- Session の保存と、プロジェクト・タブ・選択中の文書などの復元。
- 未保存本文の Recovery payload 保持、復元候補の提示、復元・明示破棄。
- stale lock の回収と、復元失敗時の扱いの整備。

settings / session / recovery は別の責務として扱う。これらの到達点は、Project 全体の deterministic snapshot による復元や、将来のデータ互換性まで完成したという意味ではない。

### プロジェクト内のファイル操作（Phase 7）

- 階層 File Explorer と、文書への移動。
- ファイル・フォルダの作成、rename、確認付き delete、move。
- copy / cut / paste と、内部 D&D による Move / Copy / Cancel の選択。
- 移動に伴う Recovery のパス更新。

内部 D&D と copy の経緯は [PR #363](https://github.com/Pergamum-IDE/Pergamum-IDE/pull/363) を参照する。ファイル操作は Renderer から直接 filesystem を操作せず、Preload / Main Process の API を通す。

旧ロードマップにあった「watcher → debounce → re-scan」による外部変更検知は、今回実装を確認できていないため、完了項目には含めない。

### その後に拡充した執筆・表示・出力機能

- Project 全文検索・置換、文書内の Find / Replace、Quick Open、見出し移動。
- Document Map / Document Metrics、Markdown outline、画像の貼り付け・表示・移動時の参照更新。
- raw TXT の編集、ルビ・傍点、Markdown toolbar、Preview の表示改善。
- ショートカット設定、built-in color themes、設定値の JSON export。
- TXT / HTML / PDF の出力、日本語校正・Markdown syntax check。

PDF 出力には縦書きも含むが、フォントやレイアウトは環境・原稿に左右される。出力された成果物の確認は引き続き必要である。DOCX / EPUB 出力は未実装である。

### 配布と品質整備（Phase 8 に相当する到達点）

- Windows BETA 版の公開と、インストーラー・チェックサムの提供。
- README、ユーザーマニュアル、About・ライセンス情報への導線。
- Release workflow と、ビルド成果物を配布する工程の整備。
- エクスポート操作やダイアログなどの UI 改善。

これらは確認できた到達点である。Phase 8 の当初の品質チェック項目すべてや、packaged application 上の Recovery 検証すべてが完了したとは宣言しない。

## 継続的な保守と品質改善

今後は、実利用で見つかった問題とフィードバックを踏まえ、次の分野を継続的に改善する。

- 不具合修正。
- UI / UX の整合性とアクセシビリティ。
- 長い原稿や大きなプロジェクトでのパフォーマンス。
- 保存・Session 復元・Recovery の信頼性。
- データ互換性。
- ビルド・インストーラー・配布品質。

これらは開発の方向性であり、未作成の改善 Issue や実装期限を約束するものではない。具体的な作業は、必要性が明確になった段階で Issue の scope / non-scope / acceptance criteria と検証方針を定める。

自動テストや CI と、実際の packaged application を利用する dogfood は別の確認工程として扱う。保存・復元、native module、インストーラーなどは、変更内容に応じて実際の利用経路も確認する。

## 今後の方向性

### v0.91.0 の先へ

**次の開発フェーズ（Phase 9）は未定である。** 新機能やスケジュールを先に埋めることはしない。実際の利用とフィードバックから必要性が明確になった段階で、今後の優先順位を検討する。

過去の機能候補一覧やバージョン別計画は、この文書から整理した。一覧から除外したことは、機能の中止・却下を意味しない。過去の提案や判断は、関連 Issue と文書の Git 履歴を参照する。

例えば、外部ファイルの D&D Import は [Issue #339](https://github.com/Pergamum-IDE/Pergamum-IDE/issues/339) で Deferred とされている。内部 D&D の完成をもって外部 Import も完成したとは扱わず、再開は個別の判断による。

### v1.0.0 の考え方

v1.0.0 の検討では、大型新機能の追加を必須とせず、安定性・信頼性・保存とリカバリー・データ互換性・配布品質を重視する。

リリースの決定と日程は未定である。今回のロードマップ改訂では、確定したリリース条件やチェックリストを設けない。PO が正式に決定するまでは、v1.0.0 の公開を約束しない。

## フィードバックと貢献

不具合報告や改善提案は [GitHub Issues](https://github.com/Pergamum-IDE/Pergamum-IDE/issues) を通じて受け付け、今後の優先順位付けに活用する。

提案があることと、実装が決定していることは区別する。実利用での必要性、本文とデータの安全性、保守性を踏まえて検討し、着手する範囲は個別 Issue で定める。

この文書は、到達点・公開状況・開発方針が変わった際に更新する。
