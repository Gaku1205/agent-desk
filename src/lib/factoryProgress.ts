import { formatEventTime } from "./events";
import { factoryBuildJob, factoryStage } from "./factoryStage";
import {
  decodeFactoryMark,
  FACTORY_BOT,
  FACTORY_STAGES,
  isFactoryTalkComment,
  parseFactoryAnswer,
  type FactoryStage,
} from "./factoryTalk";
import type { CommentData, RunStepData, WorkflowRunData } from "./github/types";
import { isOwnerAuthor } from "./question";
import { formatDuration } from "./stepLog";

/**
 * 工場の Issue（`新サービス：`）の進捗図：工場の段ごとの状態・時刻・所要時間（docs/spec.md の「工場の進捗図」）。
 * 段の判定は `factoryStage`、時刻は工場の相談のコメント（`factory-talk:v1` の印）と Actions の実行から求める
 */

export type FactoryStepKey = FactoryStage | "repo" | "design" | "build" | "deploy";

/** 済み・動いている・相談待ち（Your turn の色）・まだ */
export type FactoryStepState = "done" | "running" | "waiting" | "pending";

export type FactoryProgressStep = {
  key: FactoryStepKey;
  name: string;
  state: FactoryStepState;
  /** 始まった時刻（`16:57`。出せなければ null） */
  started: string | null;
  /** 相談の待ち（`3分`。無ければ null） */
  wait: string | null;
  /** AI の作業（`9分`。無ければ null） */
  work: string | null;
};

export type FactoryProgress = {
  steps: FactoryProgressStep[];
  /** 工場が作った新しいリポジトリ（`owner/name`）とそのページ。まだ無ければ null */
  repo: { name: string; url: string } | null;
};

export type FactoryProgressInput = {
  /** 工場のあるリポジトリ（テンプレート）の owner と repo。オーナーの答えと、「新しいリポジトリ」から外す物を決める */
  owner: string;
  repo: string;
  issue: { number: number; state: "open" | "closed"; labels: string[]; createdAt: string; closedAt?: string | null };
  comments: CommentData[];
  runs?: WorkflowRunData[] | null;
  runSteps?: RunStepData[];
  now: Date;
};

const NAMES: Record<FactoryStepKey, string> = {
  ideas: "案",
  looks: "見た目の方向",
  mocks: "画面案",
  confirm: "最終確認",
  repo: "リポジトリ",
  design: "デザイン",
  build: "作る",
  deploy: "公開",
};

const BUILD_KEYS: FactoryStepKey[] = ["repo", "design", "build", "deploy"];

/** 本番（`Factory`）のジョブ名から、段 */
function stepOfJob(job: string | null): FactoryStepKey {
  switch (job) {
    case "design":
    case "design-pick":
      return "design";
    case "build":
      return "build";
    case "deploy":
      return "deploy";
    default:
      return "repo";
  }
}

/** 所要時間：`9分`・`1時間2分`・`1分未満`。負・読めなければ null（0は出さない） */
export function progressDuration(ms: number): string | null {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  if (ms < 60_000) return "1分未満";
  return formatDuration(Math.floor(ms / 60_000) * 60_000);
}

