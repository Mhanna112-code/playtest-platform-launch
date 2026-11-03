// vite-node config for appfn.mts: "@/..." is this worktree's src (the same code the 3480 server runs).
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
export default { resolve: { alias: { "@": path.resolve(here, "../../src") } }, server: { fs: { allow: [path.resolve(here, "../..")] } } };
