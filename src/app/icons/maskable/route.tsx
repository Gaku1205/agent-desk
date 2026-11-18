import { renderAppIcon } from "@/lib/appIcon";

export const dynamic = "force-static";

/** 角丸なしの四角。中の絵は真ん中80%に収まっている */
export function GET() {
  return renderAppIcon(512);
}
