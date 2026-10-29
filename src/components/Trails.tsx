"use client";

import { useEffect, useState } from "react";
import { groupTrailDays, trailLimit } from "@/lib/eventGroups";
import type { TrailEvent } from "@/lib/events";
import { TriangleDownIcon } from "./icons";
import { SmartLink } from "./SmartLink";
import styles from "./Trails.module.css";

type Props = {
  events: TrailEvent[];
  /** 「今」（ISO文字列） */
  now: string;
  /** 右上の添え書き（「直近3日」など） */
  hint: string;
};

/** 出来事：直近3日を日ごとのタブに分け、Issue ごとに1つの列（足あと）にまとめる（docs/design.md の「出来事」） */
export function Trails({ events, now, hint }: Props) {
  const days = groupTrailDays(events, new Date(now));
  const [day, setDay] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(6);
  // 前の描画の出来事（新しく入った物を見分ける）
  const [seen, setSeen] = useState<{ events: TrailEvent[]; ids: Set<string> | null }>({ events, ids: null });
  if (seen.events !== events) setSeen({ events, ids: new Set(seen.events.map((e) => e.id)) });

  useEffect(() => {
    const update = () => setLimit(trailLimit(window.innerWidth));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const current = days.find((d) => d.day === day) ?? days[0] ?? null;
  const list = current ? (open ? current.trails : current.trails.slice(0, limit)) : [];
  const rest = current ? current.trails.length - list.length : 0;

  // 前の描画に無かった出来事を持つ列を「新しい」として、上からすっと入れる
  const fresh = new Set<string>();
  if (seen.ids && seen.events === events) {
    const ids = seen.ids;
    for (const trail of list) if (trail.steps.some((s) => !ids.has(s.id))) fresh.add(trail.key);
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
              {days.map((d) => (
                <button
                  key={d.day}
                  type="button"
                  role="tab"
                  className={styles.day}
                  aria-selected={current?.day === d.day}
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
          <div role={days.length > 1 ? "tabpanel" : undefined}>
            {list.map((trail) => (
              <article className={styles.group} data-new={fresh.has(trail.key) ? "" : undefined} key={trail.key}>
                <div className={styles.groupHead}>
                  <span className={`${styles.id} num`}>
                    {trail.issue.repo}#{trail.issue.number}
                  </span>
                  <SmartLink className={styles.ttl} href={trail.issue.url}>
                    {trail.issue.title}
                  </SmartLink>
                </div>
                <ul className={styles.trail}>
                  {trail.steps.map((step) => (
                    <li key={step.id} data-tone={step.tone}>
                      <time className="num" dateTime={step.at}>
                        {step.time}
                      </time>
                      <i aria-hidden="true" />
                      {step.short}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
            {current && current.trails.length > limit && (
              <button type="button" className={styles.more} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
                {open ? "たたむ" : `残り${rest}件を見る`}
                <span className={styles.caret}>
                  <TriangleDownIcon />
                </span>
              </button>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
