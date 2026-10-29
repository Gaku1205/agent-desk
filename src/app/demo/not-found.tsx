import { Backdrop } from "@/components/Backdrop";
import { Sheet } from "@/components/Sheet";

export default function NotFound() {
  return (
    <>
      <Backdrop />
      <Sheet>
        <p className="empty">ページが見つかりません</p>
      </Sheet>
    </>
  );
}
