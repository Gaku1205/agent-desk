import { describe, expect, it } from "vitest";
import {
  appInstallUrl,
  buildAppManifest,
  defaultAppName,
  isAppSlug,
  manifestFormUrl,
  requestOrigin,
} from "./appManifest";

describe("buildAppManifest", () => {
  const manifest = buildAppManifest({ login: "Gaku1205", origin: "https://desk.example.com/", repo: "Gaku1205/my-app" });

  it("権限は docs/pipeline-setup.md と同じ7つ（Actions・Checks・Commit statuses が Read、ほか4つが Read and write）", () => {
    expect(manifest.default_permissions).toEqual({
      actions: "read",
      checks: "read",
      statuses: "read",
      contents: "write",
      issues: "write",
      pull_requests: "write",
      workflows: "write",
    });
    expect(manifest.default_events).toEqual([]);
  });

  it("Webhook は無効、Only on this account", () => {
    expect(manifest.hook_attributes.active).toBe(false);
    expect(manifest.public).toBe(false);
  });

  it("名前・戻り先", () => {
    expect(manifest.name).toBe("Gaku1205-ai-pipeline");
    expect(manifest.url).toBe("https://desk.example.com");
    expect(manifest.redirect_url).toBe("https://desk.example.com/api/setup/app");
    expect(manifest.setup_url).toBe("https://desk.example.com/api/setup/installed?repo=Gaku1205%2Fmy-app");
    expect(manifest.setup_on_update).toBe(true);
  });

  it("App の名前は34文字まで", () => {
    expect(defaultAppName("a".repeat(39))).toHaveLength(34);
  });
});

describe("URL", () => {
  it("Manifest を送る先と、入れる画面", () => {
    expect(manifestFormUrl("ab_c-1")).toBe("https://github.com/settings/apps/new?state=ab_c-1");
    expect(appInstallUrl("gaku-ai-pipeline", "Gaku1205/my-app")).toBe(
      "https://github.com/apps/gaku-ai-pipeline/installations/new?state=Gaku1205%2Fmy-app",
    );
  });

  it("slug の形", () => {
    expect(isAppSlug("gaku1205-ai-pipeline")).toBe(true);
    expect(isAppSlug("../x")).toBe(false);
    expect(isAppSlug(3)).toBe(false);
  });

  it("このアプリの URL", () => {
    expect(requestOrigin({ authUrl: "https://desk.example.com/api/auth", host: "x", proto: null })).toBe(
      "https://desk.example.com",
    );
    expect(requestOrigin({ host: "desk.example.com", proto: "http" })).toBe("https://desk.example.com");
    expect(requestOrigin({ host: "localhost:3000", proto: null })).toBe("http://localhost:3000");
    expect(requestOrigin({ host: "evil.com/path", proto: null })).toBeNull();
    expect(requestOrigin({ host: null, proto: null })).toBeNull();
  });
});
