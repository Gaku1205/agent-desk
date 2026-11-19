// 「覚えている物をすぐ出し、読めた所から順に入れ替える」ための段の列（docs/spec.md の「全部のリポジトリを待つページ」）。
// サーバーが段を1つずつ作り、画面は届いた段で入れ替える。ここは時刻と待ちを外から渡せる純粋な部分。

/** 1つの段：その時点の中身と、次の段（もう無ければ null） */
export type Step<T> = { value: T; next: Promise<Step<T>> | null };

/** 取得元1つ（リポジトリ1つ）：新しい結果と、覚えている古い結果（無ければ null。新しい結果が遅いときだけ読む） */
export type StepSource<R> = { fresh: Promise<R>; stale: () => Promise<R | null> };

/**
 * その時点で出せる物：取得元ごとの結果（まだ無ければ null）と、古い物を出している数・まだ無い数。
 * `isFailed` を渡したときだけ、取得元ごとの新しい結果と古い結果（`loads`。まだ・無ければ null）も付ける
 */
export type Gathered<R> = {
  results: (R | null)[];
  staleCount: number;
  missingCount: number;
  loads?: { fresh: R | null; stale: R | null }[];
};

export type GatherOptions<R = unknown> = {
  /** 新しい結果をここまで待つ（ms）。過ぎたら、まだの所は覚えている古い結果を読む */
  deadlineMs: number;
  /** 古い結果を読み始めてから、最初の段を出すまでに待つ上限（ms） */
  graceMs: number;
  /** 次の段を出す前に、続けて届く分をまとめる時間（ms） */
  batchMs: number;
  /** ms だけ待つ（テストで差し替える） */
  wait: (ms: number) => Promise<void>;
  /**
   * 新しい結果が失敗か（読めなかった）。渡したときは、失敗で届いた所の古い結果をすぐ読み、あればそれを出し続ける
   * （最後の段でも。docs/spec.md の「取り直しが失敗で終わったリポジトリ」）。古い結果を読み終えるまで、その所は「まだ」の扱い
   */
  isFailed?: (value: R) => boolean;
};

export const DEFAULT_GATHER: Omit<GatherOptions, "wait" | "isFailed"> = { deadlineMs: 120, graceMs: 150, batchMs: 250 };

/**
 * 取得元を全部同時に待ち、出せる物から段にして返す。
 * - 最初の段：全部の新しい結果がそろうか、`deadlineMs` を過ぎて古い結果を読み終える（最長 `graceMs`）まで待って出す。
 *   その時点で1つも出せる物が無ければ、最初の1つが届くまで待つ（空の中身は出さない）
 * - 次からの段：新しく届いた分を `batchMs` まとめて出す。全部の新しい結果がそろった段が最後（`next` は null）
 * - 新しい結果が届いた所は、古い結果に戻さない。`fresh` は失敗しない約束（失敗は結果の中に入れて返す）
 * - ただし `isFailed` を渡したときは、失敗で届いた所だけ、古い結果があればそれを出し続ける
 */
export function gatherSteps<R>(sources: StepSource<R>[], options: GatherOptions<R>): Promise<Step<Gathered<R>>> {
  const { deadlineMs, graceMs, batchMs, wait, isFailed } = options;
  const fresh: (R | undefined)[] = sources.map(() => undefined);
  const stale: (R | null | undefined)[] = sources.map(() => undefined);
  /** 新しい結果が届いて、失敗だった所か */
  const failedAt = (index: number) => {
    const value = fresh[index];
    return value !== undefined && isFailed !== undefined && isFailed(value);
  };
  /** 古い結果を出している所か（新しい結果がまだ・失敗で、古い結果がある） */
  const staleAt = (index: number) => (fresh[index] === undefined || failedAt(index)) && stale[index] != null;
  const staleReads: (Promise<void> | undefined)[] = sources.map(() => undefined);
  /** 古い結果を読む（1つの取得元につき1回だけ） */
  const readStaleOf = (index: number): Promise<void> =>
    (staleReads[index] ??= sources[index]
      .stale()
      .catch(() => null)
      .then((value) => {
        stale[index] = value;
        if (value !== null && (fresh[index] === undefined || failedAt(index))) changed();
      }));
  let freshLeft = sources.length;
  let version = 0;
  let notify: (() => void) | null = null;
  const changed = () => {
    version++;
    notify?.();
  };
  /** 何かが届くまで待つ */
  const nextChange = () =>
    new Promise<void>((resolve) => {
      notify = () => {
        notify = null;
        resolve();
      };
    });

  // 新しい結果が届いた（失敗なら、古い結果も読み終えた）所から数える
  const settled = sources.map((source, index) =>
    source.fresh.then(async (value) => {
      if (isFailed?.(value)) await readStaleOf(index);
      fresh[index] = value;
      freshLeft--;
      changed();
    }),
  );

  const snapshot = (): Gathered<R> => {
    const results = sources.map((_, index) => (staleAt(index) ? (stale[index] ?? null) : (fresh[index] ?? null)));
    const gathered: Gathered<R> = {
      results,
      staleCount: sources.filter((_, index) => staleAt(index)).length,
      missingCount: results.filter((result) => result === null).length,
    };
    if (isFailed) {
      gathered.loads = sources.map((_, index) => ({ fresh: fresh[index] ?? null, stale: stale[index] ?? null }));
    }
    return gathered;
  };
  const hasAny = () => sources.some((_, index) => fresh[index] !== undefined || stale[index] != null);

  /** まだ新しい結果が無い所の、古い結果を読む。全部読み終えたら終わる */
  const readStale = () =>
    Promise.all(
      sources.map(async (_, index) => {
        if (fresh[index] !== undefined) return;
        await readStaleOf(index);
      }),
    );

  const emit = async (): Promise<Step<Gathered<R>>> => {
    // 出せる物が1つも無い間は待つ
    while (!hasAny() && freshLeft > 0) await nextChange();
    const value = snapshot();
    const emitted = version;
    if (freshLeft === 0) return { value, next: null };
    const next = (async () => {
      // 次に何か届くまで待ち、続けて届く分をまとめる
      while (version === emitted && freshLeft > 0) await nextChange();
      if (freshLeft > 0) await Promise.race([wait(batchMs), allFresh]);
      return emit();
    })();
    return { value, next };
  };

  const allFresh = Promise.all(settled).then(() => undefined);

  return (async () => {
    if (sources.length === 0) return { value: snapshot(), next: null };
    await Promise.race([allFresh, wait(deadlineMs)]);
    if (freshLeft > 0) await Promise.race([allFresh, readStale(), wait(graceMs)]);
    return emit();
  })();
}

/** 段の中身を変える（次の段も同じように変える）。`map` は段ごとに1回だけ呼ぶ */
export async function mapSteps<T, U>(step: Step<T>, map: (value: T, isLast: boolean) => U | Promise<U>): Promise<Step<U>> {
  return {
    value: await map(step.value, step.next === null),
    next: step.next === null ? null : step.next.then((next) => mapSteps(next, map)),
  };
}

/** 段の列の最後に、もう1段足す（`last` が投げたら足さない） */
export function appendStep<T>(step: Step<T>, last: () => Promise<T>): Step<T> {
  if (step.next === null) {
    return {
      value: step.value,
      next: last().then(
        (value) => ({ value, next: null }),
        () => ({ value: step.value, next: null }),
      ),
    };
  }
  return { value: step.value, next: step.next.then((next) => appendStep(next, last)) };
}
