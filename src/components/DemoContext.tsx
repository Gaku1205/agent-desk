"use client";

import { createContext, useContext } from "react";
import type { PlayButtonState } from "@/lib/demo/playback";
import type { RepoResult } from "@/lib/github/types";
import type { OperationKind, TurnItem } from "@/lib/turn";

export type DemoState = {
  /** サンプルのデータ（本物と同じ形） */
  results: RepoResult[];
  /** 全リポジトリの「あなたの番」（並び順どおり） */
  items: TurnItem[];
  /** デモの「今」 */
  now: Date;
  playState: PlayButtonState;
  /** 再生する（終わっていれば最初から） */
  play: () => void;
  /** 「デモでは実際には動きません」を出す（設定の保存・同期） */
  notify: () => void;
  /** 「あなたの番」のボタン：サンプルのデータの上で本当に段階を進める（少し遅れて当てる） */
  operate: (target: { owner: string; repo: string; number: number }, kind: OperationKind) => void;
};

const DemoContext = createContext<DemoState | null>(null);

export const DemoProvider = DemoContext.Provider;

/** デモの中なら、その状態。本物の画面では null（ボタンはいつもどおりサーバーで操作する） */
export function useDemo(): DemoState | null {
  return useContext(DemoContext);
}

/** デモの部品だけで使う */
export function useDemoState(): DemoState {
  const value = useContext(DemoContext);
  if (!value) throw new Error("DemoShell の中で使う");
  return value;
}
