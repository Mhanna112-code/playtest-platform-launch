// (Batch 15 section 12) At server start, every settings problem is logged once (the build already refused the ones that must stop a deploy).
// (Batch 26 section 1) The Node-only start work lives in instrumentation-node.ts, imported only under the literal NEXT_RUNTIME check so the edge bundle never
// pulls in server modules (node:crypto, Prisma).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerNode } = await import("./instrumentation-node");
    await registerNode();
  }
}
