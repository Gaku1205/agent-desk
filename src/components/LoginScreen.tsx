import { signIn } from "@/lib/auth";

export function LoginScreen() {
  async function login() {
    "use server";
    await signIn("github");
  }

  return (
    <main className="login">
      <form action={login}>
        <button type="submit" className="login-button">
          GitHubでログイン
        </button>
      </form>
    </main>
  );
}
