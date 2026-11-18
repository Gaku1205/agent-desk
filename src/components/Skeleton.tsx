"use client";

import dashboardStyles from "./Dashboard.module.css";
import deskStyles from "./Desk.module.css";
import lanesStyles from "./Lanes.module.css";
import { useNav } from "./NavContext";
import { Sheet } from "./Sheet";
import pageStyles from "./Settings.module.css";
import settingsStyles from "./SettingsSections.module.css";
import styles from "./Skeleton.module.css";
import { SideRepos } from "./TopBar";

/** 帯1本。幅・高さだけ変える（色は --hair-2 のみ） */
function Band({ width, height }: { width: number | string; height: number }) {
  return <span className={styles.band} style={{ width, height }} aria-hidden="true" />;
}

/**
 * ホームとリポジトリのページの骨組み：左のバー（本物。layout が渡した物）、中央に「いまの様子」の行と「あなたの番」の面、
 * 下に入力欄の位置、右の進捗図の列（空）。PC の3ペインと同じ枠なので、本文が出たときに跳ねない
 */
export function DeskSkeleton() {
  const nav = useNav();
  return (
    <div className={deskStyles.panes} data-panes="" aria-busy="true">
      <div className={deskStyles.side} id="side-repos">
        {nav && <SideRepos {...nav} />}
      </div>
      <div className={deskStyles.center}>
        <main className={deskStyles.desk} id="main">
          <div className={styles.past} aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <div className={styles.row} key={i}>
                <Band width={150} height={12} />
                <Band width="58%" height={15} />
                <Band width="76%" height={13} />
              </div>
            ))}
          </div>
          <section className={deskStyles.turn} aria-hidden="true">
            <div className={deskStyles.head}>
              <Band width={72} height={13} />
            </div>
            <div className={styles.face} />
          </section>
        </main>
        <div className={deskStyles.composer} aria-hidden="true">
          <div className={styles.composerBar} />
        </div>
      </div>
      <div className={deskStyles.flow} />
    </div>
  );
}

/** Dashboard の骨組み：左のバー（本物）、見出しとまとめの文、表の位置 */
export function DashboardSkeleton() {
  const nav = useNav();
  return (
    <div className={dashboardStyles.panes} data-panes="" aria-busy="true">
      <div className={dashboardStyles.side} id="side-repos">
        {nav && <SideRepos {...nav} />}
      </div>
      <main id="main" className={dashboardStyles.main}>
        <div className={dashboardStyles.head} aria-hidden="true">
          <div className={dashboardStyles.title}>
            <Band width={150} height={36} />
            <Band width={260} height={13} />
          </div>
          <Band width={110} height={36} />
        </div>
        <div className={dashboardStyles.summary} aria-hidden="true">
          <div className={styles.line}>
            <Band width="80%" height={42} />
            <Band width="100%" height={92} />
          </div>
        </div>
        <div className={dashboardStyles.usage} aria-hidden="true">
          <div className={styles.line}>
            <Band width={140} height={16} />
            <Band width="100%" height={220} />
          </div>
        </div>
        <div className={dashboardStyles.stops} aria-hidden="true">
          <div className={styles.line}>
            <Band width={120} height={16} />
            <Band width="100%" height={180} />
          </div>
        </div>
        <div className={dashboardStyles.limits} aria-hidden="true">
          <div className={styles.line}>
            <Band width={150} height={16} />
            <Band width="100%" height={72} />
            <Band width="100%" height={160} />
          </div>
        </div>
      </main>
    </div>
  );
}

/** Slots & Queue の骨組み：左のバー（本物）、見出しと一文、区画ごとの見出しと行の位置 */
export function LanesSkeleton() {
  const nav = useNav();
  return (
    <div className={dashboardStyles.panes} data-panes="" aria-busy="true">
      <div className={dashboardStyles.side} id="side-repos">
        {nav && <SideRepos {...nav} />}
      </div>
      <main id="main" className={lanesStyles.main}>
        <div className={styles.line} aria-hidden="true" style={{ gap: 4 }}>
          <Band width={200} height={36} />
          <Band width={320} height={13} />
        </div>
        {[
          { rows: 3, height: 60 },
          { rows: 2, height: 56 },
          { rows: 2, height: 56 },
        ].map((section, s) => (
          <div className={styles.line} key={s} aria-hidden="true" style={{ gap: 12 }}>
            <Band width={150} height={15} />
            <div className={styles.line} style={{ gap: 2 }}>
              {Array.from({ length: section.rows }, (_, i) => (
                <Band key={i} width="100%" height={section.height} />
              ))}
            </div>
          </div>
        ))}
      </main>
    </div>
  );
}

/** 設定の骨組み：見出し、左の目次、右に節（見出しと白い面の形）。本物と同じ枠（Settings.module.css） */
export function SettingsSkeleton() {
  return (
    <main id="main" className={pageStyles.page} aria-busy="true">
      <div className={pageStyles.head} aria-hidden="true">
        <Band width={160} height={36} />
      </div>
      <div className={pageStyles.layout} aria-hidden="true">
        <div className={`${pageStyles.toc} ${styles.settingsToc}`}>
          {[0, 1, 2, 3].map((i) => (
            <Band key={i} width="100%" height={40} />
          ))}
        </div>
        <div className={pageStyles.sections}>
          {[4, 4, 3].map((rows, s) => (
            <div key={s}>
              <div className={pageStyles.sectionTitle}>
                <Band width={180} height={16} />
              </div>
              <span className={styles.panelBand} style={{ height: rows * 56 }} />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

/** 新しいサービスを作る／Issueを書くの骨組み：見出し、節の見出しと一文、入力の行、ボタン */
export function FormSkeleton() {
  return (
    <Sheet>
      <div className={settingsStyles.page} aria-busy="true" aria-hidden="true">
        <Band width={220} height={36} />
        <div className={settingsStyles.section} style={{ paddingTop: 0, borderTop: 0 }}>
          <div className={settingsStyles.title}>
            <Band width={140} height={15} />
          </div>
          <div className={styles.line}>
            <Band width="70%" height={13} />
            <Band width={260} height={36} />
            <Band width="100%" height={36} />
            <Band width={160} height={32} />
          </div>
        </div>
      </div>
    </Sheet>
  );
}
