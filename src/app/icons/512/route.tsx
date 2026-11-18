import { renderAppIcon } from "@/lib/appIcon";

export const dynamic = "force-static";

export function GET() {
  return renderAppIcon(512);
}
