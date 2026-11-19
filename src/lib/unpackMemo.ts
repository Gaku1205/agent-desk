// 縮めて覚えた物（`packCached`）の展開（gunzip と JSON の解析）を、同じ中身なら使い回す。
// 画面の作り直しのたびに、変わっていないリポジトリの分まで展開し直していたため（docs/spec.md の「データの取得」の「作り直しでの使い回し」）

/** 使い回す最大の数（リポジトリ数＋印が進んだ分の余裕。超えたら古い物から捨てる） */
export const UNPACK_MEMO_LIMIT = 50;

export type UnpackMemo<T> = Map<string, { packed: string; value: T }>;

/**
 * `key` で前に展開した物があり、縮めた文字列が同じなら、その結果を返す（展開しない）。
 * 文字列が違えば（寿命が切れて読み直した・別のインスタンスが書き直した）展開し直して覚える。
 * 比べるのは縮めた文字列そのもの（キーが同じでも中身が違えば使い回さないので、古い物が出ることは無い）
 */
export function unpackMemoized<T>(memo: UnpackMemo<T>, key: string, packed: string, unpack: (packed: string) => T): T {
  const known = memo.get(key);
  if (known && known.packed === packed) {
    // 新しい順に並べ直す（捨てるのは古い物から）
    memo.delete(key);
    memo.set(key, known);
    return known.value;
  }
  const value = unpack(packed);
  memo.delete(key);
  memo.set(key, { packed, value });
  while (memo.size > UNPACK_MEMO_LIMIT) {
    const oldest = memo.keys().next().value;
    if (oldest === undefined) break;
    memo.delete(oldest);
  }
  return value;
}