function time(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

type Event =
  | { kind: "card"; at: number; stage: FactoryStage }
  | { kind: "answer"; at: number; action: string | null }
  | { kind: "go"; at: number };

type Acc = { started: number | null; wait: number; work: number };

function events(comments: CommentData[], issueNumber: number, owner: string): Event[] {
  const list: Event[] = [];
  for (const comment of [...comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (comment.issueNumber !== issueNumber) continue;
    const at = time(comment.createdAt);
    if (at === null) continue;
    if (comment.author === FACTORY_BOT) {
      const state = decodeFactoryMark(comment.body);
      if (state === null) continue;
      const stage = typeof state.stage === "string" ? state.stage.trim() : "";
      if (stage === "go") list.push({ kind: "go", at });
      else if ((FACTORY_STAGES as readonly string[]).includes(stage)) list.push({ kind: "card", at, stage: stage as FactoryStage });
    } else if (isOwnerAuthor(comment.author, owner)) {
      const reply = parseFactoryAnswer(comment.body);
      list.push({ kind: "answer", at, action: reply === null || reply === "invalid" ? null : reply.action });
    }
  }
  return list;
}

const REPO_URL = /https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)\/([A-Za-z0-9._-]+)/g;
const NOT_OWNER = new Set(["orgs", "settings", "apps", "features", "marketplace", "topics", "sponsors", "login"]);

/**
 * 工場が作った新しいリポジトリ：工場（`github-actions[bot]`）の、相談の印が無いコメント（結果の報告）の中の
 * `https://github.com/owner/name`。工場のあるリポジトリ自身は外す。いちばん新しいコメントの最初の1つ
 */
export function findNewRepo(
  comments: CommentData[],
  issueNumber: number,
  own: { owner: string; repo: string },
): { name: string; url: string } | null {
  const reports = comments
    .filter((c) => c.issueNumber === issueNumber && c.author === FACTORY_BOT && !isFactoryTalkComment(c))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const comment of reports) {
    for (const match of comment.body.matchAll(REPO_URL)) {
      const owner = match[1];
      const name = match[2].replace(/\.git$/, "").replace(/\.+$/, "");
      if (name === "" || NOT_OWNER.has(owner.toLowerCase())) continue;
      if (owner.toLowerCase() === own.owner.toLowerCase() && name.toLowerCase() === own.repo.toLowerCase()) continue;
      return { name: `${owner}/${name}`, url: `https://github.com/${owner}/${name}` };
    }
  }
  return null;
}

