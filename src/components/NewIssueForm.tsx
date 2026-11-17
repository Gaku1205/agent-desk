"use client";

import Link from "next/link";
import { useRef, useState, useTransition, type FormEvent } from "react";
import { createNewIssue } from "@/app/actions";
import { ACTION_UNREACHABLE_MESSAGE, callAction } from "@/lib/actionCall";
import type { CreateIssueResult } from "@/lib/operations";
import { checkNewIssueTitle, composeNewIssue, MAX_NEW_ISSUE_TITLE } from "@/lib/newIssue";
import { useDemo } from "./DemoContext";
import { FileIcon, PlusIcon, RepoIcon, WriteIcon } from "./icons";
import { Select } from "./Select";
import { Sheet } from "./Sheet";
import settingsStyles from "./SettingsSections.module.css";
import styles from "./NewIssueForm.module.css";

export type NewIssueRepo = {
  /** `owner/repo` */
  name: string;
  /** テンプレートリポジトリか（「新サービス：」で書く） */
  template: boolean;
};

type Status =
  | { kind: "idle" }
  | { kind: "created"; number: number | null; url: string | null }
  | { kind: "error"; message: string };

/**
 * Issueを書く画面（docs/design.md の「Issueを書く」）。作るのはサーバー側（Server Action）。デモでは GitHub に送らない。
 * `bar` は PCの3ペインの中央の下に置く1行の形（見出し・名札なし。docs/design.md の「PCの3ペイン」）
 */
