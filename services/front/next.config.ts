import type { NextConfig } from "next";

const devProxyTarget = process.env.API_PROXY_TARGET?.replace(/\/+$/, "");

const nextConfig: NextConfig = {
  output: "export",
  images: {
    unoptimized: true,
  },
  ...(process.env.NODE_ENV === "development" && devProxyTarget
    ? {
        async rewrites() {
          return [
            {
              source: "/api/:path*",
              destination: `${devProxyTarget}/:path*`,
            },
          ];
        },
      }
    : {}),
};

export default nextConfig;
