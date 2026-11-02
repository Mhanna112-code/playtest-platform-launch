export type InviteAvailability = { id: string; exists: boolean; blocked: boolean; suspended: boolean; atLimit: boolean; invited: boolean; inTest: boolean; rated: boolean };
export const inviteAvailabilityKey = (p: InviteAvailability) => [p.exists, p.blocked, p.suspended, p.atLimit, p.invited, p.inTest, p.rated].map(Number).join("");
export const inviteAvailabilityV = (rows: { id: string; availability: string }[]) => [...new Map(rows.map((r) => [r.id, r.availability])).entries()].sort(([a], [b]) => a.localeCompare(b)).map(([id, key]) => `${id}:${key}`).join(",");
export const canInviteRow = (p: InviteAvailability) => p.exists && !p.blocked && !p.suspended && !p.atLimit && !p.invited && !p.inTest && !p.rated;

export const inviteDetailsKey = (name: string, profileAt: number, mineAvg: number | null, together: { test: { id: string; title: string }; status: string; endKind: string; joinedAt: Date }[]) => JSON.stringify([name, profileAt, mineAvg, [...together].sort((a, b) => a.test.id.localeCompare(b.test.id)).map((c) => [c.test.id, c.test.title, c.status, c.endKind, c.joinedAt.getTime()])]);
