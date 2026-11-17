import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Issueに付ける画像（1枚4MBまで）を、1回に1枚ずつファイルのまま送るのが通る大きさ。
      // 本番（Vercel）は関数の本文が4.5MBまでなので、base64 やまとめて送る形にはしない
      bodySizeLimit: "5mb",
    },
  },
};

export default nextConfig;
