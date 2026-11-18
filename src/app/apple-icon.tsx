import { renderAppIcon } from "@/lib/appIcon";

/** iPhone のホーム画面：角丸なしの 180×180（iOS が自分で角を切り抜く） */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return renderAppIcon(180);
}
