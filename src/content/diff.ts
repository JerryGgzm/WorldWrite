// Lightweight word-level diff using a longest-common-subsequence backtrace.
// Used only for the optional visual diff in the preview overlay.

export interface DiffPart {
  type: "eq" | "add" | "del";
  text: string;
}

function tokenize(text: string): string[] {
  // Keep whitespace as part of tokens so the rendered diff preserves spacing.
  return text.match(/\s+|\S+/g) ?? [];
}

export function computeWordDiff(a: string, b: string): DiffPart[] {
  const aTokens = tokenize(a);
  const bTokens = tokenize(b);
  const n = aTokens.length;
  const m = bTokens.length;

  // LCS length table.
  const lcs: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        aTokens[i] === bTokens[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const parts: DiffPart[] = [];
  let i = 0;
  let j = 0;
  const push = (type: DiffPart["type"], text: string) => {
    const last = parts[parts.length - 1];
    if (last && last.type === type) last.text += text;
    else parts.push({ type, text });
  };

  while (i < n && j < m) {
    if (aTokens[i] === bTokens[j]) {
      push("eq", aTokens[i]);
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      push("del", aTokens[i]);
      i++;
    } else {
      push("add", bTokens[j]);
      j++;
    }
  }
  while (i < n) push("del", aTokens[i++]);
  while (j < m) push("add", bTokens[j++]);

  return parts;
}
