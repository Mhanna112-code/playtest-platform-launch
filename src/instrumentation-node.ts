// (Batch 15 section 12; batch 26 section 1) Server start, Node runtime only (imported by instrumentation.ts under its NEXT_RUNTIME check).
export async function registerNode() {
  const { configProblems } = await import("./lib/server/config");
  for (const p of configProblems()) console.warn(`[settings] ${p.message}`);
  // (Batch 26 section 1) At server start: a gap of 15 minutes or more since the last sweep is recorded as an outage (only with OUTAGE_CHECKS=1).
  try {
    const { sweepGap } = await import("./lib/server/outages");
    await sweepGap();
  } catch (e) {
    console.error("[outage] start check:", (e as Error).message);
  }
}
