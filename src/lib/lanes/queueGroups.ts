import { ciStepText } from "../ciProgress";
import { FLOW_STEPS } from "../flow";
import type { QueueEntry } from "./slots";
import type { SlotWork, WaitTarget } from "./source";

/**
 * Queue を待つ相手ごとのまとまりにする（docs/spec.md の「Queue」の「待つ相手ごとのまとまり」。Issue #586）。
 * 待つ相手と理由の判定（`buildLanesSource` の `cause`・`waitFors`）は変えず、今の材料だけで分ける
 */

/**
 * まとまりの種類：
 * `work`＝1つの動いている作業を待つ／`multi`＝2つ以上の相手を待つ（`#A + #B`）／
 * `idle`＝動いてもいないし Queue にもいない相手（企画中・マージ待ちの PR など）／`next`＝誰も待たない（`Next free slot`）
 */
export type QueueGroupKind = "work" | "multi" | "idle" | "next";

/** まとまりの縦線の色：`running`＝`--ok`、`queue`＝`--wait`（相手が Queue にいる）、`idle`＝`--edge-strong` */
export type QueueGroupTone = "running" | "queue" | "idle";

/** まとまりの中の1行（子の行） */
export type QueueGroupRow = {
  entry: QueueEntry;
  /** まとまり（2段目は、ぶら下がる1段目の行）の中の番号（1から） */
  order: number;
  /** 段（1＝親の下、2＝ほかの子の行の下にぶら下がる） */
  depth: 1 | 2;
  /** 2段目の行が待つ Queue の作業の番号（`#556 のあと`）。1段目は null */
  after: number | null;
};

export type QueueGroup = {
  key: string;
  kind: QueueGroupKind;
  /** 相手のリポジトリ（子の行と同じ。`next` は先頭の子の行の物） */
  owner: string;
  repo: string;
  /** 待つ相手（番号の小さい順。Issue が先、PR があと。`next` は空） */
  targets: WaitTarget[];
  /** `work` のときの相手の作業（親の行の工程の文に使う） */
  work: SlotWork | null;
  tone: QueueGroupTone;
  rows: QueueGroupRow[];
};

/** 2つ以上の相手を待つ親の行の真ん中の文 */
export function multiWaitText(count: number): string {
  return `${count}つとも終わるのを待つ`;
}

/** 誰も待たないまとまりの親の行の真ん中の文 */
export const NEXT_FREE_TEXT = "席が空いたら入る";

/** 親の行の右の、相手の今の工程の文（Slots の使っている枠の行と同じ文） */
export function workStepText(work: SlotWork): string {
  return work.ci ? ciStepText(work.stepAt, FLOW_STEPS.length, work.ci) : work.stepText;
}

/** 相手の番号の書き方（`#553`・`PR #36`） */
export function targetLabel(target: Pick<WaitTarget, "kind" | "number">): string {
  return target.kind === "pull" ? `PR #${target.number}` : `#${target.number}`;
}

/** 子の行の番号とファイル（`agent-desk#556 · TopBar.tsx`。2段目は `agent-desk#590 · #556 のあと`） */
export function queueRowMeta(row: QueueGroupRow): string {
  const ref = `${row.entry.repo}#${row.entry.number}`;
  if (row.after !== null) return `${ref} · #${row.after} のあと`;
  if (row.entry.file === null) return ref;
  const name = row.entry.file.replace(/\/+$/, "").split("/").pop() || row.entry.file;
  return `${ref} · ${name}`;
}

/** 子の行の `title`（全体の順と理由の文） */
export function queueRowTitle(entry: QueueEntry): string {
  return `全体で ${entry.rank}番目 · ${entry.reason}`;
}

function repoKey(item: { owner: string; repo: string }): string {
  return `${item.owner}/${item.repo}`;
}

function workTarget(work: SlotWork): WaitTarget {
  return { kind: "issue", number: work.number, title: work.title, running: true, issueNumber: work.number, url: work.url };
}

function compareTargets(a: WaitTarget, b: WaitTarget): number {
  return Number(a.kind === "pull") - Number(b.kind === "pull") || a.number - b.number;
}

