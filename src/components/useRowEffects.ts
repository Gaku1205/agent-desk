"use client";

import { useState } from "react";
import { shouldFadeIn, stageChanged } from "@/lib/changes";
import { useShell } from "./AppShell";

export type RowEffects = {
  /** 新しく入った行のフェードイン */
  fadeIn: boolean;
  /** 段階が変わったときの光り方。変わるたびに A と B を入れ替えて、アニメーションをやり直す */
  flash: "a" | "b" | null;
};

/** 取り直しで段階が変わった行を光らせ、新しく入った行をフェードインさせるための印 */
export function useRowEffects(stage: string): RowEffects {
  const { refreshCountOnPage } = useShell();
  const [fadeIn] = useState(() => shouldFadeIn(refreshCountOnPage));
  const [seen, setSeen] = useState({ stage, changes: 0 });

  if (stageChanged(seen.stage, stage)) {
    setSeen({ stage, changes: seen.changes + 1 });
  }

  return {
    fadeIn,
    flash: seen.changes === 0 ? null : seen.changes % 2 === 1 ? "a" : "b",
  };
}
