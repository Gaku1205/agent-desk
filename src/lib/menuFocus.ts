/** スマホのメニューを閉じたとき、フォーカスをメニューボタンへ戻すかの判定（docs/spec.md の「スマホのメニュー」） */

export type MenuFocusInput = {
  /** 直前はメニューが開いていたか */
  wasOpen: boolean;
  /** 今はメニューが開いているか */
  menuOpen: boolean;
  /** フォーカスがメニューの中にあるか */
  focusInSheet: boolean;
  /** フォーカスがどこにも無い（`body` に落ちた・消えた要素にあった）か */
  focusLost: boolean;
};

/**
 * 開いていたメニューが閉じた直後で、フォーカスがメニューの中に残っているか、どこにも無いときだけ戻す。
 * 閉じたあとに別の場所へフォーカスが移っているなら、動かさない
 */
export function shouldRestoreMenuFocus({ wasOpen, menuOpen, focusInSheet, focusLost }: MenuFocusInput): boolean {
  if (!wasOpen || menuOpen) return false;
  return focusInSheet || focusLost;
}
