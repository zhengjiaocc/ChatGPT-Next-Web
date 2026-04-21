import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

// 从环境变量读取密钥，与 login/route.ts 保持一致
const SECRET = new TextEncoder().encode(
  process.env.NEXTAUTH_SECRET ?? "secret",
);

// 公开的 API 路径白名单（无需登录即可访问）
const PUBLIC_API_PATHS = [
  "/api/auth/login",
  "/api/auth/register",
  "/api/config",    // 前端初始化时需要拉取站点公开配置
  "/api/verify",    // 旧版密码鉴权兼容
];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // 只对 /api 路由施加鉴权拦截，页面路由全部放行（因为登录页是 SPA hash 路由）
  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  // API 白名单放行
  if (PUBLIC_API_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const token = req.cookies.get("token")?.value;

  // 没有 Cookie：直接返回 401
  if (!token) {
    return NextResponse.json({ error: "未登录，请先登录" }, { status: 401 });
  }

  // 验证 JWT 签名与有效期
  try {
    await jwtVerify(token, SECRET);
    return NextResponse.next();
  } catch {
    // Token 无效或已过期
    const response = NextResponse.json(
      { error: "登录已过期，请重新登录" },
      { status: 401 },
    );
    response.cookies.delete("token");
    return response;
  }
}

export const config = {
  // 只匹配 /api 路径，排除 Next.js 内部静态资源
  matcher: ["/api/:path*"],
};
