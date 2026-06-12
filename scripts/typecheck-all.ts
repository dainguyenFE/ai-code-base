const packages = [
  "packages/trace-types",
  "packages/trace-config",
  "packages/trace-scanner",
  "packages/trace-parser",
  "packages/trace-graph",
  "packages/trace-cache",
  "packages/trace-exporter",
  "packages/trace-agent",
  "apps/cli",
  "apps/page-logic-visualizer",
];

for (const pkg of packages) {
  console.log(`Typechecking ${pkg}...`);
  const proc = Bun.spawn(["bun", "run", "typecheck"], {
    cwd: pkg,
    stderr: "inherit",
    stdout: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) {
    process.exit(code);
  }
}

console.log("Typecheck complete.");
