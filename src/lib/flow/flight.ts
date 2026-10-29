import type { OperationKind } from "../turn";

/**
 * 押す列のボタンを押したとき、流れのその光が飛んで行く先の列（操作のあとの段階の列）。
 * 取り直しを待たずに動かすための見込み。本当の位置は、取り直したあとの配置で決まる（docs/design.md の「流れ（PC）」）
 *
 * 列：0 清書 / 1 実装 / 2 PR / 3 CI / 4 レビュー / 5 修正 / 6 マージ / 7 公開
 */
export function flightColumn(kind: OperationKind, at: number): number {
  switch (kind) {
    case "plan":
    case "start":
      // 企画AIが清書する
      return 0;
    case "implement":
      return 1;
    case "createPull":
      // PRができるとCIが走る
      return 3;
    case "requestReview":
      return 4;
    case "merge":
      // マージすると公開が始まる
      return 7;
    case "resume":
      // 止まる前の段階に戻って、AIが続ける
      return Math.min(7, Math.max(0, at));
  }
}
