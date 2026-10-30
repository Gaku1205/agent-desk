import type { WatchedRepo } from "../config";
import type {
  CheckRunData,
  CommitStatusData,
  IssueData,
  PullData,
  RepoData,
  RepoResult,
} from "../github/types";
import type { OperationKind } from "../turn";
import { applyDemoOps } from "./ops";
import { advancePlayback, PLAY_STEPS, playStep, type DemoPlayback, type PlayStep } from "./playback";

/**
 * デモのサンプルのデータ。GitHub には一切問い合わせず、本物と同じ形（RepoData）を「今」からの相対の時刻で作る。
 * 判定（status.ts）・あなたの番（turn.ts）・パイプライン（pipeline.ts）・最近の出来事（events.ts）は本物と同じ関数を通す
 */

/** デモのページのURLの頭 */
export const DEMO_BASE_PATH = "/demo";

/** このアプリのリポジトリ（帯の「GitHubで見る ↗」） */
export const DEMO_APP_REPO_URL = "https://github.com/Gaku1205/agent-desk";

/** 架空のリポジトリ */
export const DEMO_REPOS: WatchedRepo[] = [
  { owner: "demo", repo: "todo-app" },
  { owner: "demo", repo: "landing-page" },
];

/** 設定画面の「追加」の欄に出す、架空のリポジトリ */
export const DEMO_REPO_OPTIONS = ["demo/blog", "demo/api-server"];

/** 再生で進むIssue（todo-app） */
export const DEMO_PLAY_ISSUE = { repo: "todo-app", number: 24, pull: 39 } as const;

const MINUTE_MS = 60 * 1000;

const BOT = "claude[bot]";
const CI_CHECKS = ["typecheck", "lint", "test", "build"];

type Ctx = {
  owner: string;
  repo: string;
  base: number;
  data: RepoData;
  nextCommentId: number;
};

function createCtx({ owner, repo }: WatchedRepo, base: Date, firstCommentId: number): Ctx {
  return {
    owner,
    repo,
    base: base.getTime(),
    data: { issues: [], pulls: [], comments: [], pullChecks: {}, events: [] },
    nextCommentId: firstCommentId,
  };
}

/** 基準の時刻の m 分前（ISO文字列） */
function ago(ctx: Ctx, minutes: number): string {
  return new Date(ctx.base - minutes * MINUTE_MS).toISOString();
}

/** デモでは、Issue・PRのリンクはそのリポジトリのデモのページにする（GitHubには行かない） */
function repoPageUrl(ctx: Ctx): string {
  return `${DEMO_BASE_PATH}/repos/${ctx.owner}/${ctx.repo}`;
}

function addIssue(
  ctx: Ctx,
  number: number,
  title: string,
  options: {
    createdAt: string;
    labels?: string[];
    /** 企画AIが清書した（本文に `> 元のメモ：` を入れる） */
    planned?: boolean;
    closedAt?: string;
  },
): IssueData {
  const issue: IssueData = {
    number,
    title,
    body: options.planned ? `> 元のメモ：${title}\n\n### やること\n- ${title}` : `### やること\n- ${title}`,
    state: options.closedAt ? "closed" : "open",
    labels: options.labels ?? [],
    url: repoPageUrl(ctx),
    createdAt: options.createdAt,
    updatedAt: options.closedAt ?? options.createdAt,
    closedAt: options.closedAt ?? null,
  };
  ctx.data.issues.push(issue);
  return issue;
}

function addPull(
  ctx: Ctx,
  number: number,
  issue: IssueData,
  options: {
    createdAt: string;
    headSha: string;
    labels?: string[];
    mergedAt?: string;
    checkRuns: CheckRunData[];
    statuses?: CommitStatusData[];
  },
): PullData {
  const pull: PullData = {
    number,
    title: issue.title,
    body: `Closes #${issue.number}`,
    state: options.mergedAt ? "closed" : "open",
    merged: Boolean(options.mergedAt),
    labels: options.labels ?? [],
    url: repoPageUrl(ctx),
    headRef: `claude/issue-${issue.number}-demo`,
    headSha: options.headSha,
    mergeCommitSha: options.mergedAt ? `${options.headSha}ff` : null,
    createdAt: options.createdAt,
    updatedAt: options.mergedAt ?? options.createdAt,
    mergedAt: options.mergedAt ?? null,
  };
  ctx.data.pulls.push(pull);
  ctx.data.pullChecks[number] = {
    checkRuns: options.checkRuns,
    statuses: options.statuses ?? [],
  };
  return pull;
}

