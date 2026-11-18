import {
  AUTO_ADD_VARIABLE,
  decideAutoAddCheck,
  factorySignal,
  formatAddedLog,
  parseAddedLog,
  parseAutoAddEnabled,
  pickAutoAddRepos,
  watchedTemplates,
  type AddedEntry,
  type OwnedRepo,
} from "../autoAdd";
import { chooseWatchedRepos, parseRepoList, type Env, type WatchedRepo } from "../config";
import { formatRepoList } from "../repoSetting";
import { GitHubClient, type Fetcher } from "./client";
import { readVariable, WATCHED_REPOS_VARIABLE, writeVariable } from "./settings";
import type { RepoResult } from "./types";

// 工場が作った新しいリポジトリを、監視リストに自動で足す（docs/spec.md の「新しいサービスを自動で足す」）。
// GitHub はログインした人のトークンで、`fetch` で直接呼ぶ。サーバーだけで使う（トークンは画面に渡さない）。

/** 自動で足すか（`on` / `off`。無ければオン）。名前は `src/lib/autoAdd.ts` に置いた物 */
export { AUTO_ADD_VARIABLE };
/** 設定画面で「外す」を押したリポジトリ（`owner/repo` のカンマ区切り）。自動では足し直さない */
export const REMOVED_REPOS_VARIABLE = "AGENT_DESK_REMOVED_REPOS";
/** 自動で足したリポジトリと時刻（`owner/repo@ISO時刻` のカンマ区切り）。「いまの様子」のお知らせに使う */
export const AUTO_ADDED_VARIABLE = "AGENT_DESK_AUTO_ADDED";

/** 足した記録を覚えておく長さ（この間は Variable を読み直さない。自分で書いたらすぐ覚え直す） */
export const ADDED_LOG_CACHE_MS = 5 * 60_000;
/** 調べるリポジトリの数（作った順に新しい物から） */
export const OWNED_REPOS_LIMIT = 50;

export const OWNED_REPOS_QUERY = `query OwnedRepos($first: Int!) {
  rateLimit { cost remaining resetAt }
  viewer {
    repositories(first: $first, ownerAffiliations: OWNER, orderBy: { field: CREATED_AT, direction: DESC }) {
      nodes { nameWithOwner templateRepository { nameWithOwner } }
    }
  }
}`;

/** GraphQL の返事から、リポジトリと、それを作ったテンプレートを読む（形が違う物は捨てる） */
export function parseOwnedRepos(data: unknown): OwnedRepo[] {
  const nodes = (data as { viewer?: { repositories?: { nodes?: unknown } } } | null)?.viewer?.repositories?.nodes;
  if (!Array.isArray(nodes)) return [];
  const repos: OwnedRepo[] = [];
  for (const node of nodes as Array<{ nameWithOwner?: unknown; templateRepository?: { nameWithOwner?: unknown } | null } | null>) {
    if (typeof node?.nameWithOwner !== "string") continue;
    const template = node.templateRepository?.nameWithOwner;
    repos.push({ name: node.nameWithOwner, template: typeof template === "string" ? template : null });
  }
  return repos;
}

/** ログイン中のユーザーが持ち主のリポジトリ（作った順に新しい物から最大50件）と、それを作ったテンプレート。GraphQL を1回 */
export async function fetchOwnedRepos(client: GitHubClient): Promise<OwnedRepo[]> {
  return parseOwnedRepos(await client.graphql(OWNED_REPOS_QUERY, { first: OWNED_REPOS_LIMIT }));
}

/** サーバーのメモリに覚える物（再起動で消えてよい）。キーは設定の保存先 */
type State = {
  lastCheckedAt: number | null;
  /** 前に見た「新サービス：」の Issue の様子。まだ見ていなければ null（初めての同期で1回調べる） */
  signal: string | null;
  /** 下限の時間の中で待たせているきっかけがあるか */
  pending: boolean;
  /** 手で押す「同期」があった */
  forced: boolean;
  /** 足した記録と、読んだ時刻 */
  log: { entries: AddedEntry[]; readAt: number } | null;
};

const states = new Map<string, State>();

function stateOf(settingsRepo: WatchedRepo): State {
  const k = `${settingsRepo.owner}/${settingsRepo.repo}`.toLowerCase();
  let state = states.get(k);
  if (!state) {
    state = { lastCheckedAt: null, signal: null, pending: false, forced: false, log: null };
    states.set(k, state);
  }
  return state;
}

