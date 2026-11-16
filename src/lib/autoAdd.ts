import { parseRepoList, type WatchedRepo } from "./config";
import { isFactoryTitle } from "./factoryIssue";
import type { RepoResult } from "./github/types";

/**
 * 工場が作った新しいリポジトリを、監視リストに自動で足す（docs/spec.md の「新しいサービスを自動で足す」）。
 * ここは入力から出力が決まる純粋関数だけ。GitHub を呼ぶ所は `src/lib/github/autoAdd.ts`
 */

/** 調べ直しの下限：前に調べてから、これだけは調べ直さない */
export const AUTO_ADD_MIN_INTERVAL_MS = 5 * 60_000;
/** 「いまの様子」に「監視に追加しました」を出しておく長さ */
export const ADDED_NOTICE_MS = 24 * 60 * 60_000;
/** 足した時刻の記録に残す件数（古い物から捨てる） */
export const ADDED_LOG_MAX_ENTRIES = 20;

const key = (owner: string, repo: string) => `${owner}/${repo}`.toLowerCase();
const repoKey = (repo: WatchedRepo) => key(repo.owner, repo.repo);

/** 自動で足すか（Variable `AGENT_DESK_AUTO_ADD`）。無い・`off` 以外は初期のオン */
export function parseAutoAddEnabled(value: string | null | undefined): boolean {
  return value?.trim().toLowerCase() !== "off";
}

export function formatAutoAddEnabled(enabled: boolean): "on" | "off" {
  return enabled ? "on" : "off";
}

/** 監視リストのうち、テンプレートリポジトリ（`is_template` が true と取れた物） */
export function watchedTemplates(results: RepoResult[]): WatchedRepo[] {
  return results
    .filter((result) => result.ok && result.data.isTemplate === true)
    .map(({ owner, repo }) => ({ owner, repo }));
}

/**
 * テンプレートの「新サービス：」の Issue の様子を1つの文字列にする（開閉を問わず、番号と更新の時刻）。
 * 前と違えば「その Issue が閉じた・動いた」ので、調べるきっかけにする
 */
export function factorySignal(results: RepoResult[]): string {
  const parts: string[] = [];
  for (const result of results) {
    if (!result.ok || result.data.isTemplate !== true) continue;
    for (const issue of result.data.issues) {
      if (!isFactoryTitle(issue.title)) continue;
      parts.push(`${key(result.owner, result.repo)}#${issue.number}:${issue.state}:${issue.updatedAt}`);
    }
  }
  return parts.sort().join("|");
}

export type AutoAddCheckInput = {
  /** 監視リストのテンプレートの数 */
  templateCount: number;
  /** 調べるきっかけがあったか（手で押す「同期」・「新サービス：」の Issue の変化・下限で待たせた物） */
  requested: boolean;
  /** 前に調べた時刻（ミリ秒）。まだなら null */
  lastCheckedAt: number | null;
  now: number;
};

/**
 * 今調べるか。テンプレートが無ければ調べない（待たせもしない）。
 * きっかけがあっても、前に調べてから下限の時間がたっていなければ待たせ（`pending`）、たった後の最初の同期で1回だけ調べる
 */
export function decideAutoAddCheck(input: AutoAddCheckInput): { check: boolean; pending: boolean } {
  if (input.templateCount === 0 || !input.requested) return { check: false, pending: false };
  if (input.lastCheckedAt !== null && input.now - input.lastCheckedAt < AUTO_ADD_MIN_INTERVAL_MS) {
    return { check: false, pending: true };
  }
  return { check: true, pending: false };
}

/** ログイン中のユーザーのリポジトリ1つと、それを作ったテンプレート（`owner/repo`。テンプレートから作っていなければ null） */
export type OwnedRepo = { name: string; template: string | null };

export type PickAutoAddInput = {
  /** 自動で足すか（設定のオン・オフ） */
  enabled: boolean;
  /** ログイン中のユーザー名 */
  login: string | null;
  /** いまの監視リスト */
  watched: WatchedRepo[];
  /** 監視リストのテンプレート */
  templates: WatchedRepo[];
  /** 「外す」を押したリポジトリ */
  removed: WatchedRepo[];
  /** ログイン中のユーザーのリポジトリ */
  candidates: OwnedRepo[];
};

/**
 * 足すリポジトリ：監視リストのテンプレートから作られ、持ち主がログイン中のユーザーで、
 * まだ監視しておらず、外したことも無い物（候補の順。重ねない）。オフ・テンプレート無しなら空
 */
