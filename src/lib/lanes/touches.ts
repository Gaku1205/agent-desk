/**
 * 触るファイル（企画AIが Issue の本文の最後に書く印 `<!-- ai-touches: src/lib/a.ts, src/components/ -->`）。
 * 重なりの決まりはパイプライン（`pipeline-lib.sh` の `paths_overlap`）と同じ：
 * 同じファイル、または `/` で終わるフォルダの中にもう片方がある。`docs/` の下の `.md` は数えない
 */

const MARK = /<!--\s*ai-touches:([^>]*)-->/;

/** 本文の印から、触るファイルを読む。印が無い・中身が空なら null（分からない） */
export function parseTouches(body: string): string[] | null {
  const match = MARK.exec(body);
  if (!match) return null;
  const paths = match[1]
    .split(",")
    .map((path) => path.trim().replace(/^\.\//, ""))
    .filter((path) => path !== "");
  return paths.length === 0 ? null : [...new Set(paths)];
}

/** 重なりに数えない物：`docs/` の下の `.md`（仕様書。サブフォルダの中も） */
function ignored(path: string): boolean {
  return path.startsWith("docs/") && path.toLowerCase().endsWith(".md");
}

/** 2つの道が重なるか：同じ、または片方が `/` で終わるフォルダで、もう片方がその中 */
function pathsOverlap(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.endsWith("/") && b.startsWith(a)) return true;
  if (b.endsWith("/") && a.startsWith(b)) return true;
  return false;
}

/** 2つの触るファイルの並びで、最初に重なる物（a の側の道）。重ならなければ null */
export function touchesOverlap(a: readonly string[], b: readonly string[]): string | null {
  for (const left of a) {
    if (ignored(left)) continue;
    for (const right of b) {
      if (ignored(right)) continue;
      if (pathsOverlap(left, right)) return left.endsWith("/") && !right.endsWith("/") ? right : left;
    }
  }
  return null;
}
