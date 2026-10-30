import { db } from "@/lib/db";

// (Owner, Oct 29, batch 30 §35) Storage running out: once a day (the daily job) the app measures the database's size (pg_database_size) and the total size of the
// uploads it stored (its own Recording rows: every uploaded file, written answers' attachments included). Limits come from DB_STORAGE_LIMIT_GB (e.g. 0.5 on Neon's
// free plan) and UPLOADS_LIMIT_GB (the R2 budget); unset = not checked. At 80% or more of either: a red box at the top of the admin console, one admin bell line per
// crossing, and the keyed /api/health answers "degraded: storage" (HTTP 200) for the uptime service's keyword monitor. Under 80% again: the box goes. Modelled on the
// email outage (batch 23 section 2).

/** At or above this share of a limit, storage is "filling up". */
export const STORAGE_ALERT_PCT = 80;
/** The keyword the uptime service's keyword monitor watches for (beside "degraded: emails"). */
export const STORAGE_DEGRADED_KEYWORD = "degraded: storage";
/** AppState key: the last daily measurement (JSON, see StorageState). */
export const STORAGE_STATE_KEY = "storage-state";

export type StorageKind = "database" | "uploads";
type Reading = { bytes: number; limit: number; pct: number; over: boolean };
export type StorageState = { at: string; database?: Reading; uploads?: Reading };

const GB = 1_000_000_000;
const MB = 1_000_000;
const ENV: Record<StorageKind, string> = { database: "DB_STORAGE_LIMIT_GB", uploads: "UPLOADS_LIMIT_GB" };

/** A limit in bytes from its setting (in GB, decimals allowed: 0.5 = 500 MB); null when unset or not a positive number (not checked). */
export function storageLimit(kind: StorageKind): number | null {
  const raw = process.env[ENV[kind]]?.trim();
  if (!raw) return null;
  const gb = Number(raw);
  return Number.isFinite(gb) && gb > 0 ? Math.round(gb * GB) : null;
}

/** "410 MB", "8.5 GB", "10 GB" (decimal units, like the plans' own). */
export function sizeText(bytes: number) {
  if (bytes < GB) return `${Math.round(bytes / MB)} MB`;
  return `${Number((bytes / GB).toFixed(1))} GB`;
}
/** The share of a limit, rounded down (so "80%" is never shown below the alert line). */
export const pctOf = (bytes: number, limit: number) => Math.floor((bytes / limit) * 100);

/** The admin console's red box: "Storage is 82% full: database 410 MB of 500 MB." / "Uploads are 85% full: 8.5 GB of 10 GB." */
export function storageBoxLine(kind: StorageKind, r: { bytes: number; limit: number }) {
  const pct = pctOf(r.bytes, r.limit);
  return kind === "database" ? `Storage is ${pct}% full: database ${sizeText(r.bytes)} of ${sizeText(r.limit)}.` : `Uploads are ${pct}% full: ${sizeText(r.bytes)} of ${sizeText(r.limit)}.`;
}
/** The admins' bell line, once per crossing: "Storage is filling up (database 82%)" / "Storage is filling up (uploads 85%)". */
export const storageBellLine = (kind: StorageKind, pct: number) => `Storage is filling up (${kind} ${pct}%)`;

/** The real sizes now: the whole database (pg_database_size) and the stored uploads (their recorded sizes). */
export async function measureStorage() {
  const [row] = await db.$queryRaw<{ size: bigint }[]>`SELECT pg_database_size(current_database()) AS size`;
  const uploads = (await db.recording.aggregate({ where: { uploadedAt: { not: null } }, _sum: { sizeBytes: true } }))._sum.sizeBytes ?? 0;
  return { database: Number(row?.size ?? 0), uploads: Number(uploads) };
}

async function readState(): Promise<StorageState | null> {
  const row = await db.appState.findUnique({ where: { key: STORAGE_STATE_KEY } });
  if (!row) return null;
  try {
    return JSON.parse(row.value) as StorageState;
  } catch {
    return null;
  }
}

/**
 * The daily job's step: measure (tests pass the sizes), compare with the limits that are set, store the result, and ring each admin's bell once when a kind
 * crosses 80% (it rings again only after it went back under and crossed again). Returns the stored state.
 */
export async function checkStorage(now = new Date(), measured?: Partial<Record<StorageKind, number>>) {
  const limits = { database: storageLimit("database"), uploads: storageLimit("uploads") };
  const before = await readState();
  const state: StorageState = { at: now.toISOString() };
  if (!limits.database && !limits.uploads) {
    await db.appState.deleteMany({ where: { key: STORAGE_STATE_KEY } });
    return state;
  }
  const sizes = measured && Object.keys(measured).length ? measured : await measureStorage();
  const crossed: { kind: StorageKind; pct: number }[] = [];
  for (const kind of ["database", "uploads"] as const) {
    const limit = limits[kind];
    const bytes = sizes[kind];
    if (!limit || bytes == null) continue;
    const pct = pctOf(bytes, limit);
    const over = bytes >= (limit * STORAGE_ALERT_PCT) / 100;
    state[kind] = { bytes, limit, pct, over };
    if (over && !before?.[kind]?.over) crossed.push({ kind, pct });
  }
  const value = JSON.stringify(state);
  await db.appState.upsert({ where: { key: STORAGE_STATE_KEY }, create: { key: STORAGE_STATE_KEY, value }, update: { value } });
  if (crossed.length) {
    const { adminUsers, bell } = await import("./notify");
    for (const a of await adminUsers()) for (const c of crossed) await bell(a.id, storageBellLine(c.kind, c.pct), "/admin#storage", undefined, { own: true });
  }
  return state;
}

/** What is at 80% or more now (from the last daily measurement, and only for a limit that is still set): the red box's lines and /api/health's keyword. */
export async function storageAlerts() {
  const s = await readState();
  const out: { kind: StorageKind; line: string }[] = [];
  if (!s) return { lines: out, at: null as Date | null };
  for (const kind of ["database", "uploads"] as const) {
    const r = s[kind];
    if (r?.over && storageLimit(kind)) out.push({ kind, line: storageBoxLine(kind, r) });
  }
  return { lines: out, at: new Date(s.at) };
}

/** /api/health's keyword: some storage is at 80% or more. */
export const storageDegraded = async () => (await storageAlerts()).lines.length > 0;
