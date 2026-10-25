/** 順番待ちの理由を開いている行（Issue番号の集合）を、1行ぶん開閉して新しい集合を返す。元の集合は変えない */
export function toggleQueueReasonOpen(open: ReadonlySet<number>, issueNumber: number): Set<number> {
  const next = new Set(open);
  if (next.has(issueNumber)) {
    next.delete(issueNumber);
  } else {
    next.add(issueNumber);
  }
  return next;
}
