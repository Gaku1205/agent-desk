import { describe, expect, it } from "vitest";
import {
  addInstalledRepo,
  checkRepoNameInput,
  computeSetupSteps,
  EMPTY_FACTS,
  hasRepoScope,
  isInstalledRepo,
  isSetupTarget,
  parseSetupRepo,
  pickDoctorRun,
  readRepoInfo,
  setupErrorMessage,
  templateReposOf,
  type SetupFacts,
} from "./setupState";

const READY: SetupFacts = {
  ...EMPTY_FACTS,
  repo: "Gaku1205/my-app",
  repoReady: true,
};

describe("computeSetupSteps（開き直しても、GitHub の状態から今の段が出る）", () => {
  it("リポジトリが無ければ Repository が今、残りはまだ", () => {
    const steps = computeSetupSteps(EMPTY_FACTS);
    expect(steps.current).toBe("repo");
    expect(steps.status).toEqual({
      repo: "current",
      app: "todo",
      claude: "todo",
      settings: "todo",
      check: "todo",
    });
  });

  it("使えないリポジトリなら Repository のまま", () => {
    expect(computeSetupSteps({ ...EMPTY_FACTS, repo: "someone/else" }).current).toBe("repo");
  });

  it("リポジトリがあれば Pipeline App が今（まだ作っていない）", () => {
    const steps = computeSetupSteps(READY);
    expect(steps.status.repo).toBe("done");
    expect(steps.current).toBe("app");
    expect(steps.appPhase).toBe("create");
  });

  it("鍵が入って、まだ入れていなければ App の段の「入れる」", () => {
    const steps = computeSetupSteps({ ...READY, hasAppId: true, hasAppKey: true });
    expect(steps.current).toBe("app");
    expect(steps.appPhase).toBe("install");
  });

  it("片方の鍵しか無ければ、作るところから", () => {
    expect(computeSetupSteps({ ...READY, hasAppId: true, appInstalled: true }).appPhase).toBe("create");
    expect(computeSetupSteps({ ...READY, hasAppId: true, appInstalled: true }).current).toBe("app");
  });

  it("App が入れば Claude、トークンがあれば設定、設定がオンなら Check", () => {
    const app = { ...READY, hasAppId: true, hasAppKey: true, appInstalled: true };
    expect(computeSetupSteps(app).current).toBe("claude");
    expect(computeSetupSteps({ ...app, hasClaudeToken: true }).current).toBe("settings");
    expect(computeSetupSteps({ ...app, hasClaudeToken: true, deleteBranchOnMerge: true }).current).toBe("check");
  });

  it("Doctor が success なら全部済み。failure・running なら Check のまま", () => {
    const all = {
      ...READY,
      hasAppId: true,
      hasAppKey: true,
      appInstalled: true,
      hasClaudeToken: true,
      deleteBranchOnMerge: true,
    };
    const run = { url: null, createdAt: "2026-11-18T00:00:00Z" };
    expect(computeSetupSteps({ ...all, doctor: { ...run, status: "success" } }).current).toBeNull();
    expect(computeSetupSteps({ ...all, doctor: { ...run, status: "failure" } }).current).toBe("check");
    expect(computeSetupSteps({ ...all, doctor: { ...run, status: "running" } }).current).toBe("check");
  });

  it("前の段が済んでいなければ、後ろの段が済んでいても「まだ」", () => {
    const steps = computeSetupSteps({
      ...READY,
      hasClaudeToken: true,
      deleteBranchOnMerge: true,
      doctor: { status: "success", url: null, createdAt: "2026-11-18T00:00:00Z" },
    });
    expect(steps.current).toBe("app");
    expect(steps.status.claude).toBe("todo");
    expect(steps.status.check).toBe("todo");
  });
});

describe("isSetupTarget（本人の物で、テンプレートから作られた物だけ）", () => {
  const info = (owner: string, template: string | null) =>
    readRepoInfo({ full_name: `${owner}/my-app`, owner: { login: owner }, template_repository: template ? { full_name: template } : null });

  it("本人の物で、ai-dev-template から作られた物は通す（大文字小文字は区別しない）", () => {
    expect(isSetupTarget("gaku1205", info("Gaku1205", "gaku1205/AI-DEV-TEMPLATE"))).toBe(true);
  });

  it("テンプレートから作られていない物は通さない", () => {
    expect(isSetupTarget("Gaku1205", info("Gaku1205", null))).toBe(false);
    expect(isSetupTarget("Gaku1205", info("Gaku1205", "someone/other-template"))).toBe(false);
  });

  it("本人の物でない物は通さない", () => {
    expect(isSetupTarget("Gaku1205", info("someone", "Gaku1205/ai-dev-template"))).toBe(false);
  });

  it("ログインしていない・読めないときは通さない", () => {
    expect(isSetupTarget(null, info("Gaku1205", "Gaku1205/ai-dev-template"))).toBe(false);
    expect(isSetupTarget("Gaku1205", null)).toBe(false);
  });
});

describe("readRepoInfo", () => {
  it("要る物だけを読む", () => {
    expect(
      readRepoInfo({
        full_name: "Gaku1205/my-app",
        owner: { login: "Gaku1205" },
        template_repository: { full_name: "Gaku1205/ai-dev-template" },
        delete_branch_on_merge: true,
        default_branch: "trunk",
      }),
    ).toEqual({
      fullName: "Gaku1205/my-app",
      ownerLogin: "Gaku1205",
      template: "Gaku1205/ai-dev-template",
      deleteBranchOnMerge: true,
      defaultBranch: "trunk",
    });
  });

  it("形が違えば null。足りない物は既定", () => {
    expect(readRepoInfo(null)).toBeNull();
    expect(readRepoInfo({ full_name: "a/b" })).toBeNull();
    expect(readRepoInfo({ full_name: "a/b", owner: { login: "a" } })).toMatchObject({
      template: null,
      deleteBranchOnMerge: false,
      defaultBranch: "main",
    });
  });
});

