import type { WatchedRepo } from "../config";
import type {
  CheckRunData,
  CommitStatusData,
  IssueData,
  PullData,
  RepoData,
  RepoResult,
  WorkflowRunData,
} from "../github/types";
import { pickAutoAddRepos } from "../autoAdd";
import { isRunningStage } from "../runningPipeline";
import { getFlow } from "../flow";
import { getIssueStatus, shouldShowIssue, type Stage } from "../status";
import type { OperationKind } from "../turn";
import { FACTORY_BOT } from "../factoryTalk";
import { demoFactoryBody, demoFactoryState } from "./factory";
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
  // あなたの番もAIの番も 0・0 の見本（左のバーには出ない）
  { owner: "demo", repo: "notes-api" },
];

/** Issueを書く画面で、テンプレートリポジトリの見本にするデモのリポジトリ（「新サービス：」「全部おまかせ」を見せる） */
export const DEMO_TEMPLATE_REPO = "landing-page";

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
    data: { owner, issues: [], pulls: [], comments: [], pullChecks: {}, events: [] },
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
    /** `Closes #番号` の後ろに足す本文（審査役の採点など） */
    body?: string;
    /** 変更ファイルの名前（マージ待ちの一覧の並びに使う） */
    files?: string[];
  },
): PullData {
  const pull: PullData = {
    number,
    title: issue.title,
    body: options.body ? `Closes #${issue.number}\n\n${options.body}` : `Closes #${issue.number}`,
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
    ...(options.files ? { files: options.files } : {}),
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
/** 作業中のコメント（AIのアクションが更新し続ける。やることの一覧つき） */
const DEMO_WORKING_COMMENT = [
  "Claude Code is working…",
  "",
  "- [x] 仕様を読む",
  "- [x] メモ欄の型を足す",
  "- [ ] 入力欄を一覧に付ける",
  "- [ ] テストを書く",
  "- [ ] 確認コマンドを通す",
].join("\n");
const ERROR_COMMENT = "**Claude encountered an error** 途中で止まりました";
const REVIEW_CLEAN = "## Code review\n\nNo issues found. 型・テストとも問題ありません";
/** 企画AIの質問（画面案つき）。画像は public/mockups/ の見本 */
const QUESTION_COMMENT = [
  "<!-- ai-question -->",
  "企画AIから質問です。決めてもらえれば、清書して実装に回します。",
  "",
  "**Q1. 全体の色の雰囲気は？**",
  "- A. 落ち着いた夜の色（おすすめ）",
  "- B. 明るい昼の色",
  "",
  "**Q2. いちばん上の大きな文の長さは？**",
  "- A. 1行で短く（おすすめ）",
  "- B. 2〜3行で説明する",
  "",
  "<!-- ai-mocks: issue-18/r1 -->",
  "### A. 写真を大きく",
  '<img src="/mockups/a-pc.svg" alt="A PC">',
  '<img src="/mockups/a-mobile.svg" alt="A スマホ">',
  "### B. 文字を大きく",
  '<img src="/mockups/b-pc.svg" alt="B PC">',
  '<img src="/mockups/b-mobile.svg" alt="B スマホ">',
].join("\n");
const REVIEW_ISSUES = "## Code review\n\n指摘が1件あります：空のときの表示がありません";
/** 審査役の採点（パイプラインがPRの本文に入れる形。8点未満で、実装に1回戻った） */
const CRITIQUE_BODY = [
  "## 審査役（画面の画像だけを見る別のAI）の採点",
  "",
  "点数: 7.5",
  "判定: 直す",
  "",
  "## 直すこと",
  "1. 絞り込みの札の間が狭く、押しにくい",
].join("\n");

function autoFixComment(sha: string, reason: string, count = 1): string {
  return `<!-- auto-fix -->\n<!-- auto-fix-sha: ${sha} -->\n@claude ${reason}を直してください（自動の依頼 ${count}/3）`;
}

function stuckComment(reason: string): string {
  return `⏸ 自動で進めるのを止めました：${reason}`;
}

function retryComment(count: number, reason: string): string {
  return `🔁 AIが止まったので、時間をおいて自動でやり直します（やり直し ${count}/10回）。\n理由：${reason}\n\n<!-- auto-retry -->\n<!-- count=${count} kind=implement -->`;
}

/** 進捗ログに載せるモデル名（モデルを使わない工程は null）。進捗図の工程のキーで引く */
const DEMO_STEP_MODEL: Record<string, string | null> = {
  plan: "opus",
  implement: "sonnet",
  ci: null,
  review: "sonnet",
  fix: "sonnet",
  deploy: null,
};

/**
 * デモの各Issueに、進捗ログのコメント（`<!-- ai-step-log -->` と `<!-- ai-step {JSON} -->` の行。形は src/lib/stepLog.ts）を足す。
 * 進捗図で記録のある工程（今の位置までで、待ちでない物）だけ、基準の時刻から逆に並べる。記録が無い工程は足さない
 */
function addStepLogs(ctx: Ctx) {
  const now = new Date(ctx.base);
  for (const issue of [...ctx.data.issues]) {
    const flow = getFlow(getIssueStatus(issue, ctx.data, now));
    const logged = flow.steps.filter((step) => step.state !== "waiting" && Object.hasOwn(DEMO_STEP_MODEL, step.key));
    if (logged.length === 0) continue;
    const lines = logged.map((step, index) => {
      const started = ago(ctx, (logged.length - index) * 4);
      const running = step.state === "running";
      return `<!-- ai-step ${JSON.stringify({
        step: step.key,
        model: DEMO_STEP_MODEL[step.key],
        started,
        finished: running ? null : ago(ctx, (logged.length - index) * 4 - 1 - (index % 3)),
        result: running ? "running" : step.state === "failed" ? "failure" : "success",
      })} -->`;
    });
    addComment(ctx, issue.number, `<!-- ai-step-log -->\n### 進捗ログ\n\n${lines.join("\n")}`, ago(ctx, 1));
  }
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

  // 止まった（AIが3回直してもCIが通らない）
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
  addComment(ctx, 38, autoFixComment("1a2b3c4", "CIの失敗", 1), ago(ctx, 4 * 60));
  addComment(ctx, 38, autoFixComment("2b3c4d5", "CIの失敗", 2), ago(ctx, 2 * 60));
  addComment(ctx, 38, autoFixComment("3d4e5f6", "CIの失敗", 3), ago(ctx, 90));
  addComment(ctx, 38, stuckComment("AIが3回直してもCIが通りませんでした（test）"), ago(ctx, 46));
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
    files: ["src/components/TaskList.tsx", "src/lib/tasks.ts"],
  });
  addLabeled(ctx, 37, "ai:review", ago(ctx, 31));
  addComment(ctx, 37, REVIEW_CLEAN, ago(ctx, 21));

  // マージ待ち（Issueが ai:stuck のまま。紐づくPRが「マージしてよいPR」なので、止まったではなくマージ）
  const stuckHold = addIssue(ctx, 71, "設定の画面に保存のお知らせを出す", {
    createdAt: ago(ctx, 8 * 60),
    labels: ["ai:implement", "ai:stuck"],
    planned: true,
  });
  addLabeled(ctx, 71, "ai:stuck", ago(ctx, 7 * 60));
  addPull(ctx, 72, stuckHold, {
    createdAt: ago(ctx, 6 * 60),
    headSha: "7a8b9c0",
    labels: ["ai:hold", "ai:review"],
    checkRuns: [...ciRuns(4, ago(ctx, 5 * 60)), run("review", ago(ctx, 4 * 60))],
    files: ["src/components/Settings.tsx"],
  });
  addComment(ctx, 72, REVIEW_CLEAN, ago(ctx, 4 * 60));

  // マージ待ち（Issueに紐づかないPR：マネージャーが作った。ai:hold・レビュー済み・CI通過）
  const unlinked = addPull(ctx, 73, { ...stuckHold, number: 0, title: "READMEの手順を最新にする" }, {
    createdAt: ago(ctx, 2 * 60),
    headSha: "8b9c0d1",
    labels: ["ai:hold"],
    checkRuns: [...ciRuns(4, ago(ctx, 90)), run("review", ago(ctx, 80))],
    files: ["README.md"],
  });
  unlinked.body = "READMEの手順を、いまの画面に合わせて直しました。";
  unlinked.headRef = "manager/readme-update";
  addComment(ctx, 73, REVIEW_CLEAN, ago(ctx, 80));

  // AI作業中（上端の帯の件数が、あなたの番の数と同じにならないように）
  addIssue(ctx, 74, "ログイン後の画面に今日の予定を出す", {
    createdAt: ago(ctx, 14),
    labels: ["ai:implement"],
    planned: true,
  });
  addLabeled(ctx, 74, "ai:implement", ago(ctx, 9));
  addIssue(ctx, 75, "タスクの並び替えを足す", { createdAt: ago(ctx, 11), labels: ["ai:implement"], planned: true });
  addLabeled(ctx, 75, "ai:implement", ago(ctx, 5));

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
    // #37 と src/lib/tasks.ts が重なる
    files: ["src/lib/export.ts", "src/lib/tasks.ts"],
  });
  // 順番待ち（#15・#14）を止めている印（パイプラインが付ける）
  addComment(ctx, 36, "<!-- hold-blocking: #15,#14 -->", ago(ctx, 20 * 60), "github-actions[bot]");

  // レビュー中（審査役の採点が8点未満で、実装に1回戻った）
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
    body: CRITIQUE_BODY,
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
  // AIのアクションが作業中に更新し続けるコメント（「AIが今していること」の見本）
  addComment(ctx, 16, DEMO_WORKING_COMMENT, ago(ctx, 8));
  // デモのリンクはアプリの中のページへ（架空のリポジトリなので GitHub へは向けない）
  ctx.data.comments[ctx.data.comments.length - 1].url = repoPageUrl(ctx);
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
  // 順番待ちに入った時刻（Slots & Queue の待ち時間）
  addLabeled(ctx, 15, "ai:queue", ago(ctx, 33));
  addIssue(ctx, 14, "並べ替えた順番を保存する", {
    createdAt: ago(ctx, 34),
    labels: ["ai:queue"],
    planned: true,
  });
  addComment(ctx, 14, "#17 の並べ替えができてから、その順番を保存する作業なので順番待ちにします", ago(ctx, 32));
  addLabeled(ctx, 14, "ai:queue", ago(ctx, 32));

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

  addStepLogs(ctx);
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

  // 質問（企画AIが、画面案つきで答えを待っている：人間の番）
  addIssue(ctx, 18, "トップページの見た目を新しくする", { createdAt: ago(ctx, 70), labels: ["ai:question"] });
  addLabeled(ctx, 18, "ai:question", ago(ctx, 34));
  addComment(ctx, 18, QUESTION_COMMENT, ago(ctx, 34));

  // 工場の相談（テンプレートの工場が、案を出して返事を待っている：人間の番。答えると次の段階へ進む）
  addIssue(ctx, 19, "新サービス：毎朝の天気と予定を1枚で見られるページ", {
    createdAt: ago(ctx, 90),
    labels: ["factory", "factory:talk", "factory:wait"],
  });
  addLabeled(ctx, 19, "factory:wait", ago(ctx, 52));
  addComment(ctx, 19, demoFactoryBody(demoFactoryState("ideas")), ago(ctx, 52), FACTORY_BOT);

  // 企画中（上端の帯の件数が、あなたの番の数と同じにならないように）
  addIssue(ctx, 20, "お問い合わせに自動で返事を送る", { createdAt: ago(ctx, 3), labels: ["ai:plan"] });

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

  addStepLogs(ctx);
  return ctx.data;
}

