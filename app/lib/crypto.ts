if (!process.env.ENCRYPTION_KEY) {
  throw new Error("ENCRYPTION_KEY environment variable is required");
}
const ENC_KEY = process.env.ENCRYPTION_KEY;

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function getKey(): Promise<CryptoKey> {
  const raw = hexToBytes(ENC_KEY.padEnd(64, "0").slice(0, 64));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encrypt(text: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(text);
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoded,
  );
  return bytesToHex(iv) + ":" + bytesToHex(new Uint8Array(cipher));
}

export async function decrypt(text: string): Promise<string> {
  if (!text.includes(":")) return text;
  const idx = text.indexOf(":");
  const ivHex = text.slice(0, idx);
  const dataHex = text.slice(idx + 1);
  const key = await getKey();
  const iv = hexToBytes(ivHex);
  const data = hexToBytes(dataHex);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return new TextDecoder().decode(plain);
}
