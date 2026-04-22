import { jwtVerify } from "jose";
import { NextRequest } from "next/server";

if (!process.env.NEXTAUTH_SECRET) {
  throw new Error("NEXTAUTH_SECRET environment variable is required");
}
const SECRET = new TextEncoder().encode(process.env.NEXTAUTH_SECRET);

export async function getUser(req: NextRequest) {
  const token = req.cookies.get("token")?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, SECRET);
    return { id: payload.sub as string, username: payload.username as string };
  } catch {
    return null;
  }
}
