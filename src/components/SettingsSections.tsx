"use client";

import { useCallback, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import type { ParallelSettings } from "@/lib/parallel";
import { formatSavedAt } from "@/lib/settingsSave";
import { AppearanceSetting } from "./AppearanceSetting";
import { useDemo } from "./DemoContext";
import { BellIcon, BranchIcon, CheckIcon, GearIcon, RepoIcon, SunIcon } from "./icons";
import { NotifySetting, type NotifyRepoRow } from "./NotifySetting";
import { ParallelSetting } from "./ParallelSetting";
import styles from "./Settings.module.css";
import { SettingsSavedContext } from "./SettingsRow";
import { WatchedReposSetting, type WatchedRepoRow } from "./WatchedReposSetting";

type Props = {
  repoRows: WatchedRepoRow[];
  /** 追加の欄に出すリポジトリ（`owner/repo`） */
  repoOptions: string[];
  /** 監視するリポジトリを変えられるか */
  editable: boolean;
  /** 追加の欄の一覧が取れなかったときの理由。取れたときは無し */
  repoOptionsError?: string | null;
  notifyRows: NotifyRepoRow[];
  /** `Auto-add` がオンか。変えられない（保存先が無い）ときは null で、出さない */
  autoAdd?: boolean | null;
  /** 並列の設定（昼の数・夜の数・夜の時間帯）。変えられない（保存先が無い）ときは null で、節を出さない */
  parallel?: ParallelSettings | null;
};

type SectionDef = { id: string; title: string; note: ReactNode; icon: ReactNode; body: ReactNode };

/** 設定画面：左に目次、右に節ごとの白い面。変えたらすぐ保存する（本物とデモで同じ物） */
export function SettingsSections({
  repoRows,
  repoOptions,
  editable,
  repoOptionsError,
  notifyRows,
  autoAdd = null,
  parallel = null,
}: Props) {
  const demo = useDemo();
  // いまの監視リポジトリ（外す・追加をすぐ数と通知に映す）
  const [names, setNames] = useState(() => repoRows.map((row) => row.name));
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const markSaved = useCallback(() => {
    if (!demo) setSavedAt(new Date());
  }, [demo]);
  // 保存の失敗が残っている行（残っている間は `〜に保存しました` を出さない）
  const [failedIds, setFailedIds] = useState<ReadonlySet<string>>(new Set());
  const reportFailure = useCallback((id: string, failed: boolean) => {
    setFailedIds((prev) => {
      if (prev.has(id) === failed) return prev;
      const next = new Set(prev);
      if (failed) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const savedValue = useMemo(() => ({ markSaved, reportFailure }), [markSaved, reportFailure]);
  const listed = new Set(names);
  const shownNotifyRows = notifyRows.filter((row) => listed.has(row.name));

  const sections: SectionDef[] = [
    {
      id: "settings-repos",
      title: "Repositories",
      note: (
        <>
          監視するリポジトリ · <span className="num">{names.length}</span>件
        </>
      ),
      icon: <RepoIcon />,
      body: (
        <WatchedReposSetting
          initialRows={repoRows}
          options={repoOptions}
          editable={editable}
          optionsError={repoOptionsError}
          onListChange={setNames}
          autoAdd={autoAdd}
        />
      ),
    },
    ...(parallel !== null
      ? [
          {
            id: "settings-parallel",
            title: "Parallel",
            note: "同時に進める数",
            icon: <BranchIcon />,
            body: <ParallelSetting initial={parallel} />,
          },
        ]
      : []),
    {
      id: "settings-notify",
      title: "Notifications",
      note: "スマホに届く通知",
      icon: <BellIcon />,
      body: <NotifySetting rows={shownNotifyRows} />,
    },
    {
      id: "settings-appearance",
      title: "Appearance",
      note: "見た目",
      icon: <SunIcon />,
      body: <AppearanceSetting />,
    },
  ];
  const ids = sections.map((section) => section.id).join(",");
  const [active, setActive] = useState(sections[0].id);

  // 今いる節：画面の上の方に見えている節のうち、いちばん上の物
  useEffect(() => {
    const order = ids.split(",");
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        const first = order.find((id) => visible.has(id));
        if (first) setActive(first);
      },
      { rootMargin: "-80px 0px -55% 0px" },
    );
    for (const id of order) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [ids]);

  function jump(event: MouseEvent<HTMLAnchorElement>, id: string) {
    const el = document.getElementById(id);
    if (!el) return;
    event.preventDefault();
    el.scrollIntoView({ block: "start" });
    setActive(id);
  }

  const savedText = failedIds.size > 0 ? null : formatSavedAt(savedAt);

  return (
    <SettingsSavedContext.Provider value={savedValue}>
      <main id="main" className={styles.page}>
        <header className={styles.head}>
          <h1 className={styles.h1}>
            <GearIcon size={20} />
            <span className={styles.h1En}>Settings</span>
            <span className={styles.h1Ja}>設定</span>
          </h1>
          <p className={styles.status} role="status">
            変えたらすぐ保存
            {savedText && (
              <>
                {" · "}
                <span className={styles.statusSaved}>
                  <CheckIcon />
                  <span className="num">{savedText}</span>
                </span>
              </>
            )}
          </p>
        </header>
        <div className={styles.layout}>
          <nav className={styles.toc} aria-label="設定の目次">
            {sections.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                className={styles.tocItem}
                aria-current={active === section.id ? "true" : undefined}
                onClick={(event) => jump(event, section.id)}
              >
                {section.icon}
                {section.title}
              </a>
            ))}
          </nav>
          <div className={styles.sections}>
            {sections.map((section) => (
              <section
                key={section.id}
                id={section.id}
                className={styles.section}
                aria-labelledby={`${section.id}-title`}
              >
                <h2 id={`${section.id}-title`} className={styles.sectionTitle}>
                  {section.icon}
                  <span className={styles.sectionEn}>{section.title}</span>
                  <span className={styles.sectionJa}>{section.note}</span>
                </h2>
                {section.body}
              </section>
            ))}
          </div>
        </div>
      </main>
    </SettingsSavedContext.Provider>
  );
}