export function pickAutoAddRepos(input: PickAutoAddInput): WatchedRepo[] {
  if (!input.enabled || !input.login || input.templates.length === 0) return [];
  const login = input.login.toLowerCase();
  const templates = new Set(input.templates.map(repoKey));
  const skip = new Set([...input.watched.map(repoKey), ...input.removed.map(repoKey)]);
  const picked: WatchedRepo[] = [];
  for (const candidate of input.candidates) {
    if (!candidate.template || !templates.has(candidate.template.toLowerCase())) continue;
    const [repo] = parseRepoList(candidate.name);
    if (!repo || repo.owner.toLowerCase() !== login) continue;
    if (skip.has(repoKey(repo))) continue;
    skip.add(repoKey(repo));
    picked.push(repo);
  }
  return picked;
}

/**
 * 設定画面で監視リストを保存したときの「外した物」の記憶：前の一覧から消えた物を覚え、
 * 新しい一覧にある物（手で足し直した物）は記憶から消す
 */
export function updateRemovedRepos(
  previous: WatchedRepo[],
  next: WatchedRepo[],
  removed: WatchedRepo[],
): WatchedRepo[] {
  const listed = new Set(next.map(repoKey));
  const result: WatchedRepo[] = [];
  const seen = new Set<string>();
  for (const repo of [...removed, ...previous]) {
    const k = repoKey(repo);
    if (listed.has(k) || seen.has(k)) continue;
    seen.add(k);
    result.push(repo);
  }
  return result;
}

/** 足した記録の1件：リポジトリ（`owner/repo`）と足した時刻（ISO文字列） */
export type AddedEntry = { repo: string; at: string };

/** Variable `AGENT_DESK_AUTO_ADDED`（`owner/repo@ISO時刻` のカンマ区切り）を読む。形が合わない物は捨てる */
export function parseAddedLog(value: string | null | undefined): AddedEntry[] {
  if (!value) return [];
  const entries: AddedEntry[] = [];
  for (const item of value.split(",")) {
    const at = item.lastIndexOf("@");
    if (at <= 0) continue;
    const [repo] = parseRepoList(item.slice(0, at));
    const time = Date.parse(item.slice(at + 1).trim());
    if (!repo || Number.isNaN(time)) continue;
    entries.push({ repo: `${repo.owner}/${repo.repo}`, at: new Date(time).toISOString() });
  }
  return entries;
}

/** 足した記録に足して、書く形にする（新しい物を後ろに。最大 ADDED_LOG_MAX_ENTRIES 件） */
export function formatAddedLog(entries: AddedEntry[], added: WatchedRepo[], at: Date): string {
  const next = [...entries, ...added.map((repo) => ({ repo: `${repo.owner}/${repo.repo}`, at: at.toISOString() }))];
  return next
    .slice(-ADDED_LOG_MAX_ENTRIES)
    .map((entry) => `${entry.repo}@${entry.at}`)
    .join(",");
}

/** 「いまの様子」のお知らせ：自動で監視に足したリポジトリ */
export type AddedNotice = { owner: string; repo: string; at: string };

/**
 * 出すお知らせ：足してから ADDED_NOTICE_MS の間で、まだ監視しているリポジトリ（1つにつき1行。いちばん新しい時刻）。
 * 新しい順
 */
export function buildAddedNotices(entries: AddedEntry[], watched: WatchedRepo[], now: Date): AddedNotice[] {
  const listed = new Map(watched.map((repo) => [repoKey(repo), repo]));
  const latest = new Map<string, AddedNotice>();
  for (const entry of entries) {
    const time = Date.parse(entry.at);
    if (Number.isNaN(time) || time > now.getTime() || now.getTime() - time >= ADDED_NOTICE_MS) continue;
    const [repo] = parseRepoList(entry.repo);
    const target = repo ? listed.get(repoKey(repo)) : undefined;
    if (!target) continue;
    const prev = latest.get(repoKey(target));
    if (!prev || Date.parse(prev.at) < time) latest.set(repoKey(target), { ...target, at: entry.at });
  }
  return [...latest.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** お知らせの文：`morning-card を監視に追加しました`（2つ以上のリポジトリを出すときも、`owner/` は省く） */
export function addedNoticeText(notice: AddedNotice): string {
  return `${notice.repo} を監視に追加しました`;
}
