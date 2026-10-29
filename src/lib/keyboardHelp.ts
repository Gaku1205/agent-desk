/** `?` キーで、キーボード操作の一覧を開く・閉じるかの判定（docs/spec.md の「キーボード操作の一覧」） */

export type HelpKeyInput = {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  /** 日本語入力の変換中か */
  isComposing: boolean;
  /** 押しっぱなしの繰り返しか */
  repeat: boolean;
  /** キーを受けた要素（フォーカス先） */
  target: { tagName: string; isContentEditable: boolean } | null;
};

/** 文字を打つ要素（`input`・`textarea`・`select`・編集できる要素）か */
export function isTypingTarget(target: HelpKeyInput["target"]): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * 押されたキーとフォーカス先から、一覧を開く・閉じるキーかを決める。
 * `?`（Shift は押していてよい）だけが対象。Ctrl・Alt・Meta を押しているとき、変換中、押しっぱなしの繰り返し、
 * 入力欄にフォーカスがあるときは反応しない
 */
export function isHelpToggleKey(input: HelpKeyInput): boolean {
  if (input.key !== "?") return false;
  if (input.ctrlKey || input.altKey || input.metaKey) return false;
  if (input.isComposing || input.repeat) return false;
  return !isTypingTarget(input.target);
}
