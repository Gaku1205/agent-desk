# agent-desk

AIに開発を任せるときの、**進行状況と「人間の判断待ち」を1画面で見る**ダッシュボード。

![メモから公開まで進む様子](assets/readme/demo.gif)

**[デモを見る](https://agent-desk-ip1u.vercel.app/demo)**（ログイン不要。サンプルのデータで、右上の「再生 ▶」を押すと上のGIFと同じ動きが見られます）

## 何ができるか

### PC：3つの列

- **左：リポジトリの一覧**。監視しているリポジトリごとに「あなたの番」と「動いている」件数。下に `新サービス`（工場への入口）と、設定・ログアウトのメニュー。ボタン1つで畳めます
- **真ん中：いまの様子と、あなたの番**。会話アプリと同じく上が過去・下が最新です
  - いちばん上に、公開まで終わった物を日ごとに1行ずつ（監視に自動で足したリポジトリのお知らせも同じ並びに入ります）
  - その下に、動いている作業。題名の横のくるくる（止まっていれば ×）と、**AIがいま何をしているか**を1行で出します（AIの作業中のコメントか、動いているワークフローのステップ名から）
  - いちばん下に、AIが止まって人間の判断が要る物（あなたの番）。止まった・公開失敗を先に、待っている時間が長い順。その場で「再開」「マージ」などを押せ、AIからの質問や工場の相談には、選択肢を選んで答えられます
  - 最後に、1行のメモで Issue を作る入力欄
- **右：進捗図**。選んだ1件が、企画・デザイン・実装・CI・レビュー・修正・公開のどこまで進んだかを、上から下へ

![ホーム](assets/readme/home.png)

### リポジトリのページ

同じ画面を、1つのリポジトリだけに絞って見られます。

![リポジトリのページ](assets/readme/repo.png)

### 新しいサービスを作る

`新サービス` から、作りたいサービスを1行書くと、[ai-dev-template](https://github.com/Gaku1205/ai-dev-template) の工場が新しいリポジトリを作り、公開まで進めます。途中の相談（何を作るか・見た目の方向・ざっくり画面）は「あなたの番」に出るので、ここで答えます。できたリポジトリは自動で監視に足せます。

### 設定：監視するリポジトリ・通知・アニメーション

![設定](assets/readme/settings.png)

### スマホでも

1列になり、Issue を作る入力欄はいつも下に出ます。

<img src="assets/readme/home-mobile.png" alt="スマホのホーム" width="320">

### そのほか

- GitHub の認証が切れたら、自動でログアウトしてログインの画面に戻ります
- キーボードだけで使えます（`?` で操作の一覧）

## どうやって作ったか

このアプリ自身も、[ai-dev-template](https://github.com/Gaku1205/ai-dev-template) の全自動パイプライン（メモを書く → AIが清書・実装・レビュー・修正・マージ → 公開）で、メモからAIが作りました。人間が書いたのは仕様書（[docs/spec.md](docs/spec.md)）とデザイン仕様（[docs/design.md](docs/design.md)）と、Issueのメモだけです。

その記録が、このリポジトリの [Issue](../../issues?q=is%3Aissue) と [Pull request](../../pulls?q=is%3Apr) の履歴です。

## 技術

Next.js（App Router）・TypeScript・Auth.js（GitHubログイン）・GitHub REST API・Vitest・Playwright・Vercel

Vercelは、`.github/` と `docs/pipeline.md` だけの変更では公開を飛ばします。

## セットアップ：同期の読み取りをパイプラインのAppの鍵で行う（任意）

ふつうは、ログインした人（オーナー）のトークンで同期のデータを読みます。この回数制限（1時間5,000回）は、ほかのツール（`gh` など）と共有です。パイプラインのGitHub App（`gaku-ai-pipeline`）の鍵で読めば、別の回数（インストールごと）を使えます。

Vercel の agent-desk の環境変数に、パイプラインのSecretと同じ名前・同じ値で入れて、公開し直してください。

| 名前 | 値 |
| --- | --- |
| `PIPELINE_APP_ID` | AppのID |
| `PIPELINE_APP_PRIVATE_KEY` | 秘密鍵（`.pem` の中身。改行が `\n` の文字で入っていても読めます） |

- 入れなくても今までどおり動きます。Appが入っていないリポジトリ、鍵が取れないときも、ログインした人のトークンで読みます
- Appの鍵で読むのは、ログインした人のトークンで読めると確かめたリポジトリだけです。ボタンの操作は、いつもログインした人のトークンで行います
- 鍵はサーバーだけで使い、画面にもログにも出しません（詳しくは [docs/spec.md](docs/spec.md) の「読み取りの鍵」）

## セットアップ：GitHub の Webhook で、変わった時だけ取り直す（任意）

Appの鍵で読むリポジトリは、GitHub から「変わった」と知らせてもらった時だけ取り直し、数秒で画面に出します。何も変わっていない間は GitHub に問い合わせないので、パイプラインと共有のAppの回数制限を使い切りません。上の「Appの鍵で読む」設定をしてから、次の3つをしてください。

1. 合言葉を作る（パスワード生成などで、長いランダムな文字列）。Vercel の agent-desk の環境変数 `GITHUB_WEBHOOK_SECRET` に入れて、公開し直す
2. GitHub → Settings → Developer settings → GitHub Apps → パイプラインの App → General の Webhook：Active にチェック、URL に `https://<agent-desk のアドレス>/api/github/webhook`、Secret に同じ合言葉
3. 同じ App の Permissions & events → Subscribe to events で、Issues・Issue comment・Pull request・Pull request review comment・Check run・Check suite・Status・Workflow run・Label にチェック

- 入れなくても今までどおり動きます（決まった間隔で取り直します）。ログインした人のトークンで読むリポジトリも、今までどおりの間隔です
- Webhook が届かなかったときのため、覚えたデータは最大5分で取り直します。上端の「同期」を押せば、いつでもすぐ取り直します
- 設定画面で選んだ監視リポジトリは、Appの鍵で読みます（App に Variables の読み取りの権限が無いときは、App が入っているリポジトリの知らせを全部使います）
- 知らせの中身は保存せず、ログにも出しません（詳しくは [docs/spec.md](docs/spec.md) の「Webhook で取り直す」）

## READMEの画像の撮り直し

見た目を変えたときは、`npm run readme:shots` で `assets/readme/` の画像とGIFを撮り直します（初回は `npx playwright install chromium` が要ります）。
