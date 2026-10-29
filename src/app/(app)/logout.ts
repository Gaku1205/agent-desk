"use server";

import { signOut } from "@/lib/auth";

/** ログアウト（上端の帯・スマホのメニューの「ログアウト」） */
export async function logout(): Promise<void> {
  await signOut({ redirectTo: "/" });
}
