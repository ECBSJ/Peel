import { defineConfig } from "vitest/config";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

dotenv.config({ path: path.join(repoRoot, ".env.local") });

export default defineConfig({
  test: {},
});