export function NewIssueForm({
  repos,
  initialRepo,
  variant = "page",
  mode = "issue",
  newServiceHref,
}: {
  /** `bar` の補助の行に置く「＋ 新しいサービスを作る」の行き先（`/new/service`。デモは `/demo/new/service`） */
  newServiceHref?: string;
  repos: NewIssueRepo[];
  initialRepo?: string;
  variant?: "page" | "bar";
  /** `service`＝「新しいサービスを作る」（/new/service。送り先はテンプレートリポジトリだけ。渡す repos もテンプレートだけにする） */
  mode?: "issue" | "service";
}) {
  const bar = variant === "bar";
  const service = mode === "service";
  const names = repos.map((repo) => repo.name);
  const [selected, setSelected] = useState(initialRepo && names.includes(initialRepo) ? initialRepo : (names[0] ?? ""));
  const [title, setTitle] = useState("");
  const [omakase, setOmakase] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [saving, startSaving] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const demo = useDemo();

  const template = service || repos.find((repo) => repo.name === selected)?.template === true;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const checked = checkNewIssueTitle(title);
    if (!checked.ok) {
      setStatus({ kind: "error", message: checked.message });
      inputRef.current?.focus();
      return;
    }
    const [owner, repo] = selected.split("/");
    if (!owner || !repo) return;
    if (demo) {
      // GitHub には送らず、サンプルのデータにIssueを足す
      demo.createIssue({ owner, repo }, composeNewIssue({ title: checked.title, isTemplate: template, omakase }));
      setStatus({ kind: "created", number: null, url: null });
      setTitle("");
      inputRef.current?.focus();
      return;
    }
    setStatus({ kind: "idle" });
    startSaving(async () => {
      // 呼び出しが投げても、画面を落とさず、書いたメモを残して理由を出す
      const result = await callAction<CreateIssueResult>(
        () => createNewIssue({ owner, repo, title: checked.title, omakase: template && omakase }),
        () => ({ ok: false, message: ACTION_UNREACHABLE_MESSAGE }),
      );
      if (result.ok) {
        setStatus({ kind: "created", number: result.number, url: result.url });
        setTitle("");
      } else {
        setStatus({ kind: "error", message: result.message });
      }
    });
  }

  const empty = (
    <p className={styles.empty}>
      {service
        ? "監視リストにテンプレートのリポジトリがありません。設定でテンプレートのリポジトリ（ai-dev-template など）を追加すると、ここから新しいサービスを作れます"
        : "監視するリポジトリがありません。設定で追加すると、ここからIssueを書けます"}
    </p>
  );
  const form = (
              <form className={bar ? styles.barForm : styles.form} onSubmit={submit} noValidate>
                {service && names.length === 1 ? (
                  <div className={styles.field}>
                    <span className={styles.label}>送り先</span>
                    <span className={styles.target}>
                      <RepoIcon />
                      {selected}
                    </span>
                  </div>
                ) : (
                  <div className={`${styles.field} ${bar ? styles.barRepo : ""}`}>
                    {!bar && (
                      <span className={styles.label} id="new-issue-repo">
                        {service ? "送り先のテンプレート" : "リポジトリ"}
                      </span>
                    )}
                    <Select
                      options={names}
                      value={selected}
                      onChange={(next) => {
                        setSelected(next);
                        setStatus({ kind: "idle" });
                      }}
                      label={service ? "送り先のテンプレートリポジトリ" : "Issueを書くリポジトリ"}
                      disabled={saving}
                      icon={<RepoIcon />}
                    />
                  </div>
                )}
                {bar && newServiceHref && (
                  <Link href={newServiceHref} className={styles.barLink}>
                    <PlusIcon />
                    <span className={styles.barLinkText}>新しいサービスを作る</span>
                  </Link>
                )}
                <label className={`${styles.field} ${bar ? styles.barMemo : ""}`}>
                  <span className={bar ? styles.hidden : styles.label}>
                    {service ? "どんなサービスを作りたいか" : template ? "新サービスのメモ" : "1行のメモ"}
                  </span>
                  <span className={styles.memo}>
                    {template && <span className={styles.prefix}>新サービス：</span>}
                    <input
                      ref={inputRef}
                      className={styles.input}
                      value={title}
                      onChange={(event) => {
                        setTitle(event.target.value);
                        if (status.kind === "error") setStatus({ kind: "idle" });
                      }}
                      maxLength={MAX_NEW_ISSUE_TITLE}
                      autoComplete="off"
                      disabled={saving}
                      aria-invalid={status.kind === "error" ? true : undefined}
                      placeholder={template ? "毎朝の天気と予定のページ" : "お問い合わせに自動で返事を送る"}
                    />
                  </span>
                </label>
                {template && (
                  <div className={styles.omakase}>
                    {/* 標準のチェックボックスは見えなくして残し（キーボード・読み上げ）、ランプと字を描く */}
                    <label className={settingsStyles.toggle} data-on={omakase ? "" : undefined}>
                      <input
                        type="checkbox"
                        className={settingsStyles.native}
                        checked={omakase}
                        onChange={() => setOmakase((on) => !on)}
                        disabled={saving}
                        aria-label="全部おまかせ"
                      />
                      <span className={settingsStyles.lamp} aria-hidden="true" />
                      <span aria-hidden="true">全部おまかせ</span>
                    </label>
                    <span className={styles.hint}>
                      {omakase ? "相談せずに、AIが全部決めて作ります" : "選ばなければ、AIが案を出して相談してきます"}
                    </span>
                  </div>
                )}
                <div className={`${settingsStyles.save} ${styles.actions}`}>
                  <button type="submit" className={settingsStyles.button} disabled={saving} aria-busy={saving}>
                    {service ? <PlusIcon /> : <WriteIcon />}
                    {saving ? "作成中…" : service ? "サービスを作る" : "Issueを作る"}
                  </button>
                  {status.kind === "created" && (
                    <span className={settingsStyles.saved} role="status">
                      {status.number !== null ? `#${status.number} を作りました` : "作りました。あなたの番に出ます"}
                      {status.url && (
                        <>
                          {" "}
                          <a className={styles.link} href={status.url} target="_blank" rel="noreferrer noopener">
                            開く ↗
                          </a>
                        </>
                      )}
                    </span>
                  )}
                  {status.kind === "error" && (
                    <span className={settingsStyles.error} role="alert">
                      {status.message}
                    </span>
                  )}
                </div>
                {service && status.kind === "created" && (
                  <p className={styles.after}>工場が新しいリポジトリを作って、公開まで進めます。相談があれば「あなたの番」に出ます</p>
                )}
              </form>
  );

  if (bar) {
    return (
      <section className={styles.bar} aria-label="Issueを書く">
        <div className={styles.barInner}>{names.length === 0 ? empty : form}</div>
      </section>
    );
  }

  return (
    <Sheet>
      <div className={settingsStyles.page}>
        <h1 className={settingsStyles.h1}>{service ? "新しいサービスを作る" : "Issueを書く"}</h1>
        <div className={settingsStyles.sections}>
          <section className={settingsStyles.section} aria-labelledby="new-issue-title">
            <h2 id="new-issue-title" className={settingsStyles.title}>
              {service ? <PlusIcon /> : <FileIcon />}
              {service ? "どんなサービス？" : "メモ"}
            </h2>
            {service && (
              <p className={styles.lead}>
                新しいリポジトリを工場が作ります。今あるリポジトリに頼むときは、「Issueを書く」から
              </p>
            )}
            {names.length === 0 ? empty : form}
          </section>
        </div>
      </div>
    </Sheet>
  );
}
