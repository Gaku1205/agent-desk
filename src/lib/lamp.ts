import type { CommentData, WorkflowRunData } from "./github/types";

/**
 * 「いまの様子」の行の左に付けるランプ（docs/spec.md の「ランプ」）。
 * 緑＝動作中、赤＝人間の手が必要、紫の数字＝順番待ち、何も出さない、の4つ。
 * 優先は 緑 > 赤 > 紫。ラベルだけでは緑にしない
 */

export type LampKind = "running" | "needsHuman" | "waiting" | "none";

export type Lamp =
  | { kind: "running" }
  | { kind: "needsHuman" }
  /** position：いま待っている物の中での位置（1 が次に動く） */
  | { kind: "waiting"; position: number }
  | { kind: "none" };

/** 実行がこれだけ動いていないのに、進行中のラベルが付いたままなら「止まっているかも」（赤） */
export const LAMP_STALE_MS = 10 * 60 * 1000;

/** 人間の手が要るラベル */
const HUMAN_LABELS = ["ai:stuck", "ai:question", "ai:hold"];
/** 進行中のラベル（実行が動いているはずの物） */
const PROGRESS_LABELS = ["ai:plan", "ai:implement", "ai:review"];
/** 自動のやり直しの待ち時間（実行が無くても動作中として扱う） */
const RETRY_LABEL = "ai:retry";
/** 順番待ちのラベル（`ai:queue` が先、`ai:blocked` がその後） */
const QUEUE_LABEL = "ai:queue";
const BLOCKED_LABEL = "ai:blocked";

const HUMAN_REQUEST_MARK = "<!-- human-request -->";

/** その Issue・PR に関する Actions の実行のまとめ。取れなかったときは null */
export type RunActivity = {
  /** いま実行中か待機中の物がある */
  active: boolean;
  /** 関わる実行の最後の更新（`updated_at`）。1つも無ければ null */
  lastUpdatedAt: string | null;
};

export type LampInput = {
  /** Issue と紐づく PR のラベル */
  labels: string[];
  /** 清書AIの「お願いのコメント」（`<!-- human-request -->`）があり、そのあと人のコメントがまだ無い */
  humanRequest: boolean;
  /** 終わった物（閉じた Issue・マージ済みの PR）。動いていなければ何も出さない */
  done: boolean;
  /** その Issue・PR に関する実行。取れなかったときは null（緑にも「止まっているかも」の赤にもしない） */
  runs: RunActivity | null;
  /** Issue・PR が最後に変わった時刻（ラベルを付けた直後を「止まっている」としないため）。無ければ null */
  touchedAt: string | null;
  now: Date;
  /** CI失敗のあと、パイプラインが自動で直している途中（`ciFailureState` が動いている）。実行が見えなくても緑 */
  autoFixing?: boolean;
  /** CI失敗で、修正の上限に達して止まった（`ciFailureState` が `stopped`）。関わる実行が動いていても赤（文・印・線を合わせる） */
  ciStopped?: boolean;
};

/** ランプの種類を決める（待ち順は `assignLamps` で付ける） */
export function judgeLamp(input: LampInput): LampKind {
  const labels = new Set(input.labels);
  // CI失敗で止まった物は、関わる実行が動いていても赤（文「CI失敗・修正の上限」と印を合わせる。終わった物は除く）
  if (input.ciStopped && !input.done) return "needsHuman";
  // いま動いているなら、過去にエラーで止まっていても緑（最新の状態を優先）
  if (input.runs?.active) return "running";
  if (input.done) return "none";
  if (labels.has(RETRY_LABEL)) return "running";
  if (input.autoFixing) return "running";
  if (HUMAN_LABELS.some((label) => labels.has(label)) || input.humanRequest) return "needsHuman";
  if (input.runs !== null && PROGRESS_LABELS.some((label) => labels.has(label)) && isStale(input)) {
    return "needsHuman";
  }
  if (labels.has(QUEUE_LABEL) || labels.has(BLOCKED_LABEL)) return "waiting";
  return "none";
}

/** 実行（と Issue・PR の変化）が10分以上動いていない */
function isStale(input: LampInput): boolean {
  const times = [input.runs?.lastUpdatedAt ?? null, input.touchedAt]
    .filter((at): at is string => at !== null)
    .map((at) => Date.parse(at))
    .filter((ms) => !Number.isNaN(ms));
  // 時刻が1つも無い：ラベルは進行中なのに関わる実行が1つも無いので、止まっている扱い
  if (times.length === 0) return true;
  return input.now.getTime() - Math.max(...times) >= LAMP_STALE_MS;
}

