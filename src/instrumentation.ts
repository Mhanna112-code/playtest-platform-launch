// (Batch 15 section 12) At server start, every settings problem is logged once (the build already refused the ones that must stop a deploy).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { configProblems } = await import("./lib/server/config");
  for (const p of configProblems()) console.warn(`[settings] ${p.message}`);
}
