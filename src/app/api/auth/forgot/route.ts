import { appUrl } from "@/lib/server/auth";
import { handle, ok, readJson } from "@/lib/server/http";
import { requestReset } from "@/lib/server/passwords";

export async function POST(req: Request) {
  return handle(async () => ok(await requestReset(await readJson(req), appUrl(req))));
}
