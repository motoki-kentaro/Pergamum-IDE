<p align="center">
  <img src="assets/logo/logo-mono.svg" alt="Pergamum" width="457">
</p>

<h1 align="center">Pergamum</h1>

<p align="center"><strong>IDE for novelists</strong></p>

[![CI](https://img.shields.io/github/actions/workflow/status/motoki-kentaro/Pergamum-IDE/ci.yml?branch=main&label=CI)](https://github.com/motoki-kentaro/Pergamum-IDE/actions/workflows/ci.yml) [![Version v0.90.1](https://img.shields.io/badge/version-v0.90.1-blue)](https://github.com/motoki-kentaro/Pergamum-IDE/releases/tag/v0.90.1) [![License MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE) [![Electron 44](https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white)](./package.json) [![Node.js 24](https://img.shields.io/badge/Node.js-24-5FA04E?logo=nodedotjs&logoColor=white)](./package.json) [![TypeScript 7](https://img.shields.io/badge/TypeScript-7-3178C6?logo=typescript&logoColor=white)](./package.json)

[日本語](./README.md) | [English](./README.en.md)

## Pergamumとは

Pergamum（ペルガモン）は、**小説を書く人のためのオープンソース統合執筆環境**です。本文の編集、作品の人物や用語の管理、検索、プレビュー、出力を、ひとつのプロジェクトにまとめます。MIT ライセンスのフリーソフトウェアです。

<p align="center">
  <img src="docs/manual/assets/main_image.png" alt="Pergamumの執筆画面" width="1000">
</p>

## for novelist

長い物語では、人物名、別称、地名、設定など、本文とは別に覚えておきたいことが増えていきます。Pergamum は、**本文を書く場所と、作品世界について作者が知っていることを管理する場所を分け、その両方をひとつの執筆環境として扱います**。

原稿本文の正本は、自分のPCに保存する通常の Markdown / TXT ファイルです。人物・用語などの構造化された作品情報は、SQLite の `.pergamum` プロジェクトファイルに保存します。他のテキストエディタでも原稿を読めること、本文をデータベースの都合に合わせないことを大切にしています。

目指すのは、作者の代わりに小説を書くことではなく、**作者が既に決めたことを忘れないための道具**です。本文を勝手に書き換えず、表記の変更や補完は作者が選んだ操作・設定に従います。

書くことに集中しながら、原稿は自分の手元に。使い始めるために、作品を特定のサービスへ預ける必要はありません。

- **完全無料 / [MIT License](./LICENSE)**
- **アカウント登録不要**
- **クラウド機能なし**
- **原稿ファイルを外部サービスへ送信しません**
- **AIによる執筆・文章生成・添削機能なし**
- **Windows版のインストールにPCの管理者権限は不要**
- 原稿は通常の **Markdown / TXT ファイル**として手元に残ります。Pergamumを使わなくなっても、他のテキストエディタで開けます。

Pergamum は生成AIを活用して開発されていますが、製品自体にAIによる執筆・文章生成・添削機能はありません。物語を考え、言葉を選ぶのは作者です。

## for Engineer

小説の執筆だけでなく、技術メモや設計ノートにも。文章に図・数式・コードを添えて、考えをひとつの Markdown 文書にまとめられます。

- **GitHub Alerts（コールアウト）対応** — 補足や注意点を、本文と区別して読みやすく表示できます。
- **Mermaid記法対応** — 図やフローチャートをテキストで記述できます。
- **KaTeX記法対応** — 数式を記述・表示できます。
- **シンタックスハイライト対応** — コードブロックを言語に応じて色分け表示できます。

Markdown の横書きプレビューで、書いた内容の表示を確認しながら整理できます。検索やプロジェクト管理も、関連するメモをまとめて扱うのに役立ちます。

## v0.90.1 — BETA

小説 IDE としての中核機能がひととおり揃い、**v0.90.1 BETA を最初の公開リリースとして提供しています**。Windows 向けには NSIS インストーラーを配布しています。

ここからは実際に使ってもらい、不具合・使いにくい点・追加要望を集めていきます。

まだ安定版の 1.0 ではありません。1.0 まではプロジェクト DB の schema や互換性に破壊的変更が入る可能性があります。重要な原稿・作品情報は、作品フォルダ全体を Git や通常のバックアップでも保護してください。

## 現在できること

| 分野 | できること |
| --- | --- |
| 原稿の編集 | Markdown（`.md`）と平文（`.txt`）のタブ編集・保存。プロジェクト設定で対応形式を選択でき、`.txt` は UTF-8、Shift_JIS（CP932）、EUC-JP、ISO-2022-JP、UTF-16 などの文字コードに対応します。 |
| プロジェクトとファイル | `.pergamum` で作品を管理し、File Explorer でファイル・フォルダを作成、移動、名前変更、削除。起動時や実行中に渡されたプロジェクト・Markdown を適切なウィンドウへ開き、必要に応じて別プロセスを起動します。 |
| 検索と移動 | 文書内・プロジェクト全体の検索／置換、正規表現、Glossary を使った検索。Quick Open、見出しジャンプ、Command Palette でファイルや操作へ移動できます。 |
| Glossary（語彙集） | 人物・地名・用語、別称、タグ、Description（説明文）の管理。Hover Card、候補を選ぶ補完、本文中の使用箇所への移動で、執筆中に作品情報を参照できます。 |
| プレビュー | Markdown／青空文庫形式の表示、ルビ・傍点、callout、画像。エディタとプレビューの双方向スクロール同期で、書く位置と読む位置を合わせられます。 |
| 文書の俯瞰と統計 | Document Map から本文へ移動し、マップを PNG 出力。Document Metrics で文字数、原稿用紙換算、会話文比率、語彙の出現回数などを確認できます。 |
| エクスポート | 対象の原稿と順序を確認して TXT（UTF-8）、HTML、PDF へ出力。PDF は横書き・縦書きに対応します。 |
| 作業の再開と復旧 | Session restore、未保存本文の Recovery、ファイルを一時書き込み後に置き換える atomic save、同じプロジェクトへの同時書き込みを防ぐ write lock を備えます。 |
| 画像と assets | 画像の貼り付け・保存、画像ビューアー、壊れた画像リンクの診断、ファイル移動に伴う画像リンク・参照の更新を支援します。 |
| 自分に合う操作と表示 | Markdown ツールバー、変更可能なショートカット、アプリ／プロジェクト設定、ライト／ダークを含むテーマ。Tab のフォーカス移動と、インデント／アウトデント操作を使い分けられます。 |

`.txt` の直接編集はプロジェクト設定で有効にします。Markdown 専用のプレビューや見出しジャンプは `.txt` には適用されません。具体的な使い方は [User Manual](https://pergamum-ide.github.io/ja/) を参照してください。

## 安全性とデータモデル

| 保存先 | 役割 |
| --- | --- |
| Markdown ファイル | 原稿本文の正本。通常の人間可読なテキストです。平文で書く場合は `.txt` を使えます。 |
| `.pergamum`（SQLite） | 人物・用語など、構造化された作品情報の正本。プロジェクトを開く入口でもあります。 |
| `pergamum.json` | プロジェクト設定。 |
| アプリケーションデータ内の Session / Recovery | 前回の作業環境と、未保存本文の作業コピー。 |

Session は開いていたタブなどの作業環境を戻し、Recovery は未保存本文を復旧候補として保持します。復元時は元の原稿を直接上書きせず、別ファイルとして開きます。**Recovery は履歴管理や Git、バックアップの代わりではありません。**

保存・復旧の使い方は [User Manual](https://pergamum-ide.github.io/ja/)、Glossary のモデルや永続化・復旧の設計は [ADR 一覧](./docs/adr/README.md) にまとめています。ADR には将来の設計も含まれるため、採用状態と実装状況は区別してください。

## インストールと開発

### Windows

Windows 向けには、**NSIS インストーラー**を提供しています。**インストールにPCの管理者権限は不要です。**

インストーラーから Pergamum を導入でき、`.pergamum` ファイルを Pergamum で開くためのファイル関連付けにも対応しています。

**[Pergamum v0.90.1 BETA を GitHub Releases からダウンロード](https://github.com/motoki-kentaro/Pergamum-IDE/releases/tag/v0.90.1)**

### macOS / Linux

現時点では、macOS / Linux 向けの公式ビルドは配布していません。

Windows 以外の環境で Pergamum を利用する場合は、お手数ですがソースコードからビルドしてください。

### ソースコードから起動する

開発およびソースコードからの実行には **Node.js 24**（`>=24 <25`）を使用します。

```bash
git clone https://github.com/motoki-kentaro/Pergamum-IDE.git
cd Pergamum-IDE
npm ci
npm run dev
```

### 検証とパッケージ作成

TypeScript の型チェック、テスト、アプリケーションのパッケージ作成は以下で実行できます。

```bash
npm run typecheck
npm test
npm run build
```

Windows 向け NSIS インストーラーを生成する場合:

```bash
npm run build:installer
```

生成されたインストーラーは `dist-installer/` に出力されます。

## フィードバック・追加要望

Pergamum は、機能を積み上げる段階から、**実際に使ったフィードバックを集める段階**に入りました。BETA を試して感じた不具合、使いにくい点、「こんな機能があったら」を [GitHub Issues](https://github.com/motoki-kentaro/Pergamum-IDE/issues) にお寄せください。

不具合の報告には、利用バージョン・OS・再現手順・期待した動作があると調査しやすくなります。追加要望では、執筆のどんな場面で困っているかを教えてください。非公開の原稿を添付する必要はありません。

## マニュアルと開発の道しるべ

- [User Manual（日本語）](https://pergamum-ide.github.io/ja/) — 初めての原稿作成から代表的な機能まで。
- [User Manual（English）](https://pergamum-ide.github.io/en/) — 英語版は現在準備中の placeholder です。
- [Roadmap](./docs/roadmap.md) — 今後の方向性と検討事項。実装範囲は個々の Issues で管理します。
- [ADR](./docs/adr/README.md) — 設計上の判断とその理由。
- [GitHub Issues](https://github.com/motoki-kentaro/Pergamum-IDE/issues) — 不具合・要望・開発項目。

## 現在の制限

- BETA であり、Windows を中心に開発・配布しています。他 OS で同等の動作・配布は保証していません。
- 1.0 まではプロジェクト DB の長期互換性を保証しません。原稿と構造化データの両方をバックアップしてください。
- DOCX／EPUB 出力、クラウド同期・共同編集は未実装です。
- PDF 出力のフォントやレイアウトは環境・原稿に左右されます。出力時の警告を確認し、配布前に成果物を確認してください。

## ライセンスとサードパーティ

Pergamum は [MIT License](./LICENSE) で公開しています。

同梱する依存パッケージと Electron のライセンスは [THIRD_PARTY_LICENSES.md](./THIRD_PARTY_LICENSES.md)、アイコン・効果音などの帰属表示とライセンスは [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) を参照してください。

## Pergamumの由来

Pergamum（Πέργαμον）とは、かつて小アジア（現在のトルコ西部）に栄えた古代ギリシアの都市の名前です。アレクサンドリア図書館に匹敵する大図書館を擁し、羊皮紙（パーチメント / Parchment）の語源にもなりました。本プロダクト名はそこから引用したものです。
