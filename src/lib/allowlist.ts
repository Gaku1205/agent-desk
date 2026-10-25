/** GitHubのユーザー名が許可リストに入っているか。大文字小文字は区別しない */
export function isAllowedLogin(
  login: string | null | undefined,
  allowedLogins: string[],
): boolean {
  if (!login) return false;
  const normalized = login.trim().toLowerCase();
  if (normalized === "") return false;
  return allowedLogins.some((allowed) => allowed.toLowerCase() === normalized);
}
