import type { FlowNode } from "./nodes";

/** スマホの帯の一覧で行を押したとき：押す列に行があればそこへ飛び、無ければ説明を固定で出す */
export function stripPickAction(rowFound: boolean): "jump" | "pin" {
  return rowFound ? "jump" : "pin";
}

/** 一覧の短い説明に色を付ける行か（急ぐ物＝止まった・公開失敗だけ） */
export function stripItemUrgent(node: Pick<FlowNode, "urgent">): boolean {
  return node.urgent;
}
