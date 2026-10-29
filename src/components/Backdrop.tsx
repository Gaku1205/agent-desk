"use client";

import { useRef } from "react";
import type { FlowEngine } from "./flow/engine";
import { FlowStage } from "./flow/FlowStage";

/** 流れを置かないページ（設定・ログイン・見つからないページ）の背景：川だけ */
export function Backdrop() {
  const engineRef = useRef<FlowEngine | null>(null);
  const bandRef = useRef<HTMLElement>(null);
  return <FlowStage nodes={[]} stage={false} engineRef={engineRef} bandRef={bandRef} />;
}
