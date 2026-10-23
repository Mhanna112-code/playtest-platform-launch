// The site's own address (links in emails). Sign-in itself is in passwords.ts (NEWEST+7: passwords replace email links).
export function appUrl(req?: Request) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return req ? new URL(req.url).origin : "http://localhost:3400";
}
