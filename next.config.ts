import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  outputFileTracingIncludes: {
    "/api/operations/cash/bank-balance": [
      "./node_modules/@sparticuz/chromium/**/*",
      "./node_modules/puppeteer-core/**/*",
      "./node_modules/@puppeteer/browsers/**/*",
    ],
    "/api/cron/qlik/operations": [
      "./node_modules/@sparticuz/chromium/**/*",
      "./node_modules/puppeteer-core/**/*",
      "./node_modules/@puppeteer/browsers/**/*",
    ],
    "/api/cron/qlik/rental-*": [
      "./node_modules/@sparticuz/chromium/**/*",
      "./node_modules/puppeteer-core/**/*",
      "./node_modules/@puppeteer/browsers/**/*",
    ],
    "/api/cron/qlik/enterprise-performance": [
      "./node_modules/@sparticuz/chromium/**/*",
      "./node_modules/puppeteer-core/**/*",
      "./node_modules/@puppeteer/browsers/**/*",
    ],
    "/api/enterprise-performance/refresh": [
      "./node_modules/@sparticuz/chromium/**/*",
      "./node_modules/puppeteer-core/**/*",
      "./node_modules/@puppeteer/browsers/**/*",
    ],
    "/api/cron/qlik/delinquency": [
      "./node_modules/@sparticuz/chromium/**/*",
      "./node_modules/puppeteer-core/**/*",
      "./node_modules/@puppeteer/browsers/**/*",
    ],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
      },
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          {
            key: "Permissions-Policy",
            value: "camera=(self), geolocation=(self), microphone=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