function addComment(ctx: Ctx, issueNumber: number, body: string, createdAt: string, author = BOT) {
  ctx.data.comments.push({ id: ctx.nextCommentId++, issueNumber, author, body, createdAt });
}

function addLabeled(ctx: Ctx, issueNumber: number, labelName: string, createdAt: string) {
  ctx.data.events.push({ event: "labeled", labelName, issueNumber, createdAt });
}

function run(
  name: string,
  completedAt: string | null,
  conclusion: string | null = completedAt ? "success" : null,
): CheckRunData {
  return {
    name,
    status: completedAt ? "completed" : "in_progress",
    conclusion,
    appSlug: "github-actions",
    completedAt,
  };
}

/** CIの4つのチェック。passed 個までは completedAt で通過、残りは実行中 */
function ciRuns(passed: number, completedAt: string): CheckRunData[] {
  return CI_CHECKS.map((name, index) => run(name, index < passed ? completedAt : null));
}

function vercel(
  state: "pending" | "success" | "failure",
  updatedAt: string,
  description = "",
): CommitStatusData {
  return { context: "Vercel", state, description, updatedAt };
}

const DONE_COMMENT = "**Claude finished** 実装してブランチにpushしました";
const ERROR_COMMENT = "**Claude encountered an error** 途中で止まりました";
const REVIEW_CLEAN = "## Code review\n\nNo issues found. 型・テストとも問題ありません";
const REVIEW_ISSUES = "## Code review\n\n指摘が1件あります：空のときの表示がありません";

function autoFixComment(sha: string, reason: string): string {
  return `<!-- auto-fix -->\n<!-- auto-fix-sha: ${sha} -->\n@claude ${reason}を直してください`;
}

function stuckComment(reason: string): string {
  return `⏸ 自動で進めるのを止めました：${reason}`;
}

function retryComment(count: number, reason: string): string {
  return `🔁 AIが止まったので、時間をおいて自動でやり直します（やり直し ${count}/10回）。\n理由：${reason}\n\n<!-- auto-retry -->\n<!-- count=${count} kind=implement -->`;
}

/** 公開済みのIssue（PRはマージ済み、公開ステータスは success。statusAt が null なら公開状況は不明） */
function addDeployed(
  ctx: Ctx,
  number: number,
  pullNumber: number,
  title: string,
  mergedMinutesAgo: number,
  options: { planned?: boolean; fixed?: boolean; unknown?: boolean } = {},
) {
  const mergedAt = ago(ctx, mergedMinutesAgo);
  const issue = addIssue(ctx, number, title, {
    createdAt: ago(ctx, mergedMinutesAgo + 90),
    labels: ["ai:implement"],
    planned: options.planned,
    closedAt: mergedAt,
  });
  addLabeled(ctx, number, "ai:implement", ago(ctx, mergedMinutesAgo + 80));
  const headSha = `d${number}e${pullNumber}`;
  addPull(ctx, pullNumber, issue, {
    createdAt: ago(ctx, mergedMinutesAgo + 50),
    headSha,
    mergedAt,
    checkRuns: [...ciRuns(4, ago(ctx, mergedMinutesAgo + 20)), run("review", ago(ctx, mergedMinutesAgo + 10))],
    statuses: options.unknown ? [] : [vercel("success", ago(ctx, mergedMinutesAgo - 2))],
  });
  if (options.fixed) {
    addComment(ctx, pullNumber, autoFixComment("0ab1", "レビューの指摘"), ago(ctx, mergedMinutesAgo + 40));
  }
  addComment(ctx, pullNumber, REVIEW_CLEAN, ago(ctx, mergedMinutesAgo + 10));
}

