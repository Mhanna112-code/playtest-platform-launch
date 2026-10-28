// The site's own address (links in emails). Sign-in itself is in passwords.ts (NEWEST+7: passwords replace email links).
export function appUrl(req?: Request) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  // (Batch 15 section 41, M3) Never the request's Host header in production: a forged Host would put a stranger's address in reset links. (The build refuses a
  // production deploy without APP_URL.)
  if (process.env.NODE_ENV === "production") throw new Error("APP_URL is missing");
  return req ? new URL(req.url).origin : "http://localhost:3400";
}
