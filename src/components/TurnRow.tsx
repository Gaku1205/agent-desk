"use client";

import { useState, useTransition, type ReactNode } from "react";
import { runOperation } from "@/app/actions";
import type { MergeSummary, OperationKind, TurnButton } from "@/lib/turn";
import { MergeDialog } from "./MergeDialog";

type Props = {
  owner: string;
  repo: string;
  issueNumber: number;
  title: string;
  url: string;
  description: string;
  wait: string;
  buttons: TurnButton[];
  merge: MergeSummary | null;
  /** 進み具合のバー */
  children: ReactNode;
};

/** あなたの番の1行（ボタンを押すとサーバー側で操作して、画面を取り直す） */
export function TurnRow(props: Props) {
  const { owner, repo, issueNumber, buttons, merge } = props;
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);

  function run(kind: OperationKind, onDone?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await runOperation({ kind, owner, repo, issueNumber });
      onDone?.();
      if (!result.ok && !result.changed) setError(result.message);
    });
  }

  return (
    <li className="turn-row">
      <svg
        className="turn-icon"
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        strokeWidth="1.5"
        aria-hidden="true"
      >
        <circle cx="7" cy="7" r="5.5" stroke="var(--human)" />
        <circle cx="7" cy="7" r="2" fill="var(--human)" />
      </svg>
      <a className="turn-ref mono" href={props.url} target="_blank" rel="noreferrer">
        {repo}#{issueNumber}
      </a>
      <div className="turn-body">
        <a className="turn-title" href={props.url} target="_blank" rel="noreferrer">
          {props.title}
        </a>
        <p className="turn-desc">{props.description}</p>
        <div className="turn-progress">{props.children}</div>
        {error && (
          <p className="turn-op-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <span className="turn-wait mono">{props.wait}</span>
      <div className="turn-buttons">
        {buttons.map((button) =>
          button.type === "link" ? (
            <a
              key={button.label}
              className="turn-button"
              href={button.href}
              target="_blank"
              rel="noreferrer"
            >
              {button.label}
            </a>
          ) : (
            <button
              key={button.kind}
              type="button"
              className="turn-button"
              disabled={pending}
              onClick={() => (button.kind === "merge" ? setMergeOpen(true) : run(button.kind))}
            >
              {button.label}
            </button>
          ),
        )}
      </div>
      {mergeOpen && merge && (
        <MergeDialog
          repo={repo}
          title={props.title}
          merge={merge}
          pending={pending}
          onCancel={() => setMergeOpen(false)}
          onConfirm={() => run("merge", () => setMergeOpen(false))}
        />
      )}
    </li>
  );
}
