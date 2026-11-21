/** ホームの待ちが0件の画面の文（docs/design.md の「ホーム：待ちが0件」）。読めなかったリポジトリがあるときは「何も無い」と言い切らない */
export function calmCopy(unreadable: boolean): { title: string; description: string; check: boolean } {
  return unreadable
    ? {
        title: "読めなかったリポジトリがあります",
        description: "読めなかったリポジトリの分は、ここに入っていません",
        check: false,
      }
    : {
        title: "決めることは、今はありません",
        description: "AIたちが進めています。決めることが出たら、ここに出ます。",
        check: true,
      };
}