/** 順番待ちの順番待ち：相手が1つだけで、同じリポジトリの Queue にいれば、その作業 */
function queueParents(queue: readonly QueueEntry[]): Map<string, QueueEntry> {
  const byKey = new Map(queue.map((entry) => [entry.key, entry]));
  const parent = new Map<string, QueueEntry>();
  for (const entry of queue) {
    if (entry.waitFors.length !== 1) continue;
    const target = entry.waitFors[0];
    if (target.kind !== "issue" || target.running) continue;
    const found = byKey.get(`${repoKey(entry)}#${target.number}`);
    if (found && found.key !== entry.key) parent.set(entry.key, found);
  }
  // 互いを待ち合う（輪になる）物は、輪の中で Queue のいちばん後ろの物の輪を切る
  for (const entry of queue) {
    const chain = [entry];
    for (;;) {
      const next = parent.get(chain[chain.length - 1].key);
      if (!next) break;
      const at = chain.findIndex((item) => item.key === next.key);
      if (at >= 0) {
        const last = chain.slice(at).reduce((a, b) => (b.rank > a.rank ? b : a));
        parent.delete(last.key);
        break;
      }
      chain.push(next);
    }
  }
  return parent;
}

/** 1段目の行が待つ相手（触るファイルの印が無い物は、同じリポジトリの動いている作業すべて） */
function targetsOf(entry: QueueEntry, works: readonly SlotWork[]): WaitTarget[] {
  if (entry.waitFors.length > 0) return [...entry.waitFors].sort(compareTargets);
  if (entry.reasonKind === "noTouches") {
    return works.filter((work) => repoKey(work) === repoKey(entry)).map(workTarget).sort(compareTargets);
  }
  return [];
}

type Draft = { group: QueueGroup; progress: number; first: number };

/**
 * Queue の行を、待つ相手ごとのまとまりにする。並びは、相手の工程が先に進んでいる物ほど上
 * （同じなら親の番号の小さい順。相手が動いていない物は後ろ）、`Next free slot` は最後
 */
export function queueGroups(queue: readonly QueueEntry[], works: readonly SlotWork[]): QueueGroup[] {
  const sorted = [...queue].sort((a, b) => a.rank - b.rank);
  const parent = queueParents(sorted);
  const rootOf = (entry: QueueEntry): QueueEntry => {
    let current = entry;
    for (let p = parent.get(current.key); p; p = parent.get(current.key)) current = p;
    return current;
  };
  const queued = new Set(sorted.map((entry) => entry.key));
  const findWork = (owner: string, repo: string, target: WaitTarget) =>
    target.kind === "issue"
      ? (works.find((work) => work.owner === owner && work.repo === repo && work.number === target.number) ?? null)
      : null;

  const drafts = new Map<string, Draft>();
  for (const entry of sorted) {
    if (parent.has(entry.key)) continue;
    const targets = targetsOf(entry, works);
    const id = targets.length === 0 ? "next" : `${repoKey(entry)}|${targets.map((t) => `${t.kind}:${t.number}`).join(",")}`;
    let draft = drafts.get(id);
    if (!draft) {
      const found = targets.map((target) => findWork(entry.owner, entry.repo, target));
      const running = found.filter((work): work is SlotWork => work !== null);
      let kind: QueueGroupKind;
      let tone: QueueGroupTone;
      if (targets.length === 0) {
        kind = "next";
        tone = "idle";
      } else if (targets.length === 1 && running.length === 1) {
        kind = "work";
        tone = "running";
      } else if (targets.length === 1) {
        kind = "idle";
        tone = targets[0].kind === "issue" && queued.has(`${repoKey(entry)}#${targets[0].number}`) ? "queue" : "idle";
      } else {
        kind = "multi";
        tone = running.length === targets.length ? "running" : "idle";
      }
      draft = {
        group: {
          key: id,
          kind,
          owner: entry.owner,
          repo: entry.repo,
          targets,
          work: kind === "work" ? running[0] : null,
          tone,
          rows: [],
        },
        progress: kind === "next" ? -2 : running.length > 0 ? Math.max(...running.map((work) => work.stepAt)) : -1,
        first: targets.length === 0 ? Number.MAX_SAFE_INTEGER : Math.min(...targets.map((t) => t.number)),
      };
      drafts.set(id, draft);
    }
    const rows = draft.group.rows;
    rows.push({ entry, order: rows.filter((row) => row.depth === 1).length + 1, depth: 1, after: null });
    let nested = 0;
    for (const child of sorted) {
      const direct = parent.get(child.key);
      if (!direct || rootOf(child).key !== entry.key) continue;
      nested += 1;
      rows.push({ entry: child, order: nested, depth: 2, after: direct.number });
    }
  }

  return [...drafts.values()]
    .sort(
      (a, b) =>
        b.progress - a.progress ||
        a.first - b.first ||
        a.group.targets.length - b.group.targets.length ||
        a.group.key.localeCompare(b.group.key),
    )
    .map((draft) => draft.group);
}
