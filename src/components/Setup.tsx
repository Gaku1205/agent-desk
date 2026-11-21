"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  confirmAppInstalled,
  createSetupRepo,
  enableSetupDeleteBranch,
  pickSetupRepo,
  pollSetupDoctor,
  reloginWithRepoScope,
  saveExistingAppKeys,
  saveSetupClaudeToken,
  startAppManifest,
  startSetupDoctor,
} from "@/app/(app)/setup/actions";
import { ACTION_UNREACHABLE_MESSAGE, callAction } from "@/lib/actionCall";
import { appInstallUrl, CLAUDE_APP_INSTALL_URL } from "@/lib/appManifest";
import { newIssueHref } from "@/lib/issueRepo";
import {
  checkRepoNameInput,
  computeSetupSteps,
  parseSetupRepo,
  SETUP_MESSAGES,
  SETUP_STEP_IDS,
  type DoctorRun,
  type SetupFacts,
  type SetupStepId,
} from "@/lib/setupState";
import { useDemo } from "./DemoContext";
import { CheckIcon, CrossIcon, SpinnerIcon, WriteIcon } from "./icons";
import { Segmented } from "./Segmented";
import { Select } from "./Select";
import styles from "./Setup.module.css";
import formStyles from "./SettingsSections.module.css";

type Props = {
  login: string;
  facts: SetupFacts;
  /** `?repo=` のリポジトリが使えない（本人の物でない・テンプレートから作られていない・無い） */
  notTarget: boolean;
  /** ログインのトークンに `repo` の権限があるか */
  canWrite: boolean;
  /** `作ってあるリポジトリを使う` の選択肢（`owner/name`） */
  templateRepos: string[];
  /** `?error=…` の知らせ */
  notice: string | null;
  /** もう監視しているか */
  watched: boolean;
};

const STEP_NAMES: Record<SetupStepId, string> = {
  repo: "Repository",
  app: "Pipeline App",
  claude: "Claude",
  settings: "設定",
  check: "Check",
};

/** 各手順の説明（なぜ要るか）。次の `STEP_TROUBLES` が、うまくいかないときの次の一手 */
const STEP_DESCRIPTIONS: Record<SetupStepId, string> = {
  repo: "テンプレートから、AI が作業する新しいリポジトリを作ります。AI はこのリポジトリの中だけで作業するので、最初に必要です",
  app: "AI が GitHub を操作するための「鍵」になる App を作ります。「GitHub で App を作る」を押し、GitHub の画面で作成を押してください",
  claude: "AI を動かすために、Claude の利用権限（トークン）を GitHub に預けます。これが無いと AI は動きません",
  settings: "マージしたあとの不要なブランチを自動で消す設定にします。リポジトリが散らかるのを防ぎます。自動で進みます",
  check: "必要な設定がそろったか、自動のチェック（診断）で確かめます。ここで通れば準備は完了です",
};

const STEP_TROUBLES: Record<SetupStepId, string> = {
  repo: "うまくいかないときは、名前を変えるか、「作ってあるリポジトリを使う」を押してください",
  app: "GitHub から戻れないときは、もう一度押してください。作ってある App があるときは「App はもう持っている」を押してください",
  claude: "トークンが出ないときは、ターミナルで claude setup-token をもう一度打ってください。貼っても保存できないときは、先に「入れた」を押してください",
  settings: "止まったときは「もう一度」を押してください。直らないときは、ページを読み込み直してください",
  check: "直す所が見つかったときは「結果を見る」で理由を読み、その段に戻って直してから、もう一度診断してください",
};

const VISIBILITY = [
  { value: "public", label: "Public" },
  { value: "private", label: "Private" },
] as const;

/** 診断を待つ間隔と、待つ長さの上限 */
const POLL_MS = 4000;
const POLL_LIMIT_MS = 5 * 60_000;
/** デモの「診断中…」の長さ */
const DEMO_DOCTOR_MS = 1200;

const DEMO_START: SetupFacts = {
  repo: null,
  repoReady: false,
  hasAppId: false,
  hasAppKey: false,
  appSlug: null,
  appInstalled: false,
  hasClaudeToken: false,
  deleteBranchOnMerge: false,
  doctor: null,
};

function unreachable<T extends { ok: false; message: string }>(): T {
  return { ok: false, message: ACTION_UNREACHABLE_MESSAGE } as T;
}

/** Manifest を GitHub にフォームで送る（同じタブ） */
function submitManifest(action: string, manifest: string): void {
  const form = document.createElement("form");
  form.method = "post";
  form.action = action;
  const input = document.createElement("input");
  input.type = "hidden";
  input.name = "manifest";
  input.value = manifest;
  form.appendChild(input);
  document.body.appendChild(form);
  form.submit();
}

