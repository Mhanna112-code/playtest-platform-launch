import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/dev/hook/route";

// The test-only hook for scripts/media.cjs exists only with the local fake Stripe (STRIPE_FAKE=1, no real key, a localhost APP_URL).
describe("the media recordings' test hook", () => {
  it("is not there without the fake Stripe", async () => {
    const was = process.env.STRIPE_FAKE;
    delete process.env.STRIPE_FAKE;
    try {
      const r = await POST(new Request("http://localhost:3400/api/dev/hook", { method: "POST", body: JSON.stringify({ action: "summaries", email: "a+media1@playtest.test" }) }));
      expect(r.status).toBe(404);
    } finally {
      if (was !== undefined) process.env.STRIPE_FAKE = was;
    }
  });
});
