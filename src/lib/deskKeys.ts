/** 決める画面のキー操作（docs/spec.md の「ホーム（決める画面）」） */
export type DeskKeyAction =
  | { type: "choose"; index: number }
  | { type: "answer" }
  | { type: "skip" }
  | { type: "move"; delta: 1 | -1 };

export type DeskKeyInput = {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  isComposing: boolean;
  repeat: boolean;
  /** フォーカス先が入力欄・答えの欄（input・textarea・select・編集できる要素） */
  typing: boolean;
  /** フォーカス先がボタンかリンク（Enter はその物が受ける。選択肢のボタンは除く） */
  onControl: boolean;
};

/**
 * 押されたキーから、決める画面の操作を決める。入力欄に打っている間・修飾キー・変換中・押しっぱなしでは何もしない。
 * `1`〜`9`＝その番の選択肢を選ぶ、`Enter`＝主役のボタン、`S`＝飛ばす、`J`／`K`＝右の列を下／上へ
 */
export function deskKeyAction(input: DeskKeyInput): DeskKeyAction | null {
  const { key, ctrlKey, altKey, metaKey, shiftKey, isComposing, repeat, typing, onControl } = input;
  if (typing || ctrlKey || altKey || metaKey || isComposing || repeat) return null;
  if (/^[1-9]$/.test(key)) return { type: "choose", index: Number(key) - 1 };
  if (key === "Enter") return shiftKey || onControl ? null : { type: "answer" };
  if (shiftKey) return null;
  if (key === "s" || key === "S") return { type: "skip" };
  if (key === "j" || key === "J") return { type: "move", delta: 1 };
  if (key === "k" || key === "K") return { type: "move", delta: -1 };
  return null;
}

/** 並び（キー）の中で、今の物から delta だけ動いた先（端では止まる）。今の物が無ければ先頭 */
export function stepKey(keys: readonly string[], current: string | null, delta: number): string | null {
  if (keys.length === 0) return null;
  const at = current === null ? -1 : keys.indexOf(current);
  if (at < 0) return keys[0];
  const next = Math.min(Math.max(at + delta, 0), keys.length - 1);
  return keys[next];
}

/** マージ待ちの一覧（outside に入っていないキーだけが一覧の外）を飛ばす先：今の物の次の、一覧の外の1件（最後なら先頭へ回る）。無ければ null */
export function skipOutKey(keys: readonly string[], inQueue: ReadonlySet<string>, current: string | null): string | null {
  const at = current === null ? -1 : keys.indexOf(current);
  for (let i = 1; i <= keys.length; i++) {
    const key = keys[(at + i) % keys.length];
    if (!inQueue.has(key)) return key;
  }
  return null;
}

/** 飛ばした先：今の物の次（最後なら先頭へ回る）。1件だけなら null（替わる先が無い） */
export function skipKey(keys: readonly string[], current: string | null): string | null {
  if (keys.length < 2) return null;
  const at = current === null ? -1 : keys.indexOf(current);
  return keys[(at + 1) % keys.length];
}