/** notes-api：公開済みの1件だけ（あなたの番もAIの番も 0・0。左のバーには出ず、すべてのリポジトリにだけ出る見本） */
function notesApi(base: Date): RepoData {
  const ctx = createCtx(DEMO_REPOS[2], base, 4000);
  addDeployed(ctx, 1, 2, "メモを一覧で返すAPIを足す", 30 * 60, { planned: true });
  addStepLogs(ctx);
  return ctx.data;
}

/** デモの全リポジトリのデータ。base はサンプルの時刻の基準、playback は再生の状態（押した操作を含む） */
export function buildDemoResults(base: Date, playback: DemoPlayback): RepoResult[] {
  const [todo, landing, notes] = DEMO_REPOS;
  const todoData = applyDemoOps(todoApp(base, playback), playback.ops, todo.owner, todo.repo);
  const landingData = applyDemoOps(landingPage(base), playback.ops, landing.owner, landing.repo);
  const notesData = notesApi(base);
  return [
    { ...todo, ok: true, data: { ...todoData, runs: demoRuns(todoData, base) } },
    { ...landing, ok: true, data: { ...landingData, runs: demoRuns(landingData, base, DEMO_STALLED) } },
    { ...notes, ok: true, data: { ...notesData, runs: demoRuns(notesData, base) } },
  ];
}