/** 再生で進む1件。playback の段階に合わせて、Issue・PR・コメント・チェック・ラベルを足す */
function addPlayIssue(ctx: Ctx, playback: DemoPlayback) {
  const step = playStep(playback);
  const index = stepIndex(step);
  /** その段階に入った時刻 */
  const when = (name: PlayStep) => playback.times[stepIndex(name)] ?? playback.times[0];
  const reached = (name: PlayStep) => index >= stepIndex(name);
  const { number, pull: pullNumber } = DEMO_PLAY_ISSUE;
  const title = "期限が近いタスクを一覧の上に出す";

  const issue = addIssue(ctx, number, title, {
    createdAt: when("planning"),
    labels: reached("implementing") ? ["ai:implement"] : ["ai:plan"],
    planned: reached("implementing"),
    closedAt: reached("deploying") ? when("deploying") : undefined,
  });
  if (reached("implementing")) addLabeled(ctx, number, "ai:implement", when("implementing"));
  if (reached("prWaiting")) addComment(ctx, number, DONE_COMMENT, when("prWaiting"));
  if (!reached("ciRunning")) return;

  const firstSha = "7a8b9c0";
  const fixedSha = "8b9c0d1";
  const ciStart = when("ciRunning");
  if (reached("reviewing")) addLabeled(ctx, pullNumber, "ai:review", when("reviewing"));
  if (reached("fixing")) {
    addComment(ctx, pullNumber, REVIEW_ISSUES, when("fixing"));
    addComment(ctx, pullNumber, autoFixComment(firstSha, "レビューの指摘"), when("fixing"));
  }
  if (reached("mergeWaiting")) addComment(ctx, pullNumber, REVIEW_CLEAN, when("mergeWaiting"));

  // 先頭コミットのチェック。直したコミットをpushしたら（修正の確認中から）チェックはやり直し
  let headSha = firstSha;
  let labels: string[] = [];
  let checkRuns: CheckRunData[];
  switch (step) {
    case "ciRunning":
      checkRuns = ciRuns(1, ciStart);
      break;
    case "reviewing":
      labels = ["ai:review"];
      checkRuns = [...ciRuns(4, when("reviewing")), run("review", null)];
      break;
    case "fixing":
      labels = ["ai:review"];
      checkRuns = [
        ...ciRuns(4, when("reviewing")),
        run("review", when("fixing")),
      ];
      break;
    case "verifying":
      headSha = fixedSha;
      checkRuns = ciRuns(2, when("verifying"));
      break;
    default:
      // マージ待ち・公開中・公開済み
      headSha = fixedSha;
      labels = ["ai:review"];
      checkRuns = [
        ...ciRuns(4, when("mergeWaiting")),
        run("review", when("mergeWaiting")),
      ];
  }

  addPull(ctx, pullNumber, issue, {
    createdAt: ciStart,
    headSha,
    labels,
    mergedAt: reached("deploying") ? when("deploying") : undefined,
    checkRuns,
    statuses: reached("deployed")
      ? [vercel("success", when("deployed"))]
      : reached("deploying")
        ? [vercel("pending", when("deploying"))]
        : [],
  });
}

function stepIndex(name: PlayStep): number {
  return PLAY_STEPS.indexOf(name);
}

