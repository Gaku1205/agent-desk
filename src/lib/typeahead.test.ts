import { describe, expect, it } from "vitest";
import { typeahead } from "./typeahead";

const options = ["alpha", "Sigma", "sky", "skyline", "zeta"];
const empty = { text: "", at: 0 };

describe("typeahead", () => {
  it("打った文字で始まる最初の候補へ移る（大文字小文字は区別しない）", () => {
    expect(typeahead(empty, "s", 5000, options).index).toBe(1);
    expect(typeahead(empty, "S", 5000, options).index).toBe(1);
  });
  it("1秒以内に続けて打てば絞る", () => {
    const first = typeahead(empty, "s", 5000, options);
    const second = typeahead(first.state, "k", 5500, options);
    expect(second.state.text).toBe("sk");
    expect(second.index).toBe(2);
    const third = typeahead(second.state, "y", 6000, options);
    expect(third.state.text).toBe("sky");
    expect(third.index).toBe(2);
  });
  it("間が空いたら並びをリセットする", () => {
    const first = typeahead(empty, "s", 5000, options);
    const later = typeahead(first.state, "z", 7000, options);
    expect(later.state.text).toBe("z");
    expect(later.index).toBe(4);
  });
  it("一致が無ければ null（動かさない）", () => {
    expect(typeahead(empty, "q", 5000, options).index).toBeNull();
  });
  it("文字キー以外は無視する", () => {
    expect(typeahead(empty, "Enter", 5000, options).index).toBeNull();
    expect(typeahead(empty, " ", 5000, options).index).toBeNull();
  });
});