describe("名前の確かめ", () => {
  it("新しいリポジトリの名前", () => {
    expect(checkRepoNameInput(" my-app ")).toBe("my-app");
    expect(checkRepoNameInput("a.b_c-1")).toBe("a.b_c-1");
    expect(checkRepoNameInput("")).toBeNull();
    expect(checkRepoNameInput("a/b")).toBeNull();
    expect(checkRepoNameInput("..")).toBeNull();
    expect(checkRepoNameInput("日本語")).toBeNull();
    expect(checkRepoNameInput("x".repeat(101))).toBeNull();
    expect(checkRepoNameInput(3)).toBeNull();
  });

  it("owner/name", () => {
    expect(parseSetupRepo("Gaku1205/my-app")).toEqual({ owner: "Gaku1205", repo: "my-app" });
    expect(parseSetupRepo("Gaku1205")).toBeNull();
    expect(parseSetupRepo("a/b/c")).toBeNull();
    expect(parseSetupRepo("a b/c")).toBeNull();
    expect(parseSetupRepo(null)).toBeNull();
  });
});

describe("templateReposOf", () => {
  it("自分の物で、テンプレートから作られた物だけ", () => {
    expect(
      templateReposOf(
        [
          { name: "Gaku1205/a", template: "Gaku1205/ai-dev-template" },
          { name: "Gaku1205/b", template: null },
          { name: "Gaku1205/c", template: "x/other" },
          { name: "org/d", template: "Gaku1205/ai-dev-template" },
        ],
        "gaku1205",
      ),
    ).toEqual(["Gaku1205/a"]);
  });
});

describe("hasRepoScope", () => {
  it("`repo` があるときだけ", () => {
    expect(hasRepoScope("read:user, repo")).toBe(true);
    expect(hasRepoScope("repo")).toBe(true);
    expect(hasRepoScope("read:user, public_repo")).toBe(false);
    expect(hasRepoScope("repo:status")).toBe(false);
    expect(hasRepoScope(null)).toBe(false);
  });
});

describe("pickDoctorRun", () => {
  const runs = {
    workflow_runs: [
      {
        status: "completed",
        conclusion: "failure",
        html_url: "https://github.com/a/b/actions/runs/1",
        created_at: "2026-11-18T10:00:00Z",
      },
      {
        status: "completed",
        conclusion: "success",
        html_url: "https://github.com/a/b/actions/runs/2",
        created_at: "2026-11-18T10:05:00Z",
      },
    ],
  };

  it("いちばん新しい物の結果（conclusion で ✓／✗）", () => {
    expect(pickDoctorRun(runs)).toEqual({
      status: "success",
      url: "https://github.com/a/b/actions/runs/2",
      createdAt: "2026-11-18T10:05:00Z",
    });
  });

  it("押した時刻より前の物は見ない", () => {
    expect(pickDoctorRun(runs, Date.parse("2026-11-18T10:06:00Z"))).toBeNull();
    expect(pickDoctorRun(runs, Date.parse("2026-11-18T09:59:00Z"))?.status).toBe("success");
  });

  it("終わっていなければ running、success 以外は failure", () => {
    expect(
      pickDoctorRun({ workflow_runs: [{ status: "in_progress", conclusion: null, created_at: "2026-11-18T10:00:00Z" }] })
        ?.status,
    ).toBe("running");
    expect(
      pickDoctorRun({ workflow_runs: [{ status: "completed", conclusion: "cancelled", created_at: "2026-11-18T10:00:00Z" }] })
        ?.status,
    ).toBe("failure");
  });

  it("GitHub 以外のリンクは出さない。形が違えば null", () => {
    expect(
      pickDoctorRun({ workflow_runs: [{ status: "completed", conclusion: "success", html_url: "https://evil.example/", created_at: "2026-11-18T10:00:00Z" }] })
        ?.url,
    ).toBeNull();
    expect(pickDoctorRun(null)).toBeNull();
    expect(pickDoctorRun({ workflow_runs: [] })).toBeNull();
  });
});

describe("入れたリポジトリの Cookie", () => {
  it("足す・見る（大文字小文字は区別しない）", () => {
    const value = addInstalledRepo(undefined, "Gaku1205/My-App");
    expect(value).toBe("gaku1205/my-app");
    expect(isInstalledRepo(value, "gaku1205/my-app")).toBe(true);
    expect(isInstalledRepo(value, "gaku1205/other")).toBe(false);
    expect(addInstalledRepo(value, "gaku1205/my-app")).toBe("gaku1205/my-app");
  });

  it("形が違う物は捨て、20件まで", () => {
    expect(isInstalledRepo("bad,,a/b", "a/b")).toBe(true);
    let value = "";
    for (let i = 0; i < 25; i++) value = addInstalledRepo(value, `a/r${i}`);
    expect(value.split(",")).toHaveLength(20);
    expect(isInstalledRepo(value, "a/r0")).toBe(false);
    expect(isInstalledRepo(value, "a/r24")).toBe(true);
  });
});

describe("setupErrorMessage", () => {
  it("決まった物だけ", () => {
    expect(setupErrorMessage("state")).toBe("App を作る途中で、GitHub から戻れませんでした。もう一度 App を作るところからやり直してください");
    expect(setupErrorMessage("<script>")).toBeNull();
    expect(setupErrorMessage(["state"])).toBeNull();
  });
});
