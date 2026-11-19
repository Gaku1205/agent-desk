// 手で押した「同期」の待ち（docs/spec.md の「更新」）。取り直しの結果が届かないまま待ち続けない

/** 同期を押したあと、反映が届かなくても「同期中」を止める上限 */
export const SYNC_WAIT_LIMIT_MS = 30_000;

/**
 * 同期の時刻の決め方。手で押した同期が届かなかった（上限で止めた・呼び出しが失敗した）ときは、
 * 取り直せていないので進めず、最後に取り直せた時刻へ戻す。届いたなら押した時刻のまま
 */
export function requestedAtAfterSync(options: {
  requestedAt: Date;
  lastSyncedAt: Date;
  reached: boolean;
}): Date {
  return options.reached ? options.requestedAt : options.lastSyncedAt;
}
