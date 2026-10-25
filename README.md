# agent-desk

AIに開発を任せるときの、**進行状況と「人間の判断待ち」を1画面で見る**ダッシュボード。

[ai-dev-template](https://github.com/Gaku1205/ai-dev-template) の全自動パイプライン（メモを書く → AIが清書・実装・レビュー・修正・マージ → 公開）で、このアプリ自身もAIが作っています。人間が書いたのは仕様書（[docs/spec.md](docs/spec.md)）とデザイン仕様（[docs/design.md](docs/design.md)）と、Issueのメモだけです。

- ホーム：全リポジトリの「あなたの番」と、最近の出来事
- リポジトリのページ：Issueごとに、実装 → PR → チェック → マージ → 公開 のどこにいるか
- AIが止まったときだけ「あなたの番」に出て、その場で再開・マージなどを押せる

技術：Next.js（App Router）・TypeScript・Auth.js（GitHubログイン）・GitHub REST API・Vitest・Vercel
