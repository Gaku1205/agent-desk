import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { getToken } from "next-auth/jwt";
import { headers } from "next/headers";
import { isAllowedLogin } from "./allowlist";
import { getAllowedLogins } from "./config";
import { PRIVATE_SCOPE } from "./loginScope";

// GitHubのトークンは暗号化したJWT（Cookie）の中にだけ置く。
// session コールバックでは返さないので、/api/auth/session やクライアントには出ない。
declare module "next-auth/jwt" {
  interface JWT {
    login?: string;
    accessToken?: string;
  }
}

declare module "next-auth" {
  interface Session {
    login?: string;
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  // 頼む権限は、ログインを始めるとき（LoginScreen の signIn）に決めて渡す
  providers: [GitHub({ authorization: { params: { scope: PRIVATE_SCOPE } } })],
  session: { strategy: "jwt" },
  callbacks: {
    signIn({ profile }) {
      const login = typeof profile?.login === "string" ? profile.login : null;
      return isAllowedLogin(login, getAllowedLogins());
    },
    jwt({ token, account, profile }) {
      if (account && profile) {
        token.login = typeof profile.login === "string" ? profile.login : undefined;
        token.accessToken = account.access_token;
      }
      return token;
    },
    session({ session, token }) {
      session.login = token.login;
      return session;
    },
  },
});

/** ログイン中で、許可リストに入っているユーザー名。そうでなければ null */
export async function getSignedInLogin(): Promise<string | null> {
  const session = await auth();
  const login = session?.login ?? null;
  return isAllowedLogin(login, getAllowedLogins()) ? login : null;
}

/**
 * ログイン中のユーザーのGitHubトークンを、暗号化したセッション（JWT）から取り出す。
 * サーバー側（サーバーコンポーネント・サーバーアクション・Route Handler）だけで使う。
 * 許可リスト外のユーザーやログインしていないときは null。
 */
export async function getGitHubToken(): Promise<string | null> {
  const requestHeaders = await headers();
  const secret = process.env.AUTH_SECRET;
  // HTTPSでは `__Secure-` 付きのCookie名になるので、両方を試す
  for (const secureCookie of [true, false]) {
    const token = await getToken({ req: { headers: requestHeaders }, secret, secureCookie });
    if (!token) continue;
    if (!isAllowedLogin(token.login, getAllowedLogins())) return null;
    return token.accessToken ?? null;
  }
  return null;
}
