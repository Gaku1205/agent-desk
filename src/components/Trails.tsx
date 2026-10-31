"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { rovingNext } from "@/lib/roving";
import { currentStep, groupTrailDays, splitDeployed, type IssueTrail } from "@/lib/eventGroups";
import type { TrailEvent } from "@/lib/events";
import { TriangleDownIcon } from "./icons";
import { Marquee } from "./Marquee";
import { SmartLink } from "./SmartLink";
import styles from "./Trails.module.css";

type Props = {
  events: TrailEvent[];
  /** 「今」（ISO文字列） */
  now: string;
  /** 右上の添え書き（「直近3日」など） */
  hint: string;
};

function toggled<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  if (!next.delete(value)) next.add(value);
  return next;
}

/** Issue の1つの列。乗せた・中にフォーカスしたとき、切れた題名を流すために `hot` を渡す */
function TrailGroup({ fresh, children }: { fresh: boolean; children: (hot: boolean) => ReactNode }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  return (
    <article
      className={styles.group}
      data-new={fresh ? "" : undefined}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      {children(hovered || focused)}
    </article>
  );
}

/** 出来事：直近3日を日ごとのタブに分け、Issue ごとに1つの列（今の足あと）にまとめる（docs/design.md の「出来事」） */
export function Trails({ events, now, hint }: Props) {
  const days = groupTrailDays(events, new Date(now));
  const [day, setDay] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  // 足あとを全部出している Issue と、公開済みを開いている日。その画面にいる間だけ覚える
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [deployedOpen, setDeployedOpen] = useState<ReadonlySet<string>>(new Set());
  const baseId = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // 前の描画の出来事（新しく入った物を見分ける）
  const [seen, setSeen] = useState<{ events: TrailEvent[]; ids: Set<string> | null }>({ events, ids: null });
  if (seen.events !== events) setSeen({ events, ids: new Set(seen.events.map((e) => e.id)) });

  const current = days.find((d) => d.day === day) ?? days[0] ?? null;
  const { active, deployed } = splitDeployed(current ? current.trails : []);
  const deployedShown = current !== null && deployedOpen.has(current.day);
  // 隠していない Issue を全件描き、幅ごとに隠す件数は CSS で決める（1500px以上10件・900px以上6件・それ未満5件）
  // 公開済みは別の入れ物に出すので、件数の制限には入れない
  const list = active;
  const total = list.length;

  // 前の描画に無かった出来事を持つ列を「新しい」として、上からすっと入れる
  const fresh = new Set<string>();
  if (seen.ids && seen.events === events) {
    const ids = seen.ids;
    for (const trail of deployedShown ? [...active, ...deployed] : active) if (trail.steps.some((s) => !ids.has(s.id))) fresh.add(trail.key);
  }

  const tabId = (d: string) => `${baseId}-tab-${d}`;
  const panelId = `${baseId}-panel`;

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = rovingNext(event.key, index, days.length);
    if (next === null) return;
    event.preventDefault();
    setDay(days[next].day);
    setOpen(false);
    tabRefs.current[next]?.focus();
  }

  function renderTrail(trail: IssueTrail) {
    const all = expanded.has(trail.key);
    const steps = all ? trail.steps : [currentStep(trail)];
    return (
      <TrailGroup fresh={fresh.has(trail.key)} key={trail.key}>
        {(hot) => (
          <>
            <div className={styles.groupHead}>
              <span className={`${styles.id} num`}>
                {trail.issue.repo}#{trail.issue.number}
              </span>
              <SmartLink className={styles.ttl} href={trail.issue.url} aria-label={trail.issue.title}>
                <Marquee active={hot} autoInView>
                  {trail.issue.title}
                </Marquee>
              </SmartLink>
              {trail.steps.length > 1 && (
                <button
                  type="button"
                  className={styles.expand}
                  aria-expanded={all}
                  aria-label={`${trail.issue.number} の出来事を${all ? "たたむ" : "すべて表示"}`}
                  onClick={() => setExpanded((set) => toggled(set, trail.key))}
                >
                  <span className={styles.caret}>
                    <TriangleDownIcon />
                  </span>
                </button>
              )}
            </div>
            <ul className={styles.trail}>
              {steps.map((step) => (
                <li key={step.id} data-tone={step.tone}>
                  <time className="num" dateTime={step.at}>
                    {step.time}
                  </time>
                  <i aria-hidden="true" />
                  <span>{step.short}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </TrailGroup>
    );
  }

  return (
    <aside className={styles.events} aria-labelledby="trails-title">
      <h2 className={styles.h2} id="trails-title">
        出来事<span className={styles.hint}>{hint}</span>
      </h2>
      {days.length === 0 ? (
        <p className="empty">直近3日の出来事はありません</p>
      ) : (
        <>
          {days.length > 1 ? (
            <div className={styles.days} role="tablist" aria-label="日">
              {days.map((d, index) => (
                <button
                  key={d.day}
                  ref={(el) => {
                    tabRefs.current[index] = el;
                  }}
                  id={tabId(d.day)}
                  type="button"
                  role="tab"
                  className={styles.day}
                  aria-selected={current?.day === d.day}
                  aria-controls={panelId}
                  tabIndex={current?.day === d.day ? 0 : -1}
                  onKeyDown={(event) => onTabKeyDown(event, index)}
                  onClick={() => {
                    setDay(d.day);
                    setOpen(false);
                  }}
                >
                  {d.heading}
                  <i className="num">{d.count}</i>
                </button>
              ))}
            </div>
          ) : (
            // 日が1つだけのときは、押せないタブを出さない。日の名前と件数を文字だけで
            <p className={styles.dayOnly}>
              {days[0].heading}
              <i className="num">{days[0].count}</i>
            </p>
          )}
          <div
            role={days.length > 1 ? "tabpanel" : undefined}
            id={days.length > 1 ? panelId : undefined}
            aria-labelledby={days.length > 1 && current ? tabId(current.day) : undefined}
          >
            <div className={styles.groups} data-open={open ? "" : undefined}>
              {list.map(renderTrail)}
            </div>
            {total > 5 && (
              <button
                type="button"
                className={styles.more}
                data-over6={total > 6 ? "" : undefined}
                data-over10={total > 10 ? "" : undefined}
                aria-expanded={open}
                onClick={() => setOpen((o) => !o)}
              >
                {open ? (
                  "たたむ"
                ) : (
                  <>
                    <span className={styles.rest10}>残り{total - 10}件を見る</span>
                    <span className={styles.rest6}>残り{total - 6}件を見る</span>
                    <span className={styles.rest5}>残り{total - 5}件を見る</span>
                  </>
                )}
                <span className={styles.caret}>
                  <TriangleDownIcon />
                </span>
              </button>
            )}
            {current && deployed.length > 0 && (
              <div>
                <button
                  type="button"
                  className={styles.more}
                  data-deployed=""
                  aria-expanded={deployedShown}
                  onClick={() => setDeployedOpen((set) => toggled(set, current.day))}
                >
                  {deployedShown ? "公開済みをたたむ" :`公開済み ${deployed.length}件`}
                  <span className={styles.caret}>
                    <TriangleDownIcon />
                  </span>
                </button>
              </div>
            )}
            {deployedShown && (
              <div className={styles.groups} data-open="">
                {deployed.map(renderTrail)}
              </div>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
