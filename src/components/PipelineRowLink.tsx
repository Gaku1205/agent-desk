"use client";

import type { CSSProperties, ReactNode } from "react";
import { toneRgba, type ProgressTone } from "@/lib/progress";
import { useRowEffects } from "./useRowEffects";

type Props = {
  href: string;
  stage: string;
  tone: ProgressTone;
  done: boolean;
  ariaLabel: string;
  /** 外枠の種類（出さないときは undefined） */
  frame: "spinning" | "human" | "fail" | "queue" | undefined;
  children: ReactNode;
};

/** パイプラインの1行。取り直しで段階が変わったら、誰の番かの色で光らせる */
export function PipelineRowLink({ href, stage, tone, done, ariaLabel, frame, children }: Props) {
  const { flash } = useRowEffects(stage);

  return (
    <a
      className="pipeline-grid pipeline-row"
      data-done={done ? "true" : undefined}
      data-flash={flash ?? undefined}
      data-frame={frame}
      style={{ "--flash-color": toneRgba(tone, 0.12) } as CSSProperties}
      href={href}
      role="row"
      aria-label={ariaLabel}
    >
      {children}
    </a>
  );
}
