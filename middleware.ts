import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

if (!process.env.NEXTAUTH_SECRET) {
  throw new Error("NEXTAUTH_SECRET environment variable is required");
}

// 从环境变量读取密钥，与 login/route.ts 保持一致
const SECRET = new TextEncoder().encode(process.env.NEXTAUTH_SECRET);

// 公开的 API 路径白名单（无需登录即可访问）
const PUBLIC_API_PATHS = [
  "/api/auth/login",
  "/api/auth/register",
  "/api/config", // 前端初始化时需要拉取站点公开配置
  "/api/verify", // 旧版密码鉴权兼容
];

const CORS_ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((x) => x.trim())
  .filter(Boolean);

const SECURITY_HEADERS: Array<[string, string]> = [
  ["X-Content-Type-Options", "nosniff"],
  ["X-Frame-Options", "DENY"],
  ["Referrer-Policy", "strict-origin-when-cross-origin"],
  ["Permissions-Policy", "camera=(), microphone=(), geolocation=()"],
  [
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://www.google-analytics.com; connect-src 'self' https: wss:; img-src 'self' data: blob: https:; style-src 'self' 'unsafe-inline' https:; font-src 'self' data: https:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  ],
];

function applySecurityHeaders(res: NextResponse) {
  for (const [key, value] of SECURITY_HEADERS) {
    res.headers.set(key, value);
  }
  return res;
}

function applyCors(req: NextRequest, res: NextResponse) {
  const origin = req.headers.get("origin");
  if (!origin) return res;
  if (CORS_ALLOWED_ORIGINS.length === 0 || !CORS_ALLOWED_ORIGINS.includes(origin))
    return res;
  res.headers.set("Access-Control-Allow-Origin", origin);
  res.headers.set("Access-Control-Allow-Credentials", "true");
  res.headers.set(
    "Access-Control-Allow-Methods",
    "GET,POST,PATCH,DELETE,OPTIONS",
  );
  res.headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Base-Url",
  );
  res.headers.set("Access-Control-Max-Age", "86400");
  res.headers.set("Vary", "Origin");
  return res;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 只对 /api 路由施加鉴权拦截，页面路由全部放行（因为登录页是 SPA hash 路由）
  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  if (req.method === "OPTIONS") {
    return applySecurityHeaders(
      applyCors(req, new NextResponse(null, { status: 204 })),
    );
  }

  // API 白名单放行
  if (PUBLIC_API_PATHS.some((p) => pathname.startsWith(p))) {
    return applySecurityHeaders(applyCors(req, NextResponse.next()));
  }

  const token = req.cookies.get("token")?.value;

  // 没有 Cookie：直接返回 401
  if (!token) {
    return applySecurityHeaders(
      applyCors(
        req,
        NextResponse.json({ error: "未登录，请先登录" }, { status: 401 }),
      ),
    );
  }

  // 验证 JWT 签名与有效期
  try {
    await jwtVerify(token, SECRET);
    return applySecurityHeaders(applyCors(req, NextResponse.next()));
  } catch {
    // Token 无效或已过期
    const response = NextResponse.json(
      { error: "登录已过期，请重新登录" },
      { status: 401 },
    );
    response.cookies.delete("token");
    return applySecurityHeaders(applyCors(req, response));
  }
}

export const config = {
  // 只匹配 /api 路径，排除 Next.js 内部静态资源
  matcher: ["/api/:path*"],
};
