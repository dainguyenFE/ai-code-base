import { initConfig } from "@ai-trace/config";

export async function runInit(cwd: string): Promise<void> {
  const configPath = await initConfig(cwd);
  console.log(`Created config at ${configPath}`);
}
