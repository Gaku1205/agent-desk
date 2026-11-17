import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Issueに付ける画像（5枚 × 4MB を base64 にしたもの＝約27MB）が通る大きさ
      bodySizeLimit: "30mb",
    },
  },
};

export default nextConfig;