export function factoryProgress(input: FactoryProgressInput): FactoryProgress {
  const now = input.now.getTime();
  const list = events(input.comments, input.issue.number, input.owner);
  const phase = factoryStage({
    labels: input.issue.labels,
    state: input.issue.state,
    runs: input.runs,
    runSteps: input.runSteps,
  });
  const closed = input.issue.state === "closed";

  // 相談の段ごとの、始まりと待ち・AI の作業（カードが出るまでが AI の作業、答えが付くまでが相談の待ち）
  const acc = new Map<FactoryStepKey, Acc>();
  const at = (key: FactoryStepKey): Acc => {
    const found = acc.get(key) ?? { started: null, wait: 0, work: 0 };
    acc.set(key, found);
    return found;
  };
  let trigger = time(input.issue.createdAt) ?? list[0]?.at ?? now;
  let pending: { stage: FactoryStage; at: number } | null = null;
  let lastCard: FactoryStage | null = null;
  let lastAnswer: string | null = null;
  let goAt: number | null = null;
  const cards = new Set<FactoryStage>();
  for (const event of list) {
    if (event.kind === "card") {
      const a = at(event.stage);
      a.started ??= trigger;
      a.work += Math.max(0, event.at - trigger);
      pending = { stage: event.stage, at: event.at };
      trigger = event.at;
      lastCard = event.stage;
      lastAnswer = null;
      cards.add(event.stage);
    } else if (event.kind === "answer") {
      if (!pending) continue;
      at(pending.stage).wait += Math.max(0, event.at - pending.at);
      trigger = event.at;
      lastAnswer = event.action ?? "text";
      pending = null;
    } else {
      goAt ??= event.at;
    }
  }

  const mocksShown = cards.has("mocks") || !cards.has("confirm");
  const order: FactoryStepKey[] = [
    "ideas",
    "looks",
    ...(mocksShown ? (["mocks"] as FactoryStepKey[]) : []),
    "confirm",
    ...BUILD_KEYS,
  ];
  const talkOrder = order.filter((key): key is FactoryStage => (FACTORY_STAGES as readonly string[]).includes(key));

  // 今の段
  const buildStarted = closed || goAt !== null || lastAnswer === "go" || phase.kind === "building" || phase.kind === "done";
  let current: FactoryStepKey | null = null;
  let currentState: FactoryStepState = "running";
  if (closed || phase.kind === "done") {
    current = null;
  } else if (phase.kind === "building") {
    current = stepOfJob(factoryBuildJob(input.runs, input.runSteps));
  } else if (buildStarted) {
    current = phase.kind === "unknown" ? null : "repo";
  } else if (phase.kind === "waiting") {
    current = lastCard ?? "ideas";
    currentState = "waiting";
  } else if (phase.kind === "working") {
    if (lastCard === null) current = "ideas";
    else if (pending !== null || lastAnswer === "redo" || lastAnswer === "text") current = lastCard;
    else current = talkOrder[talkOrder.indexOf(lastCard) + 1] ?? "repo";
  }
  const allDone = closed || phase.kind === "done";
  const unknownDone = !allDone && current === null; // 段が決められない：相談したところまでを済みにする
  const currentIndex = current === null ? -1 : order.indexOf(current);

  // 動いている・待っている段の、今までの経過
  if (current !== null && (BUILD_KEYS as string[]).indexOf(current) < 0) {
    const a = at(current);
    if (currentState === "waiting" && pending) {
      a.wait += Math.max(0, now - pending.at);
    } else if (currentState === "running") {
      a.started ??= trigger;
      a.work += Math.max(0, now - trigger);
    }
  }

  // 本番の時刻：実行の始まり（リポジトリの段の始まり）と、終わり（公開の時刻）。段ごとには分けられないので、作るの AI の作業に全体を入れる
  const build = (input.runs ?? [])
    .filter((run) => run.name === "Factory")
    .sort((a, b) => (b.startedAt ?? b.updatedAt).localeCompare(a.startedAt ?? a.updatedAt))[0];
  const buildStart = time(build?.startedAt) ?? goAt;
  const buildEnd = build && build.status === "completed" ? time(build.updatedAt) : null;

  const steps = order.map((key, index): FactoryProgressStep => {
    const state: FactoryStepState = allDone
      ? "done"
      : currentIndex >= 0
        ? index < currentIndex
          ? "done"
          : index === currentIndex
            ? currentState
            : "pending"
        : unknownDone && (cards.has(key as FactoryStage) || (cards.size > 0 && index < order.indexOf(lastCard ?? "ideas")))
          ? "done"
          : unknownDone && buildStarted && !(BUILD_KEYS as string[]).includes(key)
            ? "done"
            : "pending";
    const a = acc.get(key);
    let started: number | null = a?.started ?? null;
    let wait = a?.wait ?? 0;
    let work = a?.work ?? 0;
    if (key === "repo" && state !== "pending") started = buildStart;
    if (key === "deploy" && state === "done") started = buildEnd;
    if (key === "build" && state === "done" && buildStart !== null && buildEnd !== null) work = buildEnd - buildStart;
    if (state === "pending") {
      started = null;
      wait = 0;
      work = 0;
    }
    return {
      key,
      name: NAMES[key],
      state,
      started: started === null ? null : formatEventTime(new Date(started).toISOString()),
      wait: progressDuration(wait),
      work: progressDuration(work),
    };
  });

  return { steps, repo: findNewRepo(input.comments, input.issue.number, { owner: input.owner, repo: input.repo }) };
}

const STATE_LABEL: Record<FactoryStepState, string> = {
  done: "済み",
  running: "進行中",
  waiting: "Your turn",
  pending: "まだ",
};

/** 1つの段の、2行目の文：`待ち 3分 · AI 9分`。何も出せなければ null */
export function factoryStepSub(step: FactoryProgressStep): string | null {
  const parts = [step.wait && `待ち ${step.wait}`, step.work && `AI ${step.work}`].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** 読み上げ：`最終確認　Your turn　開始 10:01　待ち 3分　AI 9分` */
export function factoryStepLabel(step: FactoryProgressStep): string {
  return [
    step.name,
    STATE_LABEL[step.state],
    step.started ? `開始 ${step.started}` : null,
    step.wait ? `待ち ${step.wait}` : null,
    step.work ? `AI ${step.work}` : null,
  ]
    .filter(Boolean)
    .join("　");
}
