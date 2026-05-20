/**
 * Repair scrambled chat_sessions.messages order (chunk-sync bug).
 *
 * Usage:
 *   node scripts/repair-session-messages.mjs --session=<id> --file=记录.txt
 *   node scripts/repair-session-messages.mjs --session=<id> --file=记录.txt --write --confirm=<session-id>
 *
 * Requires DATABASE_URL in .env.local / .env (same as db:wipe).
 */
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

function parseArgs(argv) {
  const args = { write: false };
  for (const arg of argv) {
    if (arg === "--write") args.write = true;
    else if (arg.startsWith("--session=")) args.session = arg.slice("--session=".length);
    else if (arg.startsWith("--file=")) args.file = arg.slice("--file=".length);
    else if (arg.startsWith("--confirm="))
      args.confirm = arg.slice("--confirm=".length);
  }
  return args;
}

function countOutOfOrder(messages) {
  let n = 0;
  for (let i = 1; i < messages.length; i++) {
    if (new Date(messages[i].date) < new Date(messages[i - 1].date)) n++;
  }
  return n;
}

/** Same-timestamp: user before assistant. */
function sortMessagesByDate(messages) {
  return [...messages].sort((a, b) => {
    const da = new Date(a.date).getTime();
    const db = new Date(b.date).getTime();
    if (da !== db) return da - db;
    if (a.role !== b.role) return a.role === "user" ? -1 : 1;
    return 0;
  });
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
loadEnvFile(path.join(projectRoot, ".env.local"));
loadEnvFile(path.join(projectRoot, ".env"));

const { session, file, confirm, write } = parseArgs(process.argv.slice(2));

if (!session || !file) {
  console.error(
    "Usage: node scripts/repair-session-messages.mjs --session=<id> --file=<messages.json>",
  );
  console.error(
    "       Add --write --confirm=<same-session-id> to apply (requires DATABASE_URL).",
  );
  process.exit(1);
}

const filePath = path.isAbsolute(file) ? file : path.join(projectRoot, file);
if (!fs.existsSync(filePath)) {
  console.error(`File not found: ${filePath}`);
  process.exit(1);
}

let messages;
try {
  messages = JSON.parse(fs.readFileSync(filePath, "utf8"));
} catch (e) {
  console.error("Failed to parse messages JSON:", e);
  process.exit(1);
}

if (!Array.isArray(messages)) {
  console.error("File must be a JSON array of messages.");
  process.exit(1);
}

const beforeBroken = countOutOfOrder(messages);
const sorted = sortMessagesByDate(messages);
const afterBroken = countOutOfOrder(sorted);
const moved = messages.filter((m, i) => m.id !== sorted[i].id).length;

console.log(`Session: ${session}`);
console.log(`Messages: ${messages.length}`);
console.log(`Out-of-order pairs (before → after): ${beforeBroken} → ${afterBroken}`);
console.log(`Positions changed by sort: ${moved}`);

if (afterBroken > 0) {
  console.warn(
    "Warning: still has out-of-order dates after sort; check date fields or duplicates.",
  );
}

if (!write) {
  console.log("\nDry run only. To write to DB:");
  console.log(
    `  node scripts/repair-session-messages.mjs --session=${session} --file=${file} --write --confirm=${session}`,
  );
  process.exit(0);
}

if (confirm !== session) {
  console.error(`Refusing to write. Pass --confirm=${session}`);
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required for --write.");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

const rows = await sql`
  SELECT id, title, jsonb_array_length(messages) AS message_count
  FROM chat_sessions
  WHERE id = ${session}
  LIMIT 1
`;

if (!rows.length) {
  console.error(`Session not found: ${session}`);
  process.exit(1);
}

const row = rows[0];
const dbCount = Number(row.message_count ?? 0);
if (dbCount !== messages.length) {
  console.warn(
    `Count mismatch: DB has ${dbCount}, file has ${messages.length}. Proceeding with file order.`,
  );
}

await sql`
  UPDATE chat_sessions
  SET messages = ${JSON.stringify(sorted)}::jsonb,
      updated_at = NOW()
  WHERE id = ${session}
`;

console.log(`\nUpdated session "${row.title}" (${session}). Refresh the app to verify.`);