/** 工場が作る新しいリポジトリの見本（テンプレート landing-page から作られた。自動で監視に足す） */
export const DEMO_AUTO_ADD_REPO: WatchedRepo = { owner: "demo", repo: "morning-card" };
/** テンプレート landing-page の「新サービス：」の Issue（工場の相談） */
const DEMO_FACTORY_ISSUE = 19;

/**
 * デモの自動追加：工場の相談で「作る」を押して「新サービス：」の Issue が閉じたら、工場が作ったリポジトリを足すか決める
 * （本物と同じ `pickAutoAddRepos`。オフなら足さない）。足すなら、足したリポジトリと時刻（Issue が閉じた時刻）
 */
export function demoAutoAdd(results: RepoResult[], enabled: boolean): { repo: WatchedRepo; at: string } | null {
  const landing = results.find((result) => result.repo === DEMO_TEMPLATE_REPO);
  if (!landing?.ok) return null;
  const factory = landing.data.issues.find((issue) => issue.number === DEMO_FACTORY_ISSUE);
  if (factory?.state !== "closed" || !factory.closedAt) return null;
  const [repo] = pickAutoAddRepos({
    enabled,
    login: DEMO_AUTO_ADD_REPO.owner,
    watched: DEMO_REPOS,
    templates: [{ owner: landing.owner, repo: landing.repo }],
    removed: [],
    candidates: [
      {
        name: `${DEMO_AUTO_ADD_REPO.owner}/${DEMO_AUTO_ADD_REPO.repo}`,
        template: `${landing.owner}/${landing.repo}`,
      },
    ],
  });
  return repo ? { repo, at: factory.closedAt } : null;
}