/** todo-app：再生の1件、止まった・マージ待ち（ai:hold）・レビュー中・CI中・CI失敗・修正中・AI作業中・順番待ち・未着手・公開済み */
function todoApp(base: Date, playback: DemoPlayback): RepoData {
  const ctx = createCtx(DEMO_REPOS[0], base, 1000);
  addPlayIssue(ctx, playback);

  // 止まった（AIが2回直してもCIが通らない）
  const stuck = addIssue(ctx, 23, "通知の音を設定で変えられるようにする", {
    createdAt: ago(ctx, 6 * 60),
    labels: ["ai:implement"],
    planned: true,
  });
  addLabeled(ctx, 23, "ai:implement", ago(ctx, 5 * 60 + 50));
  addPull(ctx, 38, stuck, {
    createdAt: ago(ctx, 5 * 60),
    headSha: "3c4d5e6",
    labels: ["ai:stuck"],
    checkRuns: [run("typecheck", ago(ctx, 50)), run("lint", ago(ctx, 50)), run("test", ago(ctx, 48), "failure"), run("build", ago(ctx, 49))],
  });
  addComment(ctx, 38, autoFixComment("1a2b3c4", "CIの失敗"), ago(ctx, 4 * 60));
  addComment(ctx, 38, autoFixComment("2b3c4d5", "CIの失敗"), ago(ctx, 2 * 60));
  addComment(ctx, 38, stuckComment("AIが2回直してもCIが通りませんでした（test）"), ago(ctx, 46));
  addLabeled(ctx, 38, "ai:stuck", ago(ctx, 46));

  // やり直し待ち（使用量の上限でAIが止まり、時間をおいて自動でやり直す）
  addIssue(ctx, 25, "タスクの色分けをカテゴリごとに変えられるようにする", {
    createdAt: ago(ctx, 90),
    labels: ["ai:implement", "ai:retry"],
    planned: true,
  });
  addLabeled(ctx, 25, "ai:implement", ago(ctx, 85));
  addComment(ctx, 25, retryComment(2, "使用量の上限に達しました"), ago(ctx, 12));
  addLabeled(ctx, 25, "ai:retry", ago(ctx, 12));

  // マージ待ち（ai:hold・レビュー済み）
  const hold = addIssue(ctx, 22, "完了したタスクをまとめて消せるようにする", {
    createdAt: ago(ctx, 4 * 60),
    labels: ["ai:implement"],
    planned: true,
  });
  addLabeled(ctx, 22, "ai:implement", ago(ctx, 3 * 60 + 50));
  addPull(ctx, 37, hold, {
    createdAt: ago(ctx, 3 * 60),
    headSha: "5e6f7a8",
    labels: ["ai:hold", "ai:review"],
    checkRuns: [...ciRuns(4, ago(ctx, 32)), run("review", ago(ctx, 21))],
  });
  addLabeled(ctx, 37, "ai:review", ago(ctx, 31));
  addComment(ctx, 37, REVIEW_CLEAN, ago(ctx, 21));

  // マージ待ち（ai:hold・まだレビューしていない）
  const holdNoReview = addIssue(ctx, 21, "書き出しをCSVにも対応する", {
    createdAt: ago(ctx, 26 * 60),
    labels: ["ai:implement"],
  });
  addLabeled(ctx, 21, "ai:implement", ago(ctx, 25 * 60 + 50));
  addPull(ctx, 36, holdNoReview, {
    createdAt: ago(ctx, 25 * 60),
    headSha: "6f7a8b9",
    labels: ["ai:hold"],
    checkRuns: ciRuns(4, ago(ctx, 24 * 60 + 40)),
  });

  // レビュー中
  const reviewing = addIssue(ctx, 20, "タスクの検索に絞り込みを足す", {
    createdAt: ago(ctx, 70),
    labels: ["ai:implement"],
    planned: true,
  });
  addLabeled(ctx, 20, "ai:implement", ago(ctx, 65));
  addPull(ctx, 35, reviewing, {
    createdAt: ago(ctx, 30),
    headSha: "7b8c9d0",
    labels: ["ai:review"],
    checkRuns: [...ciRuns(4, ago(ctx, 4)), run("review", null)],
  });
  addLabeled(ctx, 35, "ai:review", ago(ctx, 4));

  // CI中
  const ciRunning = addIssue(ctx, 19, "期限の表示を「あと2日」の形にする", {
    createdAt: ago(ctx, 40),
    labels: ["ai:implement"],
  });
  addLabeled(ctx, 19, "ai:implement", ago(ctx, 38));
  addPull(ctx, 34, ciRunning, {
    createdAt: ago(ctx, 3),
    headSha: "8c9d0e1",
    checkRuns: ciRuns(2, ago(ctx, 1)),
  });

  // CI失敗（AIが直す前）
  const ciFailed = addIssue(ctx, 18, "繰り返しのタスクを作れるようにする", {
    createdAt: ago(ctx, 3 * 60),
    labels: ["ai:implement"],
    planned: true,
  });
  addLabeled(ctx, 18, "ai:implement", ago(ctx, 2 * 60 + 50));
  addPull(ctx, 33, ciFailed, {
    createdAt: ago(ctx, 20),
    headSha: "9d0e1f2",
    checkRuns: [run("typecheck", ago(ctx, 8)), run("lint", ago(ctx, 8)), run("test", ago(ctx, 6), "failure"), run("build", ago(ctx, 7))],
  });

  // 修正中（レビューの指摘を直している）
  const fixing = addIssue(ctx, 17, "タスクの並べ替えをドラッグでできるようにする", {
    createdAt: ago(ctx, 5 * 60),
    labels: ["ai:implement"],
    planned: true,
  });
  addLabeled(ctx, 17, "ai:implement", ago(ctx, 4 * 60 + 50));
  addPull(ctx, 32, fixing, {
    createdAt: ago(ctx, 60),
    headSha: "4d5e6f7",
    labels: ["ai:review"],
    checkRuns: [...ciRuns(4, ago(ctx, 40)), run("review", ago(ctx, 13))],
  });
  addLabeled(ctx, 32, "ai:review", ago(ctx, 39));
  addComment(ctx, 32, REVIEW_ISSUES, ago(ctx, 13));
  addComment(ctx, 32, autoFixComment("4d5e6f7", "レビューの指摘"), ago(ctx, 12));

  // AI作業中（並列動作）
  addIssue(ctx, 16, "タスクにメモ欄を付ける", {
    createdAt: ago(ctx, 15),
    labels: ["ai:implement"],
    planned: true,
  });
  addLabeled(ctx, 16, "ai:implement", ago(ctx, 9));
  // もう1件：AIの番の数を「あなたの番」の数とずらす（上端の帯で同じ数が並んでバグに見えないように）
  addIssue(ctx, 41, "ダークモードに切り替えられるようにする", {
    createdAt: ago(ctx, 8),
    labels: ["ai:implement"],
    planned: true,
  });
  addLabeled(ctx, 41, "ai:implement", ago(ctx, 5));

  // 順番待ち（理由つき）
  addIssue(ctx, 15, "タスクの一覧を週ごとに分ける", {
    createdAt: ago(ctx, 35),
    labels: ["ai:queue"],
    planned: true,
  });
  addComment(
    ctx,
    15,
    "#17（ドラッグで並べ替え）と同じ一覧の部品を変えるので、#17 が終わってから始めます",
    ago(ctx, 33),
  );
  addIssue(ctx, 14, "並べ替えた順番を保存する", {
    createdAt: ago(ctx, 34),
    labels: ["ai:queue"],
    planned: true,
  });
  addComment(ctx, 14, "#17 の並べ替えができてから、その順番を保存する作業なので順番待ちにします", ago(ctx, 32));

  // 保留（ai:skip）
  addIssue(ctx, 31, "タスクをカレンダーに表示する", { createdAt: ago(ctx, 3 * 60), labels: ["ai:skip"] });
  addLabeled(ctx, 31, "ai:skip", ago(ctx, 3 * 60));

  // 未着手
  addIssue(ctx, 13, "タスクに色のラベルを付けられるようにする", { createdAt: ago(ctx, 2 * 60 + 15) });

  // 公開済み（新しい順に6件。いちばん古い物は公開状況が不明）
  addDeployed(ctx, 12, 30, "タスクの追加をEnterキーでできるようにする", 2 * 60, { planned: true });
  addDeployed(ctx, 11, 29, "空のときに「タスクはありません」と出す", 7 * 60, { fixed: true });
  addDeployed(ctx, 10, 28, "期限を過ぎたタスクを赤くする", 20 * 60, { planned: true });
  addDeployed(ctx, 9, 27, "タスクの名前を編集できるようにする", 27 * 60, { planned: true, fixed: true });
  addDeployed(ctx, 8, 26, "スマホで文字が小さすぎるのを直す", 44 * 60);
  addDeployed(ctx, 7, 40,"最初の画面にタスクの一覧を出す", 9 * 24 * 60, { unknown: true });

  return ctx.data;
}

