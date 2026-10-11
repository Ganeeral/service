import type { NextConfig } from "next";

const apiUrl = new URL(process.env.API_INTERNAL_URL ?? "http://127.0.0.1:3008");
if (
  !["http:", "https:"].includes(apiUrl.protocol) ||
  apiUrl.username ||
  apiUrl.password ||
  apiUrl.pathname !== "/" ||
  apiUrl.search ||
  apiUrl.hash
) {
  throw new Error(
    "API_INTERNAL_URL must be an HTTP(S) origin without credentials or a path",
  );
}

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${apiUrl.origin}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