/** 自動で足したリポジトリ（morning-card）のデータ：工場が作ったばかりで、最初の Issue を企画中 */
export function demoAutoAddResult(at: string): RepoResult {
  const ctx = createCtx(DEMO_AUTO_ADD_REPO, new Date(at), 3000);
  ctx.data.pipeline = "running";
  addIssue(ctx, 1, "最初の画面を作る", { createdAt: ago(ctx, 0), labels: ["ai:plan"] });
  return { ...DEMO_AUTO_ADD_REPO, ok: true, data: { ...ctx.data, runs: demoRuns(ctx.data, new Date(at)) } };
}

/** ランプの「止まっているかも」（赤）の見本：ラベルは実装中のまま、実行が動いていない（landing-page） */
const DEMO_STALLED = [16];

/**
 * デモの Actions の実行：AIの番の段階（公開中を除く）の Issue ごとに、実行中の実行を1つ作る（ランプの緑）。
 * stalled の番号は作らない（ラベルだけが残った見本）
 */
function demoRuns(data: RepoData, base: Date, stalled: number[] = []): WorkflowRunData[] {
  const updatedAt = new Date(base.getTime() - MINUTE_MS).toISOString();
  return data.issues
    .filter((issue) => shouldShowIssue(issue, data.pulls) && !stalled.includes(issue.number))
    .map((issue) => ({ issue, status: getIssueStatus(issue, data, base) }))
    .filter(
      ({ status }) =>
        (isRunningStage(status.stage, status.grace) || status.turn === "ai") && status.stage !== "deploying",
    )
    .map(({ issue, status }) => ({
      // Slots & Queue の Running の見本：実行の番号・ワークフローの名前・始まった時刻（「今」からの相対）
      id: 900_000 + issue.number,
      status: "in_progress",
      headBranch: `claude/issue-${issue.number}-demo`,
      displayTitle: issue.title,
      pullNumbers: [],
      updatedAt,
      name: DEMO_RUN_NAMES[status.stage] ?? "Pipeline",
      startedAt: new Date(base.getTime() - ((issue.number % 5) * 6 + 3) * MINUTE_MS).toISOString(),
    }));
}

/** デモの実行のワークフローの名前（段階ごと） */
const DEMO_RUN_NAMES: Partial<Record<Stage, string>> = {
  planning: "Claude Plan",
  implementing: "Claude Implement",
  ciRunning: "CI",
  ciFailed: "Claude Mention",
  reviewing: "Claude Review",
  fixing: "Claude Mention",
};

/**
 * デモで「あなたの番」のボタンを押した：押した操作を覚える（データには buildDemoResults が当てる）。
 * 再生で進む1件のボタンは、再生を1段階進める（docs/spec.md の「デモ」）
 */
export function pressDemo(
  playback: DemoPlayback,
  target: { owner: string; repo: string; number: number },
  kind: OperationKind,
  answer?: string,
): DemoPlayback {
  const [todo] = DEMO_REPOS;
  if (target.owner === todo.owner && target.repo === DEMO_PLAY_ISSUE.repo && target.number === DEMO_PLAY_ISSUE.number) {
    return advancePlayback(playback);
  }
  const op = { ...target, kind, at: playback.now, ...(answer === undefined ? {} : { answer }) };
  return { ...playback, ops: [...playback.ops, op] };
}

/** デモで「Issueを書く」を押した：サンプルのデータにIssueが増える（ラベルは付かない。GitHub には何も送らない） */
export function createDemoIssue(
  playback: DemoPlayback,
  target: WatchedRepo,
  issue: { title: string; body: string },
): DemoPlayback {
  const op = { ...target, number: 0, kind: "newIssue" as const, at: playback.now, issue };
  return { ...playback, ops: [...playback.ops, op] };
}
