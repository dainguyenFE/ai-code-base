const rootOf = (expression: string): string =>
  expression.split(".")[0]?.trim() ?? expression;

/** Whether `expression` reads the given identifier (prop, variable, or field root). */
export const referencesIdentifier = (
  expression: string,
  identifier: string
): boolean => {
  const trimmed = expression.trim();
  const root = rootOf(identifier);
  if (trimmed === identifier || trimmed === root) {
    return true;
  }
  if (
    trimmed.startsWith(`${root}.`) ||
    trimmed.includes(`.${root}.`) ||
    trimmed.endsWith(`.${root}`)
  ) {
    return true;
  }
  const escaped = root.replaceAll("$", "\\$");
  const tokenPattern = new RegExp(
    `(^|[^a-zA-Z0-9_$])${escaped}($|[^a-zA-Z0-9_$]|\\.)`
  );
  return tokenPattern.test(trimmed);
};

export const matchesPropUsage = (
  expression: string,
  propName: string,
  dataExpression?: string
): boolean =>
  referencesIdentifier(expression, propName) ||
  (dataExpression ? referencesIdentifier(expression, dataExpression) : false);
