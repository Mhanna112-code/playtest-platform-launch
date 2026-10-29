// vite-node config for appfn.mts: "@/..." is the worktree's src (the same code the 3460 server runs).
import path from "node:path";
export default { resolve: { alias: { "@": "C:/Users/march/Projects/playtest-lite-stripe/src" } }, server: { fs: { allow: ["C:/Users/march/Projects"] } } };