/** landing-page：公開失敗・公開中・PR作成待ち（エラーあり）・マージ待ち（AI）・企画中・修正の確認中・公開済み */
function landingPage(base: Date): RepoData {
  const ctx = createCtx(DEMO_REPOS[1], base, 2000);

  // 公開失敗
  const deployFailed = addIssue(ctx, 9, "トップの画像を軽くする", {
    createdAt: ago(ctx, 3 * 60),
    labels: ["ai:implement"],
    planned: true,
    closedAt: ago(ctx, 38),
  });
  addPull(ctx, 15, deployFailed, {
    createdAt: ago(ctx, 2 * 60),
    headSha: "a9b8c7d",
    mergedAt: ago(ctx, 38),
    checkRuns: [...ciRuns(4, ago(ctx, 70)), run("review", ago(ctx, 60))],
    statuses: [vercel("failure", ago(ctx, 34), "Deployment rate limited — retry in 24 hours.")],
  });
  addComment(ctx, 15, REVIEW_CLEAN, ago(ctx, 60));

  // 公開済み（マージコミットの公開は失敗したが、そのあとの main の公開が成功したので公開済み）
  const laterDeployed = addIssue(ctx, 26, "ボタンを押したときの色を変える", {
    createdAt: ago(ctx, 2 * 60 + 20),
    labels: ["ai:implement"],
    planned: true,
    closedAt: ago(ctx, 50),
  });
  addPull(ctx, 39, laterDeployed, {
    createdAt: ago(ctx, 80),
    headSha: "e26f39a",
    mergedAt: ago(ctx, 50),
    checkRuns: [...ciRuns(4, ago(ctx, 65)), run("review", ago(ctx, 55))],
    statuses: [vercel("failure", ago(ctx, 48), "Deployment rate limited — retry in 24 hours.")],
  });
  addComment(ctx, 39, REVIEW_CLEAN, ago(ctx, 55));
  // main の最新コミットの、いちばん新しい成功した公開（上のPRより後、下の公開失敗（38分前）より前）
  ctx.data.mainDeployedAt = ago(ctx, 40);

  // 公開中
  const deploying = addIssue(ctx, 8, "お問い合わせフォームに確認の画面を足す", {
    createdAt: ago(ctx, 90),
    labels: ["ai:implement"],
    closedAt: ago(ctx, 1),
  });
  addPull(ctx, 14, deploying, {
    createdAt: ago(ctx, 45),
    headSha: "b8c7d6e",
    mergedAt: ago(ctx, 1),
    checkRuns: [...ciRuns(4, ago(ctx, 20)), run("review", ago(ctx, 8))],
    statuses: [vercel("pending", ago(ctx, 1))],
  });
  addComment(ctx, 14, REVIEW_CLEAN, ago(ctx, 8));

  // パイプラインが入っているリポジトリ（PR作成待ち・未着手の猶予を使う）
  ctx.data.pipeline = "running";

  // PRを作成中（完了コメントから15分たっていない：AIの番）
  addIssue(ctx, 17, "お問い合わせの送信後にお礼の文を出す", {
    createdAt: ago(ctx, 30),
    labels: ["ai:implement"],
    planned: true,
  });
  addLabeled(ctx, 17, "ai:implement", ago(ctx, 20));
  addComment(ctx, 17, DONE_COMMENT, ago(ctx, 4));

  // PR作成待ち（完了コメントから15分以上たった：人間の番）
  addIssue(ctx, 7, "料金表を3列にする", { createdAt: ago(ctx, 50), labels: ["ai:implement"] });
  addLabeled(ctx, 7, "ai:implement", ago(ctx, 45));
  addComment(ctx, 7, DONE_COMMENT, ago(ctx, 16));

  // PR作成待ち（実装AIがエラーで止まった）
  addIssue(ctx, 6, "英語のページを足す", { createdAt: ago(ctx, 30 * 60), labels: ["ai:implement"], planned: true });
  addLabeled(ctx, 6, "ai:implement", ago(ctx, 29 * 60));
  addComment(ctx, 6, ERROR_COMMENT, ago(ctx, 28 * 60 + 20));

  // マージ待ち（レビューに回す前）
  const needsReview = addIssue(ctx, 5, "フッターのリンクを整理する", {
    createdAt: ago(ctx, 25),
    labels: ["ai:implement"],
  });
  addPull(ctx, 13, needsReview, {
    createdAt: ago(ctx, 10),
    headSha: "c7d6e5f",
    checkRuns: ciRuns(4, ago(ctx, 1)),
  });

  // マージ待ち（自動でマージする直前）
  const autoMerge = addIssue(ctx, 4, "ページの読み込みを速くする", {
    createdAt: ago(ctx, 80),
    labels: ["ai:implement"],
    planned: true,
  });
  addPull(ctx, 12, autoMerge, {
    createdAt: ago(ctx, 40),
    headSha: "d6e5f4a",
    labels: ["ai:review"],
    checkRuns: [...ciRuns(4, ago(ctx, 15)), run("review", ago(ctx, 1))],
  });
  addLabeled(ctx, 12, "ai:review", ago(ctx, 14));
  addComment(ctx, 12, REVIEW_CLEAN, ago(ctx, 1));

  // 企画中
  addIssue(ctx, 3, "よくある質問のページを作る", { createdAt: ago(ctx, 1), labels: ["ai:plan"] });

  // AI作業中（上端の帯の件数が、あなたの番の数と同じにならないように）
  addIssue(ctx, 16, "お知らせの帯を足す", { createdAt: ago(ctx, 12), labels: ["ai:implement"], planned: true });
  addLabeled(ctx, 16, "ai:implement", ago(ctx, 6));

  // 修正の確認中（CIの失敗を直して、CIをやり直している）
  const verifying = addIssue(ctx, 2, "スマホでメニューが開かないのを直す", {
    createdAt: ago(ctx, 2 * 60),
    labels: ["ai:implement"],
  });
  addPull(ctx, 11, verifying, {
    createdAt: ago(ctx, 90),
    headSha: "6f7a8b9",
    checkRuns: ciRuns(3, ago(ctx, 2)),
  });
  addComment(ctx, 11, autoFixComment("5e6f7a8", "CIの失敗"), ago(ctx, 20));

  // 公開済み
  addDeployed(ctx, 1, 10, "ヘッダーのロゴを差し替える", 50 * 60, { planned: true });

  return ctx.data;
}

/** デモの全リポジトリのデータ。base はサンプルの時刻の基準、playback は再生の状態（押した操作を含む） */
export function buildDemoResults(base: Date, playback: DemoPlayback): RepoResult[] {
  const [todo, landing] = DEMO_REPOS;
  return [
    { ...todo, ok: true, data: applyDemoOps(todoApp(base, playback), playback.ops, todo.owner, todo.repo) },
    { ...landing, ok: true, data: applyDemoOps(landingPage(base), playback.ops, landing.owner, landing.repo) },
  ];
}

/**
 * デモで「あなたの番」のボタンを押した：押した操作を覚える（データには buildDemoResults が当てる）。
 * 再生で進む1件のボタンは、再生を1段階進める（docs/spec.md の「デモ」）
 */
export function pressDemo(
  playback: DemoPlayback,
  target: { owner: string; repo: string; number: number },
  kind: OperationKind,
): DemoPlayback {
  const [todo] = DEMO_REPOS;
  if (target.owner === todo.owner && target.repo === DEMO_PLAY_ISSUE.repo && target.number === DEMO_PLAY_ISSUE.number) {
    return advancePlayback(playback);
  }
  return { ...playback, ops: [...playback.ops, { ...target, kind, at: playback.now }] };
}