/** テスト用 */
export const autoAddStateForTest = { clear: (): void => states.clear() };

/** 手で押す「同期」：次の同期で調べるきっかけにする（下限の時間の中なら、たった後で調べる） */
export function requestAutoAddCheck(settingsRepo: WatchedRepo | null): void {
  if (settingsRepo) stateOf(settingsRepo).forced = true;
}

export type RunAutoAddInput = {
  token: string;
  login: string | null;
  settingsRepo: WatchedRepo | null;
  /** いまの同期の結果（テンプレートか・「新サービス：」の Issue を見る） */
  results: RepoResult[];
  now: Date;
  fetcher?: Fetcher;
  env?: Env;
};

/**
 * 同期のあとで呼ぶ。監視リストにテンプレートがあり、きっかけ（手で押す「同期」・「新サービス：」の Issue の変化）があり、
 * 前に調べてから下限の時間がたっていて、設定がオンのときだけ、テンプレートから作られたリポジトリを探して監視リストに足す。
 * 足したリポジトリを返す。失敗しても同期の表示は落とさない（空を返す）
 */
export async function runAutoAdd(input: RunAutoAddInput): Promise<WatchedRepo[]> {
  const templates = watchedTemplates(input.results);
  // テンプレートが無い・保存先が無い・ログインしていないときは、何も呼ばず、何も変えない
  if (templates.length === 0 || !input.settingsRepo || !input.login) return [];
  const state = stateOf(input.settingsRepo);
  const signal = factorySignal(input.results);
  const changed = state.signal !== signal;
  state.signal = signal;
  const decision = decideAutoAddCheck({
    templateCount: templates.length,
    requested: state.forced || changed || state.pending,
    lastCheckedAt: state.lastCheckedAt,
    now: input.now.getTime(),
  });
  state.forced = false;
  state.pending = decision.pending;
  if (!decision.check) return [];
  state.lastCheckedAt = input.now.getTime();

  const client = new GitHubClient(input.token, input.fetcher);
  const settingsRepo = input.settingsRepo;
  try {
    if (!parseAutoAddEnabled(await readVariable(client, settingsRepo, AUTO_ADD_VARIABLE))) return [];
    const candidates = await fetchOwnedRepos(client);
    // 足す前に、保存先の一覧を読み直す（設定画面で変えた直後でも消さないため）
    const [watchedValue, removedValue] = await Promise.all([
      readVariable(client, settingsRepo, WATCHED_REPOS_VARIABLE),
      readVariable(client, settingsRepo, REMOVED_REPOS_VARIABLE),
    ]);
    const watched = chooseWatchedRepos(watchedValue, input.env).repos;
    const added = pickAutoAddRepos({
      enabled: true,
      login: input.login,
      watched,
      templates,
      removed: parseRepoList(removedValue),
      candidates,
    });
    if (added.length === 0) return [];
    await writeVariable(client, settingsRepo, WATCHED_REPOS_VARIABLE, formatRepoList([...watched, ...added]));
    const entries = parseAddedLog(await readVariable(client, settingsRepo, AUTO_ADDED_VARIABLE));
    const value = formatAddedLog(entries, added, input.now);
    await writeVariable(client, settingsRepo, AUTO_ADDED_VARIABLE, value);
    state.log = { entries: parseAddedLog(value), readAt: input.now.getTime() };
    return added;
  } catch {
    return [];
  }
}

/**
 * 足した記録（「いまの様子」のお知らせ用）。監視リストにテンプレートがあるときだけ読む（無ければ呼ばない）。
 * 読んだ物は5分覚え、その間は GitHub に問い合わせない。読めなければ空
 */
export async function loadAddedLog(input: {
  token: string;
  settingsRepo: WatchedRepo | null;
  results: RepoResult[];
  now: Date;
  fetcher?: Fetcher;
}): Promise<AddedEntry[]> {
  if (!input.settingsRepo || watchedTemplates(input.results).length === 0) return [];
  const state = stateOf(input.settingsRepo);
  if (state.log && input.now.getTime() - state.log.readAt < ADDED_LOG_CACHE_MS) return state.log.entries;
  try {
    const value = await readVariable(new GitHubClient(input.token, input.fetcher), input.settingsRepo, AUTO_ADDED_VARIABLE);
    state.log = { entries: parseAddedLog(value), readAt: input.now.getTime() };
    return state.log.entries;
  } catch {
    return state.log?.entries ?? [];
  }
}
