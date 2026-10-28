# agent-desk

AIに開発を任せるときの、**進行状況と「人間の判断待ち」を1画面で見る**ダッシュボード。

![メモから公開まで進む様子](assets/readme/demo.gif)

**[デモを見る](https://agent-desk-ip1u.vercel.app/demo)**（ログイン不要。サンプルのデータで、右上の「再生 ▶」を押すと上のGIFと同じ動きが見られます）

## 何ができるか

### ホーム：あなたの番と、最近の出来事

全リポジトリのうち、AIが止まって人間の判断が要るものだけを、待っている時間が長い順に並べます。その場で「再開」「マージ」などを押せます。

![ホーム](assets/readme/home.png)

### リポジトリのページ：パイプラインの表

Issueごとに、清書 → 実装 → PR → CI → レビュー → 修正 → マージ → 公開 のどこまで進んだかを、1行で見られます。

![リポジトリのページ](assets/readme/repo.png)

### 設定：監視するリポジトリ・通知・アニメーション

![設定](assets/readme/settings.png)

### スマホでも

<img src="assets/readme/home-mobile.png" alt="スマホのホーム" width="320">

## どうやって作ったか

このアプリ自身も、[ai-dev-template](https://github.com/Gaku1205/ai-dev-template) の全自動パイプライン（メモを書く → AIが清書・実装・レビュー・修正・マージ → 公開）で、メモからAIが作りました。人間が書いたのは仕様書（[docs/spec.md](docs/spec.md)）とデザイン仕様（[docs/design.md](docs/design.md)）と、Issueのメモだけです。

その記録が、このリポジトリの [Issue](../../issues?q=is%3Aissue) と [Pull request](../../pulls?q=is%3Apr) の履歴です。

## 技術

Next.js（App Router）・TypeScript・Auth.js（GitHubログイン）・GitHub REST API・Vitest・Playwright・Vercel

Vercelは、`.github/` と `docs/pipeline.md` だけの変更では公開を飛ばします。

## READMEの画像の撮り直し

見た目を変えたときは、`npm run readme:shots` で `assets/readme/` の画像とGIFを撮り直します（初回は `npx playwright install chromium` が要ります）。