/** 急ぎのラベル。パイプラインは、順番待ち（`ai:queue`）からこれが付いた物を先に始める */
const PRIORITY_LABEL = "priority:high";

/**
 * 順番待ちの並び：`ai:queue` で `priority:high` の物が先、次にほかの `ai:queue`、`ai:blocked` がその後（それぞれ番号順）。
 * パイプラインの始める順（`docs/pipeline.md` の「順番待ちの進め方」）に合わせる。
 * `ai:blocked` は待ち先が閉じるまで動かないので、`priority:high` でも前に出さない
 */
function waitingRank(labels: string[]): number {
  if (!labels.includes(QUEUE_LABEL)) return 2;
  return labels.includes(PRIORITY_LABEL) ? 0 : 1;
}

export type LampTarget = { number: number; labels: string[]; kind: LampKind };

/**
 * 1つのリポジトリの行のランプを決める。紫の数字は、紫になった物の中での位置（1 が次に動く）。
 * 返す Map のキーは Issue 番号
 */
export function assignLamps(targets: LampTarget[]): Map<number, Lamp> {
  const waiting = targets
    .filter((target) => target.kind === "waiting")
    .sort((a, b) => waitingRank(a.labels) - waitingRank(b.labels) || a.number - b.number);
  const positions = new Map(waiting.map((target, index) => [target.number, index + 1]));
  return new Map(
    targets.map((target): [number, Lamp] => {
      if (target.kind === "waiting") return [target.number, { kind: "waiting", position: positions.get(target.number)! }];
      return [target.number, { kind: target.kind }];
    }),
  );
}

/** 読み上げとホバーの文言（「動作中」「人間の手が必要」「順番待ち 2番目」）。何も出さないときは null */
export function lampLabel(lamp: Lamp): string | null {
  switch (lamp.kind) {
    case "running":
      return "動作中";
    case "needsHuman":
      return "人間の手が必要";
    case "waiting":
      return `順番待ち ${lamp.position}番目`;
    case "none":
      return null;
  }
}

/** 実行が、この Issue（とその PR）に関わるか */
export function isRelatedRun(
  run: WorkflowRunData,
  issueNumber: number,
  pulls: { number: number; headRef: string }[],
): boolean {
  if (run.headBranch?.startsWith(`claude/issue-${issueNumber}-`)) return true;
  if (pulls.some((pull) => pull.headRef !== "" && pull.headRef === run.headBranch)) return true;
  if (run.pullNumbers.some((number) => pulls.some((pull) => pull.number === number))) return true;
  const numbers = [issueNumber, ...pulls.map((pull) => pull.number)];
  return numbers.some((number) => new RegExp(`#${number}(?!\\d)`).test(run.displayTitle));
}

/** 取得した実行のうち、この Issue（とその PR）に関わる物をまとめる。実行が取れなかった（null）ときは null */
export function runActivity(
  runs: WorkflowRunData[] | null | undefined,
  issueNumber: number,
  pulls: { number: number; headRef: string }[],
): RunActivity | null {
  if (!runs) return null;
  let active = false;
  let lastUpdatedAt: string | null = null;
  for (const run of runs) {
    if (!isRelatedRun(run, issueNumber, pulls)) continue;
    if (run.status === "in_progress" || run.status === "queued") active = true;
    if (lastUpdatedAt === null || run.updatedAt > lastUpdatedAt) lastUpdatedAt = run.updatedAt;
  }
  return { active, lastUpdatedAt };
}

/** 清書AIの「お願いのコメント」があり、そのあとに人（作者が `…[bot]` でない）のコメントがまだ無い */
export function hasOpenHumanRequest(comments: CommentData[], numbers: number[]): boolean {
  const mine = comments.filter((comment) => numbers.includes(comment.issueNumber));
  const request = mine
    .filter((comment) => comment.author === "claude[bot]" && comment.body.includes(HUMAN_REQUEST_MARK))
    .reduce<string | null>((latest, comment) => (latest === null || comment.createdAt > latest ? comment.createdAt : latest), null);
  if (request === null) return false;
  return !mine.some((comment) => !comment.author.endsWith("[bot]") && comment.createdAt > request);
}
