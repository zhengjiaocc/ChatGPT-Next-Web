import { jwtVerify } from "jose";
import { NextRequest } from "next/server";
import sql from "./db";

if (!process.env.NEXTAUTH_SECRET) {
  throw new Error("NEXTAUTH_SECRET environment variable is required");
}
const SECRET = new TextEncoder().encode(process.env.NEXTAUTH_SECRET);

export async function getUser(req: NextRequest) {
  const token = req.cookies.get("token")?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, SECRET);
    const userId = payload.sub as string | undefined;
    if (!userId) return null;
    const rows = await sql`
      SELECT id, username
      FROM users
      WHERE id = ${userId}
      LIMIT 1
    `;
    if (!rows.length) return null;
    return {
      id: rows[0].id as string,
      username: rows[0].username as string,
    };
  } catch {
    return null;
  }
}
