/** 続けて打った文字を1つの並びとして扱う間（ミリ秒） */
export const TYPEAHEAD_RESET_MS = 1000;

export type TypeaheadState = { text: string; at: number };

export type TypeaheadResult = {
  state: TypeaheadState;
  /** 移る先の添字。一致が無ければ null（動かさない） */
  index: number | null;
};

/**
 * 打った文字で候補へ移る。間が空いていなければ並びに足して絞り、空いていたら並びをリセットする。
 * 先頭一致・大文字小文字は区別しない。文字キー以外（名前のあるキー・空白）は無視する
 */
export function typeahead(prev: TypeaheadState, key: string, now: number, options: string[]): TypeaheadResult {
  if (key.length !== 1 || key === " ") return { state: prev, index: null };
  const text = (now - prev.at <= TYPEAHEAD_RESET_MS ? prev.text : "") + key.toLowerCase();
  const found = options.findIndex((o) => o.toLowerCase().startsWith(text));
  return { state: { text, at: now }, index: found === -1 ? null : found };
}
