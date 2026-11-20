"use client";

import type { ReactNode } from "react";
import type { DeskNav } from "./Desk";
import styles from "./RepoList.module.css";

/**
 * 新しいサービスを作る（`/new/service`）の枠：中央の1本の列。
 * PCの左のバーは無い（ページの移動は上端の帯。docs/spec.md の「新しいサービスを作る」）
 */
export function NewServiceFrame({ children }: { nav?: DeskNav; children: ReactNode }) {
  return (
    <div className={styles.panes} data-panes="">
      <main id="main" className={styles.main}>
        {children}
      </main>
    </div>
  );
}
