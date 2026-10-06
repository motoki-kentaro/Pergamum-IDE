# ![Pergamum](assets/logo-mono.svg)

日本語 | [English](index.en.html)  

**IDE for novelists**

## 物語を書くための、統合執筆環境。

Pergamum（ペルガモン）は、小説を書く人のためのオープンソース統合執筆環境です。

本文を書く。  
人物や地名、用語を整理する。  
長い原稿の中を探す。  
プレビューして、作品として出力する。

長い物語を書くために必要な道具を、ひとつのプロジェクトにまとめます。

**[Windows版をダウンロード](https://github.com/Pergamum-IDE/Pergamum-IDE/releases/latest)**  
[日本語マニュアル](./ja/) · [GitHub](https://github.com/Pergamum-IDE/Pergamum-IDE)

**無料・オープンソース（MIT License）**
v0.90.0 BETA / Windows版公開中

---

![メイン画面](assets/main_image.png)

---

# 小説は、本文だけではできていない。

物語が長くなるほど、覚えておきたいことも増えていきます。

人物の名前と別称。
地名。組織。設定。
「あの人物、最後にどこで出てきたっけ？」
「あの設定、どの章で書いたっけ？」

Pergamumは、**本文を書く場所**と、**作品世界について作者が知っていることを管理する場所**を分け、その両方をひとつの執筆環境として扱います。

---

# 書く

MarkdownまたはPlain Textで、そのまま原稿を書けます。

複数の章をタブで開き、検索・置換、Command Palette、Markdownツールバーなどを使いながら執筆できます。

Markdownプレビューでは、ルビ・傍点・画像などを確認できます。エディタとプレビューはスクロール位置を同期できます。

![プレビュー](assets/preview.gif)

---

# 覚える

人物、地名、組織、用語。

作品の中で覚えておきたい情報は、 **Glossary（語彙集）** として本文とは別に管理できます。

表記だけでなく、別称、タグ、説明を登録できます。

本文中では登録した語彙を補完したり、その場で説明を確認したり、どこで使われているかを辿ったりできます。

![用語集](assets/glossary.gif)

---

# 見渡す

長い原稿では、「書く」ことと同じくらい「どこに何があるか」が重要になります。

Pergamumには、文書全体を俯瞰する **Document Map** があります。

文字数、原稿用紙換算、会話文比率、登録した語彙の出現回数などを確認する **Document Metrics** も利用できます。

作品全体を横断する検索や、ファイル・見出し・語彙へのQuick Openにも対応しています。

![文書統計](assets/document_metric.gif)

---

# 届ける

書き終えた原稿は、プロジェクト内の複数ファイルから必要なものを選び、順番を整えてまとめて出力できます。

現在、TXT（UTF-8）、HTML、PDFに対応しています。

PDFは横書き・縦書きの両方を選択できます。

![エクスポート](assets/export_diet.gif)

---

# あなたの原稿を、Pergamumの中に閉じ込めません。

Pergamumで書いた本文の正本は、通常の **Markdown（.md）またはPlain Text（.txt）ファイル** です。

Pergamumを使わなくても、一般的なテキストエディタで読むことができます。

人物や用語などの構造化された作品情報は `.pergamum` に、プロジェクト設定は `pergamum.json` に保存します。

原稿そのものを、独自形式の中だけに閉じ込めないことを大切にしています。

---

# 物語を書くのは、あなたです。

Pergamumは、作者の代わりに小説を書くためのAI執筆ツールではありません。

作者が決めた人物や設定を覚えておく。  
必要な原稿へすぐ移動する。  
長くなった物語を見渡す。  
書いたものを安全に保存し、必要な形へ出力する。

**作者がすでに決めたことを忘れないための道具**でありたいと考えています。

---

# Pergamum v0.90.0 BETA

小説IDEとしての中核機能がひととおり揃い、v0.90.0 BETAを最初の公開リリースとして提供しています。

現在、Windows向けインストーラーを公開しています。  
（署名がないため実行時に警告が出る場合があります）

**[Pergamumをダウンロード](https://github.com/Pergamum-IDE/Pergamum-IDE/releases/latest)**

[はじめての使い方を見る](./ja/)  
[ソースコードを見る](https://github.com/Pergamum-IDE/Pergamum-IDE)  
[不具合・要望を送る](https://tally.so/r/vGQ06X)  
[不具合・要望を送る@GitHub](https://github.com/Pergamum-IDE/Pergamum-IDE/issues)
> v0.90.0はBETA版です。1.0まではプロジェクトデータの互換性に破壊的変更が入る可能性があります。重要な作品は、作品フォルダ全体のバックアップをおすすめします。

---

**Pergamum — IDE for novelists**

MIT License / Open Source