import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(import.meta.dirname, "../.."),
  serverExternalPackages: ["@ai-trace/cache"],
  transpilePackages: ["@ai-trace/config"],
};

export default nextConfig;
