/** FNV-1a hash — compact, selector-safe fragment from arbitrary text. */
export const hashIdFragment = (value: string): string => {
  let hash = 2_166_136_261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.codePointAt(i);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
};

/** Build a React Flow node id that is safe for DOM `data-id` / CSS selectors. */
export const propFlowSafeStepId = (
  prefix: string,
  index: number,
  options?: { line?: number; key?: string }
): string => {
  const line = options?.line ?? 0;
  const key = options?.key ? `:${hashIdFragment(options.key)}` : "";
  return `${prefix}:${index}:${line}${key}`;
};
