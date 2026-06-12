import path from "node:path";

/** Project root: env override (monorepo / demo-app) or current working directory. */
export function resolveTraceRoot(): string {
  const root = process.env.AI_TRACE_ROOT ?? process.cwd();
  return path.isAbsolute(root) ? root : path.resolve(process.cwd(), root);
}