/** 導入のページ（本物とデモで同じ物。デモは何も書き込まず、押すと次の段へ進むだけ） */
export function Setup({ login, facts: serverFacts, notTarget, canWrite, templateRepos, notice, watched }: Props) {
  const demo = useDemo() !== null;
  const router = useRouter();
  const [demoFacts, setDemoFacts] = useState<SetupFacts>(DEMO_START);
  const facts = demo ? demoFacts : serverFacts;
  const steps = computeSetupSteps(facts);
  const repo = facts.repo;
  const writable = demo || canWrite;
  const basePath = demo ? "/demo" : "";

  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 1. Repository
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState(templateRepos[0] ?? "");
  // 2. Pipeline App
  const [haveApp, setHaveApp] = useState(false);
  const [appId, setAppId] = useState("");
  const [pem, setPem] = useState("");
  // 3. Claude
  const [claudeInstalled, setClaudeInstalled] = useState(false);
  const [token, setToken] = useState("");
  const [copied, setCopied] = useState(false);
  // 5. Check
  const [doctor, setDoctor] = useState<DoctorRun | null>(facts.doctor);
  const [checking, setChecking] = useState(facts.doctor?.status === "running");
  const [watchError, setWatchError] = useState<string | null>(null);
  const since = useRef<number | null>(
    facts.doctor?.status === "running" ? Date.parse(facts.doctor.createdAt) - 1000 : null,
  );

  const done = useCallback(() => {
    setPending(null);
    setError(null);
    router.refresh();
  }, [router]);

  async function run<T extends { ok: boolean }>(
    key: string,
    call: () => Promise<T>,
    onOk: (result: T) => void,
  ): Promise<void> {
    setPending(key);
    setError(null);
    const result = await callAction(call, () => unreachable() as unknown as T);
    if (!result.ok) {
      setPending(null);
      setError((result as unknown as { message: string }).message);
      return;
    }
    onOk(result);
  }

  // ───── 1. Repository ─────
  function create() {
    const checked = checkRepoNameInput(name);
    if (!checked) {
      setError(SETUP_MESSAGES.invalidName);
      return;
    }
    if (demo) {
      setDemoFacts((f) => ({ ...f, repo: `demo/${checked}`, repoReady: true }));
      return;
    }
    void run("create", () => createSetupRepo(checked, visibility), (result) => {
      if (result.ok) router.push(`/setup?repo=${result.repo}`);
    });
  }

  function chooseExisting() {
    if (demo) {
      setDemoFacts((f) => ({ ...f, repo: picked || "demo/my-app", repoReady: true }));
      return;
    }
    if (!picked) return;
    void run("pick", () => pickSetupRepo(picked), (result) => {
      if (result.ok) router.push(`/setup?repo=${result.repo}`);
    });
  }

  // ───── 2. Pipeline App ─────
  function createApp() {
    if (demo) {
      setDemoFacts((f) => ({ ...f, hasAppId: true, hasAppKey: true, appSlug: "demo-ai-pipeline" }));
      return;
    }
    void run("app", () => startAppManifest(repo), (result) => {
      if (result.ok) submitManifest(result.action, result.manifest);
    });
  }

  function saveApp() {
    if (demo) {
      setDemoFacts((f) => ({ ...f, hasAppId: true, hasAppKey: true, appInstalled: true, appSlug: "demo-ai-pipeline" }));
      return;
    }
    void run("appKeys", () => saveExistingAppKeys(repo, appId, pem), () => {
      setPem("");
      done();
    });
  }

  function confirmInstalled() {
    if (demo) {
      setDemoFacts((f) => ({ ...f, appInstalled: true }));
      return;
    }
    void run("installed", () => confirmAppInstalled(repo), done);
  }

  // ───── 3. Claude ─────
  function saveToken() {
    if (demo) {
      setToken("");
      setDemoFacts((f) => ({ ...f, hasClaudeToken: true }));
      return;
    }
    if (token.trim() === "") {
      setError(SETUP_MESSAGES.emptyToken);
      return;
    }
    void run("token", () => saveSetupClaudeToken(repo, token), () => {
      setToken("");
      done();
    });
  }

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText("claude setup-token");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // コピーできなくても、字は見えている
    }
  }

  // ───── 4. 設定：段に入ったら自動で済ませる ─────
  const settingsCurrent = steps.current === "settings" && writable;
  const [settingsTry, setSettingsTry] = useState(0);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  useEffect(() => {
    if (!settingsCurrent) return;
    let alive = true;
    if (demo) {
      const timer = window.setTimeout(() => setDemoFacts((f) => ({ ...f, deleteBranchOnMerge: true })), 600);
      return () => window.clearTimeout(timer);
    }
    void callAction(() => enableSetupDeleteBranch(repo), () => unreachable<{ ok: false; message: string }>()).then(
      (result) => {
        if (!alive) return;
        if (result.ok) router.refresh();
        else setSettingsError(result.message);
      },
    );
    return () => {
      alive = false;
    };
  }, [settingsCurrent, settingsTry, demo, repo, router]);

  // ───── 5. Check ─────
  function startDoctor() {
    setWatchError(null);
    if (demo) {
      setChecking(true);
      setDoctor(null);
      window.setTimeout(() => {
        setChecking(false);
        const result: DoctorRun = { status: "success", url: null, createdAt: new Date().toISOString() };
        setDoctor(result);
        setDemoFacts((f) => ({ ...f, doctor: result }));
      }, DEMO_DOCTOR_MS);
      return;
    }
    void run("doctor", () => startSetupDoctor(repo), () => {
      setPending(null);
      since.current = Date.now() - 10_000;
      setDoctor(null);
      setChecking(true);
    });
  }

  useEffect(() => {
    if (demo || !checking) return;
    let alive = true;
    const startedAt = Date.now();
    let timer = 0;
    async function tick() {
      const result = await callAction(
        () => pollSetupDoctor(repo, since.current),
        () => unreachable<{ ok: false; message: string }>(),
      );
      if (!alive) return;
      if (result.ok && result.run && result.run.status !== "running") {
        setChecking(false);
        setDoctor(result.run);
        setWatchError(result.watchError);
        if (result.run.status === "success") router.refresh();
        return;
      }
      if (!result.ok && result.message !== ACTION_UNREACHABLE_MESSAGE) {
        setChecking(false);
        setError(result.message);
        return;
      }
      if (Date.now() - startedAt > POLL_LIMIT_MS) {
        setChecking(false);
        setError(SETUP_MESSAGES.doctorFailed);
        return;
      }
      timer = window.setTimeout(tick, POLL_MS);
    }
    timer = window.setTimeout(tick, POLL_MS);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [checking, demo, repo, router]);

  // 診断が ✓ のまま開いたのに、まだ監視していなければ足す
  const allDone = steps.current === null;
  useEffect(() => {
    if (demo || !allDone || watched) return;
    void callAction(
      () => pollSetupDoctor(repo, null),
      () => unreachable<{ ok: false; message: string }>(),
    ).then((result) => {
      if (result.ok) setWatchError(result.watchError);
    });
  }, [allDone, watched, demo, repo]);

  // ───── 段ごとの中身 ─────
  const busy = (key: string) => pending === key;

  function relogin(): ReactNode {
    return (
      <div className={styles.line}>
        <p className={styles.sub}>
          設定を書き込むには、GitHub の repo の権限が要ります。いまのログインには足りないので、権限を足してログインし直してください
        </p>
        <form action={reloginWithRepoScope.bind(null, repo ?? "")}>
          <button type="submit" className={styles.primary}>
            権限を足してログインし直す
          </button>
        </form>
      </div>
    );
  }

  function repoBody(): ReactNode {
    return (
      <>
        {notTarget && (
          <p className={styles.error} role="alert">
            {SETUP_MESSAGES.notTarget}
          </p>
        )}
        <div className={styles.line}>
          <label className={styles.field}>
            <span className={styles.prefix}>{demo ? "demo" : login} /</span>
            <input
              className={styles.input}
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") create();
              }}
              placeholder="my-app"
              aria-label="リポジトリの名前"
              autoComplete="off"
              spellCheck={false}
              maxLength={100}
            />
          </label>
        </div>
        <div className={styles.line}>
          <Segmented options={VISIBILITY} value={visibility} onChange={setVisibility} label="公開の範囲" />
          <span className={styles.hint}>公開なら Actions は無料</span>
        </div>
        <div className={styles.line}>
          <button
            type="button"
            className={styles.primary}
            onClick={create}
            disabled={pending !== null}
            data-blocked={name.trim() === "" ? "" : undefined}
          >
            {busy("create") ? "作成中…" : "作る"}
          </button>
          <button
            type="button"
            className={styles.textButton}
            aria-expanded={picking}
            onClick={() => setPicking((open) => !open)}
          >
            作ってあるリポジトリを使う
          </button>
        </div>
        {picking && (
          <div className={styles.line}>
            {templateRepos.length === 0 && !demo ? (
              <p className={styles.sub}>{SETUP_MESSAGES.noTemplateRepos}</p>
            ) : (
              <>
                <Select
                  options={demo ? ["demo/my-app", "demo/notes-api"] : templateRepos}
                  value={picked || (demo ? "demo/my-app" : "")}
                  onChange={setPicked}
                  label="テンプレートから作ったリポジトリ"
                />
                <button
                  type="button"
                  className={styles.ghost}
                  onClick={chooseExisting}
                  disabled={pending !== null}
                >
                  {busy("pick") ? "確かめています…" : "使う"}
                </button>
              </>
            )}
          </div>
        )}
      </>
    );
  }

  function appBody(): ReactNode {
    if (steps.appPhase === "install") {
      const href = facts.appSlug && repo ? appInstallUrl(facts.appSlug, repo) : "https://github.com/settings/installations";
      return (
        <>
          <p className={styles.sub}>
            App ができました。次は、この App をリポジトリに入れてください（入れないと AI が使えません）。もう入れてあるときは「入れてある」を押してください
          </p>
          <div className={styles.line}>
            {demo ? (
              <button type="button" className={styles.primary} onClick={confirmInstalled}>
                このリポジトリに入れる
              </button>
            ) : (
              <a className={styles.primary} href={href}>
                このリポジトリに入れる
              </a>
            )}
            <button type="button" className={styles.textButton} onClick={confirmInstalled} disabled={pending !== null}>
              入れてある
            </button>
          </div>
        </>
      );
    }
    return (
      <>
        <div className={styles.line}>
          <button type="button" className={styles.primary} onClick={createApp} disabled={pending !== null}>
            {busy("app") ? "GitHub へ移動中…" : "GitHub で App を作る"}
          </button>
          <button
            type="button"
            className={styles.textButton}
            aria-expanded={haveApp}
            onClick={() => setHaveApp((open) => !open)}
          >
            App はもう持っている
          </button>
        </div>
        {haveApp && (
          <div className={styles.stack}>
            <span className={styles.label}>App ID</span>
            <label className={styles.field} data-size="id">
              <input
                className={`${styles.input} num`}
                value={appId}
                onChange={(event) => setAppId(event.target.value)}
                inputMode="numeric"
                placeholder="1234567"
                aria-label="App ID"
                autoComplete="off"
              />
            </label>
            <span className={styles.label}>秘密鍵（.pem の中身を全部）</span>
            <textarea
              className={styles.pem}
              value={pem}
              onChange={(event) => setPem(event.target.value)}
              placeholder="-----BEGIN RSA PRIVATE KEY-----"
              aria-label="秘密鍵（.pem の中身）"
              autoComplete="off"
              spellCheck={false}
            />
            <div className={styles.line}>
              <button
                type="button"
                className={styles.primary}
                onClick={saveApp}
                disabled={pending !== null}
                data-blocked={!demo && (appId.trim() === "" || pem.trim() === "") ? "" : undefined}
              >
                {busy("appKeys") ? "保存中…" : "保存"}
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  function claudeBody(): ReactNode {
    const ready = claudeInstalled && (demo || token.trim() !== "");
    return (
      <>
        <div className={styles.part}>
          <span className={styles.partHead}>
            <span className={styles.num}>1</span> GitHub にアプリを入れる
          </span>
          <div className={styles.line}>
            <a className={styles.ghost} href={CLAUDE_APP_INSTALL_URL} target="_blank" rel="noreferrer">
              Claude のアプリを入れる ↗
            </a>
            <button
              type="button"
              role="checkbox"
              aria-checked={claudeInstalled}
              className={formStyles.toggle}
              onClick={() => setClaudeInstalled((on) => !on)}
            >
              <span className={formStyles.lamp} aria-hidden="true" />
              入れた
            </button>
          </div>
        </div>
        <div className={styles.part}>
          <span className={styles.partHead}>
            <span className={styles.num}>2</span> トークンを作って貼る
          </span>
          <div className={styles.line}>
            <code className={styles.command}>claude setup-token</code>
            <button type="button" className={styles.ghost} onClick={copyCommand}>
              {copied ? "コピーしました" : "コピー"}
            </button>
          </div>
          <p className={styles.hint}>ターミナルで打つと、トークンが出ます。出た文字列を下に貼ってください</p>
          <div className={styles.line}>
            <label className={styles.field} data-size="token">
              <input
                className={styles.input}
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="sk-ant-oat01-…"
                aria-label="Claude のトークン"
                autoComplete="off"
              />
            </label>
            <button
              type="button"
              className={styles.primary}
              onClick={saveToken}
              disabled={pending !== null || !claudeInstalled}
              data-blocked={ready ? undefined : ""}
            >
              {busy("token") ? "保存中…" : "保存"}
            </button>
          </div>
        </div>
      </>
    );
  }

  function settingsBody(): ReactNode {
    if (settingsError) {
      return (
        <>
          <p className={styles.error} role="alert">
            {settingsError}
          </p>
          <div className={styles.line}>
            <button
              type="button"
              className={styles.textButton}
              onClick={() => {
                setSettingsError(null);
                setSettingsTry((n) => n + 1);
              }}
            >
              もう一度
            </button>
          </div>
        </>
      );
    }
    return (
      <p className={styles.status} role="status">
        <span className={styles.spin} aria-hidden="true">
          <SpinnerIcon />
        </span>
        マージ後のブランチを自動で消す設定にしています…
      </p>
    );
  }

  function verdict(result: DoctorRun): ReactNode {
    const ok = result.status === "success";
    return (
      <div className={styles.line}>
        <span className={styles.verdict} data-ok={ok ? "" : undefined}>
          {ok ? <CheckIcon /> : <CrossIcon />}
          {ok ? "診断に通りました" : "診断で直す所が見つかりました"}
        </span>
        {result.url && (
          <a className={styles.link} href={result.url} target="_blank" rel="noreferrer">
            結果を見る ↗
          </a>
        )}
      </div>
    );
  }

  function checkBody(): ReactNode {
    if (checking) {
      return (
        <p className={styles.status} role="status">
          <span className={styles.spin} aria-hidden="true">
            <SpinnerIcon />
          </span>
          診断中…
        </p>
      );
    }
    return (
      <>
        {doctor && doctor.status !== "running" && verdict(doctor)}
        <div className={styles.line}>
          <button type="button" className={styles.primary} onClick={startDoctor} disabled={pending !== null}>
            {busy("doctor") ? "始めています…" : doctor ? "もう一度診断する" : "診断する"}
          </button>
        </div>
      </>
    );
  }

  const bodies: Record<SetupStepId, () => ReactNode> = {
    repo: repoBody,
    app: appBody,
    claude: claudeBody,
    settings: settingsBody,
    check: checkBody,
  };

  const results: Record<SetupStepId, string> = {
    repo: repo ?? "",
    app: facts.appSlug ?? "App",
    claude: "保存済み",
    settings: "オン",
    check: "診断に通りました",
  };

  const parsedRepo = parseSetupRepo(repo);
  const firstIssue = demo ? "/demo/new" : newIssueHref(basePath, parsedRepo);

  return (
    <main id="main" className={styles.page}>
      <h1 className={styles.h1}>
        <span className={styles.h1En}>Setup</span>
        <span className={styles.h1Ja}>導入</span>
      </h1>
      <p className={styles.lead}>上から順に進めてください。終われば、あとは Issue を書くだけです</p>
      {notice && (
        <p className={styles.notice} role="alert">
          {notice}
        </p>
      )}
      <ol className={styles.panel}>
        {SETUP_STEP_IDS.map((id, index) => {
          const status = steps.status[id];
          return (
            <li key={id} className={styles.step} data-status={status} aria-current={status === "current" ? "step" : undefined}>
              <span className={`${styles.mark} num`} aria-hidden="true">
                {status === "done" ? <CheckIcon /> : index + 1}
              </span>
              <div className={styles.head}>
                <span className={styles.name}>
                  {STEP_NAMES[id]}
                  <span className={styles.srOnly}>
                    {status === "done" ? "（済み）" : status === "current" ? "（今の段）" : "（まだ）"}
                  </span>
                </span>
                {status === "current" && <span className={styles.desc}>{STEP_DESCRIPTIONS[id]}</span>}
                {status === "current" && <span className={styles.desc}>{STEP_TROUBLES[id]}</span>}
              </div>
              {status === "done" && (
                <span className={styles.result} title={results[id]}>
                  {results[id]}
                </span>
              )}
              {status === "current" && (
                <div className={styles.body}>
                  {!writable ? relogin() : bodies[id]()}
                  {error && (
                    <p className={styles.error} role="alert">
                      {error}
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {allDone && (
        <section className={styles.done} aria-label="Done">
          <div className={styles.doneHead}>
            <span className={styles.doneEn}>Done</span>
            <span className={styles.doneJa}>監視に足しました。あとは Issue を書くだけです</span>
          </div>
          {watchError && (
            <p className={styles.error} role="alert">
              {watchError}
            </p>
          )}
          <Link className={styles.primary} href={firstIssue}>
            <WriteIcon />
            最初の Issue を書く
          </Link>
        </section>
      )}
    </main>
  );
}
