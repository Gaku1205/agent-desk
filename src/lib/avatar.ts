/** ログイン名の頭文字（アイコンが読めないときに出す）。先頭の1字を大文字に、空なら `?` */
export function avatarInitial(login: string): string {
  const first = Array.from(login.trim())[0];
  return first ? first.toUpperCase() : "?";
}

/** GitHub のアイコンの URL（API は呼ばず、ブラウザが github.com から画像を読む） */
export function avatarUrl(login: string, size = 48): string {
  return `https://github.com/${encodeURIComponent(login)}.png?size=${size}`;
}
