"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { DEMO_APP_REPO_URL } from "@/lib/demo/data";
import { avatarInitial, avatarUrl } from "@/lib/avatar";
import { shouldCloseMenuOnPick } from "@/lib/menuFocus";
import { rovingNext } from "@/lib/roving";
import { useDemo } from "./DemoContext";
import { BranchIcon, GearIcon, LoginIcon, LogoutIcon } from "./icons";
import styles from "./SideUser.module.css";

type Props = {
  /** ログイン中のユーザー名（デモでは無し） */
  login?: string;
  /** ログアウト（Server Action。デモでは無し） */
  logout?: () => Promise<void>;
  /** リンクの頭（デモでは `/demo`） */
  basePath?: string;
  /** スマホのメニューの中では `menu`（設定を押したとき、今いるページならスマホのメニューを閉じる） */
  onPick?: () => void;
};

/** GitHub のアイコン（丸・24px）。読めなかったときは頭文字1字の丸 */
function Avatar({ login }: { login: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className={styles.initial} aria-hidden="true">
        {avatarInitial(login)}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- next.config の images は足さず、github.com から直接読む
    <img
      className={styles.avatar}
      src={avatarUrl(login)}
      alt=""
      width={24}
      height={24}
      onError={() => setFailed(true)}
    />
  );
}

/** 「設定」の中身：押したあと次の画面が出るまで、歯車が脈打つ */
function SettingsLabel() {
  const { pending } = useLinkStatus();
  return (
    <>
      <span className={styles.gear} data-pending={pending ? "" : undefined}>
        <GearIcon />
      </span>
      設定
    </>
  );
}

/** ログアウトの項目：送信の最中は文言を変え、押せなくする（スマホのメニューと同じ決まり） */
function LogoutItem() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" role="menuitem" className={styles.item} disabled={pending}>
      <LogoutIcon />
      {pending ? "ログアウト中…" : "ログアウト"}
    </button>
  );
}

/**
 * PCの左のバーのいちばん下：ユーザー名のボタンと、その上に開く小さなメニュー（設定・ログアウト）。
 * デモではユーザー名の代わりに `デモ` を置き、デモにある物（GitHubで見る・ログイン）を同じ形で出す。
 * docs/spec.md の「PCの3ペイン」・docs/design.md の「左のバーの新サービスとユーザーのメニュー」
 */
export function SideUser({ login, logout, basePath = "", onPick }: Props) {
  const demo = useDemo();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const items = useCallback(
    () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []),
    [],
  );

  // 別のページへ移ったら閉じる（スマホのメニューの中では部品が残るため）
  const [openPath, setOpenPath] = useState(pathname);
  if (openPath !== pathname) {
    setOpenPath(pathname);
    setOpen(false);
  }

  // 開いたら最初の項目へ。外を押したら閉じる
  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
    const onDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !wrapRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, items]);

  const closeAndRestore = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      closeAndRestore();
      return;
    }
    const list = items();
    if (open && list.length > 0 && event.target !== buttonRef.current) {
      const current = list.indexOf(document.activeElement as HTMLElement);
      const next = rovingNext(event.key, current < 0 ? 0 : current, list.length);
      if (next !== null && event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
        event.preventDefault();
        list[next]?.focus();
      }
      return;
    }
    // 閉じているときに ↓ か ↑ を押したら開く
    if (!open && event.target === buttonRef.current && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      setOpen(true);
    }
  };

  // Tab でメニューの外へ出たら閉じる（外から来た次のフォーカスがあるときだけ。クリックで外れた場合は pointerdown が閉じる）
  const onBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (open && next instanceof Node && !wrapRef.current?.contains(next)) setOpen(false);
  };

  let label: ReactNode;
  let menu: ReactNode;
  if (demo) {
    label = <span className={styles.name}>デモ</span>;
    menu = (
      <>
        <a className={styles.item} role="menuitem" href={DEMO_APP_REPO_URL} target="_blank" rel="noreferrer">
          <BranchIcon />
          GitHubで見る ↗
        </a>
        <Link className={styles.item} role="menuitem" href="/" onClick={() => setOpen(false)}>
          <LoginIcon />
          ログイン
        </Link>
      </>
    );
  } else if (login && logout) {
    const settingsHref = `${basePath}/settings`;
    label = (
      <>
        <Avatar login={login} />
        <span className={styles.name}>{login}</span>
      </>
    );
    menu = (
      <>
        <Link
          className={styles.item}
          role="menuitem"
          href={settingsHref}
          onClick={() => {
            // 今いるページなら移らないので、すぐ閉じる。別のページへは、次の画面が出るまで開いたまま（歯車が脈打つ）
            if (shouldCloseMenuOnPick(pathname, settingsHref)) {
              setOpen(false);
              onPick?.();
            }
          }}
        >
          <SettingsLabel />
        </Link>
        <form action={logout} role="none">
          <LogoutItem />
        </form>
      </>
    );
  } else {
    return null;
  }

  return (
    <div className={styles.wrap} ref={wrapRef} onKeyDown={onKeyDown} onBlur={onBlur}>
      {open && (
        <div className={styles.menu} role="menu" id={menuId} aria-label={demo ? "デモのメニュー" : "ユーザーのメニュー"} ref={menuRef}>
          {menu}
        </div>
      )}
      <button
        type="button"
        className={`${styles.button} num`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        data-open={open ? "" : undefined}
        ref={buttonRef}
        onClick={() => setOpen((prev) => !prev)}
      >
        {label}
      </button>
    </div>
  );
}
