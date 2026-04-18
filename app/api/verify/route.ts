import { NextRequest, NextResponse } from "next/server";
import { getServerSideConfig } from "../../config/server";
import md5 from "spark-md5";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  const { code } = await req.json();
  const serverConfig = getServerSideConfig();

  if (!serverConfig.needCode) {
    return NextResponse.json({ valid: true });
  }

  const hashedCode = md5.hash(code ?? "").trim();
  const valid = serverConfig.codes.has(hashedCode);
  return NextResponse.json({ valid });
}
