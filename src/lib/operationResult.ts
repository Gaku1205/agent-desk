import { turnItemKey, type OperationKind, type TurnItem } from "./turn";

/** 押したあとの結果を見せておく長さ（docs/design.md の「押したあとの結果」） */
export const RESULT_SHOW_MS = 2400;
/** 結果を消すフェードの長さ */
export const RESULT_FADE_MS = 150;

/** 1つの操作の、押している間・していること・結果の文言 */
export type OperationCopy = {
  /** 押している間のボタンの文字 */
  busy: string;
  /** 押している間、説明文の所に出す文 */
  doing: string;
  /** 通ったあとの結果 */
  done: string;
};

/** 文言の一覧（docs/design.md の「押したあとの結果」の表と同じ） */
export const OPERATION_COPY: Record<OperationKind, OperationCopy> = {
  plan: { busy: "おまかせ中…", doing: "GitHub に ai:plan を付けています", done: "おまかせしました" },
  implement: { busy: "依頼中…", doing: "GitHub に ai:implement を付けています", done: "実装を依頼しました" },
  resume: { busy: "再開中…", doing: "GitHub で ai:stuck を外しています", done: "再開しました" },
  start: { busy: "開始中…", doing: "GitHub で ai:skip を外しています", done: "始めました" },
  createPull: { busy: "作成中…", doing: "GitHub で PR を作っています", done: "PRを作りました" },
  requestReview: { busy: "依頼中…", doing: "GitHub に ai:review を付けています", done: "レビューを依頼しました" },
  merge: { busy: "マージ中…", doing: "GitHub でマージしています", done: "マージしました" },
  answer: { busy: "送信中…", doing: "GitHub にコメントを書いています", done: "送りました" },
};

/** 結果の1行に出す物 */
export type DoneSummary = {
  /** `マージしました` など */
  title: string;
  /** マージした PR（マージのときだけ。`PR #番号 ↗`） */
  pull: { number: number; url: string } | null;
  /** マージで動き出す物（`#12 が動き出します`。無ければ null） */
  starts: string | null;
};

/** 動き出す Issue の番号から、`#15・#14 が動き出します` の文（無ければ null） */
export function startsText(numbers: readonly number[] | undefined): string | null {
  if (!numbers || numbers.length === 0) return null;
  return `${numbers.map((n) => `#${n}`).join("・")} が動き出します`;
}

/** 操作が通ったあとに出す結果 */
export function doneSummary(
  kind: OperationKind,
  item: Pick<TurnItem, "issue" | "status" | "merge" | "blocking" | "pullOnly">,
): DoneSummary {
  const title = OPERATION_COPY[kind].done;
  if (kind !== "merge") return { title, pull: null, starts: null };
  const number = item.merge?.pullNumber ?? (item.pullOnly ? item.issue.number : item.status.pull?.number);
  const url = item.pullOnly ? item.issue.url : item.status.pull?.url;
  return {
    title,
    pull: number !== undefined && url ? { number, url } : null,
    starts: startsText(item.blocking),
  };
}

/** 押してから片づけるまで預かる1行：押した時点の中身と、並びの位置、結果を出し始めたか */
export type HeldRow<T> = { item: T; index: number; done: boolean };

/**
 * 預かる行の位置を決める。すでに預かっている行は押した時点の位置のまま（`done` が変わっても、
 * 取り直した並びから行が消えていても動かさない）。初めて預かるときは並びでの位置（無ければ 0）
 */
export function heldIndex<T extends Pick<TurnItem, "owner" | "repo" | "issue">>(
  before: HeldRow<T> | undefined,
  rows: readonly T[],
  key: string,
): number {
  if (before) return before.index;
  return Math.max(
    rows.findIndex((row) => turnItemKey(row) === key),
    0,
  );
}

/**
 * 預かっている行を、取り直した並びに戻す（docs/spec.md の「押したあとの手応え」）。
 * 並びにまだある行は押した時点の中身に置き換え、取り直しで消えた行は押した時点の位置に差し込む
 */
export function withHeldRows<T extends Pick<TurnItem, "owner" | "repo" | "issue">>(
  items: readonly T[],
  held: ReadonlyMap<string, HeldRow<T>>,
): T[] {
  if (held.size === 0) return [...items];
  const present = new Set(items.map(turnItemKey));
  const rows = items.map((item) => held.get(turnItemKey(item))?.item ?? item);
  const missing = [...held.entries()]
    .filter(([key]) => !present.has(key))
    .sort((a, b) => a[1].index - b[1].index);
  for (const [, row] of missing) {
    rows.splice(Math.min(Math.max(row.index, 0), rows.length), 0, row.item);
  }
  return rows;
}
