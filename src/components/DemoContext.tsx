"use client";

import { createContext, useContext } from "react";
import type { AddedNotice } from "@/lib/autoAdd";
import type { WatchedRepo } from "@/lib/config";
import type { PlayButtonState } from "@/lib/demo/playback";
import type { RepoResult } from "@/lib/github/types";
import type { OperationKind, TurnItem } from "@/lib/turn";

export type DemoState = {
  /** サンプルのデータ（本物と同じ形） */
  results: RepoResult[];
  /** Dashboard のデモ用：`results` に、`30d` のための古い公開済みを足した物 */
  dashboardResults: RepoResult[];
  /** 監視しているリポジトリ（工場が作ったリポジトリを自動で足したら、それも入る） */
  repos: WatchedRepo[];
  /** 自動で監視に足したリポジトリ（「いまの様子」のお知らせ） */
  addedNotices: AddedNotice[];
  /** 設定の「新しいサービスを自動で追加」（初期はオン。GitHub には保存しない） */
  autoAdd: boolean;
  setAutoAdd: (on: boolean) => void;
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
  operate: (target: { owner: string; repo: string; number: number }, kind: OperationKind, answer?: string) => void;
  /** 「Issueを書く」：サンプルのデータにIssueを足す（GitHub には送らない） */
  createIssue: (target: { owner: string; repo: string }, issue: { title: string; body: string }) => void;
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
