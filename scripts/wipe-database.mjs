import { neon } from "@neondatabase/serverless";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIndex = line.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = line.slice(0, eqIndex).trim();
    const value = line.slice(eqIndex + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
loadEnvFile(path.join(projectRoot, ".env.local"));
loadEnvFile(path.join(projectRoot, ".env"));

const confirmToken = process.env.WIPE_DATABASE_CONFIRM;
const expectedToken = "DELETE_ALL_DATA";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

if (confirmToken !== expectedToken) {
  console.error(
    `Refusing to wipe database. Set WIPE_DATABASE_CONFIRM=${expectedToken}`,
  );
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

try {
  await sql`
    TRUNCATE TABLE
      app_configs,
      provider_configs,
      chat_sessions,
      users
    RESTART IDENTITY CASCADE;
  `;
  console.log("Database wiped successfully.");
} catch (error) {
  console.error("Database wipe failed:", error);
  process.exit(1);
}
