import { describe, expect, it } from "vitest";
import { localSendAllowed } from "@/lib/server/email";

describe("(Owner, Nov 6, §318) a local site with the real email key sends only to EMAIL_LOCAL_ONLY_TO", () => {
  const env = { EMAIL_LOCAL_ONLY_TO: "owner+*@gmail.com, owner@gmail.com" };
  it("listed addresses and '*' patterns go out; every other address stays in the dev outbox", () => {
    expect(localSendAllowed("owner+fbbb@gmail.com", env)).toBe(true);
    expect(localSendAllowed("Owner@Gmail.com", env)).toBe(true);
    expect(localSendAllowed("ana@example.com", env)).toBe(false);
    expect(localSendAllowed("ownerx@gmail.com", env)).toBe(false);
    expect(localSendAllowed("evil+owner+a@gmail.com", env)).toBe(false);
  });
  it("unset (and on Vercel) changes nothing: every address", () => {
    expect(localSendAllowed("ana@example.com", {})).toBe(true);
    expect(localSendAllowed("ana@example.com", { ...env, VERCEL: "1" })).toBe(true);
  });
});
