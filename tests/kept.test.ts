import { describe, expect, it } from "vitest";
import { GET, POST } from "@/app/api/kept/route";
import { json, makeUser, req } from "./helpers";

// (NEXT-UI 10) Kept forms: typed-but-unsent text is saved per person and form on the server; sending clears it; only the
// listed kinds of form (never sign-in / sign-up).
const put = (cookie: string, key: string, data: unknown) => POST(req("/api/kept", { cookie, body: { key, data } })).then(json);
const get = (cookie: string, key: string) => GET(req(`/api/kept?key=${encodeURIComponent(key)}`, { cookie })).then(json);

describe("kept forms", () => {
  it("keeps what was typed per person and form, on any device; sending (null) clears it", async () => {
    const a = await makeUser({ tester: true, name: "Ana Silva" });
    const b = await makeUser({ tester: true, name: "Ben Ito" });
    expect((await get(a.cookie, "written:s1")).body.data).toBeNull();
    expect((await put(a.cookie, "written:s1", { answers: ["Loved it", ""], notes: "n" })).status).toBe(200);
    expect((await get(a.cookie, "written:s1")).body.data).toEqual({ answers: ["Loved it", ""], notes: "n" });
    // Not shared between people or between forms.
    expect((await get(b.cookie, "written:s1")).body.data).toBeNull();
    expect((await get(a.cookie, "chat:t1:u1")).body.data).toBeNull();
    // Typing again replaces it; sending clears it.
    await put(a.cookie, "written:s1", { answers: ["Loved it more", ""], notes: "" });
    expect((await get(a.cookie, "written:s1")).body.data.answers[0]).toBe("Loved it more");
    await put(a.cookie, "written:s1", null);
    expect((await get(a.cookie, "written:s1")).body.data).toBeNull();
  });

  it("refuses forms that aren't kept (sign-in, sign-up) and signed-out use", async () => {
    const a = await makeUser({ tester: true });
    for (const key of ["login", "signup:email", "password", "profile:name", "../etc"]) expect((await put(a.cookie, key, { x: 1 })).status).toBe(400);
    expect((await put("", "chat:t1:u1", { text: "hi" })).status).toBe(401);
    for (const key of ["written:x", "chat:x:y", "dispute:call:1", "rate:-api-sessions-x-rate", "reject:submission:1", "test:new", "test:edit:abc"]) expect((await put(a.cookie, key, { v: 1 })).status).toBe(200);
  });
});
