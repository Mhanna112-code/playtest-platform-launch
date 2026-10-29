import type { NextConfig } from "next";

// (Batch 15 section 41, L1) Security headers. (Batch 21; batch 23) The call room is the app's own page (browser-to-browser WebRTC): camera, microphone and screen
// share are allowed for this site only, and nothing else is framed for calls. Uploads go straight to R2 (its host comes from R2_ACCOUNT_ID). Stripe.js runs the bank's
// confirmation pop-ups.
const r2Host = process.env.R2_ACCOUNT_ID?.trim() ? `https://${process.env.R2_ACCOUNT_ID.trim()}.r2.cloudflarestorage.com` : "";
const dev = process.env.NODE_ENV !== "production";
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' https://js.stripe.com https://*.js.stripe.com${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https://*.stripe.com${r2Host ? ` ${r2Host}` : ""}`,
  `media-src 'self' blob:${r2Host ? ` ${r2Host}` : ""}`,
  `connect-src 'self' https://api.stripe.com${r2Host ? ` ${r2Host}` : ""}${dev ? " ws: wss:" : ""}`,
  // (Batch 17 §11) 'self': the bank's check shows inline (hooks.stripe.com in a frame) and returns to /api/payments/bank-return in the same frame.
  `frame-src 'self' https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com`,
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  // Add a card and payout setup are forms that redirect on to Stripe's own pages (Checkout, Connect onboarding): browsers apply form-action to that redirect too.
  "form-action 'self' https://checkout.stripe.com https://connect.stripe.com",
].join("; ");

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Permissions-Policy", value: `camera=(self), microphone=(self), display-capture=(self), geolocation=(), usb=(), payment=(self "https://js.stripe.com")` },
  { key: "Content-Security-Policy", value: csp },
];

const nextConfig: NextConfig = {
  // NEXT_DIST_DIR lets a check/build run beside a running `next dev` without overwriting its .next folder.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // (Batch 17 §11) The bank's check returns here inside this site's own inline frame: only this path may be framed, and only by this site (the later entry wins).
      {
        source: "/api/payments/bank-return",
        headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }, { key: "Content-Security-Policy", value: csp.replace("frame-ancestors 'none'", "frame-ancestors 'self'") }],
      },
    ];
  },
};

export default nextConfig;
