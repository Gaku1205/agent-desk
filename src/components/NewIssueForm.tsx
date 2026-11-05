"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import { createNewIssue } from "@/app/actions";
import { checkNewIssueTitle, composeNewIssue, MAX_NEW_ISSUE_TITLE } from "@/lib/newIssue";
import { useDemo } from "./DemoContext";
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

/** Issueを書く画面（docs/design.md の「Issueを書く」）。作るのはサーバー側（Server Action）。デモでは GitHub に送らない */
export function NewIssueForm({ repos, initialRepo }: { repos: NewIssueRepo[]; initialRepo?: string }) {
  const names = repos.map((repo) => repo.name);
  const [selected, setSelected] = useState(initialRepo && names.includes(initialRepo) ? initialRepo : (names[0] ?? ""));
  const [title, setTitle] = useState("");
  const [omakase, setOmakase] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [saving, startSaving] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const demo = useDemo();

  const template = repos.find((repo) => repo.name === selected)?.template === true;

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
      const result = await createNewIssue({ owner, repo, title: checked.title, omakase: template && omakase });
      if (result.ok) {
        setStatus({ kind: "created", number: result.number, url: result.url });
        setTitle("");
      } else {
        setStatus({ kind: "error", message: result.message });
      }
    });
  }

  return (
    <Sheet narrow={false}>
      <div className={settingsStyles.page}>
        <h1 className={settingsStyles.h1}>Issueを書く</h1>
        <div className={settingsStyles.sections}>
          <section className={settingsStyles.section} aria-labelledby="new-issue-title">
            <h2 id="new-issue-title" className={settingsStyles.title}>
              メモ
            </h2>
            {names.length === 0 ? (
              <p className={styles.empty}>監視するリポジトリがありません。設定で追加すると、ここからIssueを書けます</p>
            ) : (
              <form className={styles.form} onSubmit={submit} noValidate>
                <div className={styles.field}>
                  <span className={styles.label} id="new-issue-repo">
                    リポジトリ
                  </span>
                  <Select
                    options={names}
                    value={selected}
                    onChange={(next) => {
                      setSelected(next);
                      setStatus({ kind: "idle" });
                    }}
                    label="Issueを書くリポジトリ"
                    disabled={saving}
                  />
                </div>
                <label className={styles.field}>
                  <span className={styles.label}>{template ? "新サービスのメモ" : "1行のメモ"}</span>
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
                    {saving ? "作成中…" : "Issueを作る"}
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
              </form>
            )}
          </section>
        </div>
      </div>
    </Sheet>
  );
}
