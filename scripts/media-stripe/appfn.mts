// Runs ONE of the app's own clock jobs for ONE throwaway account, against the media database and the Stripe test key (the daily job runs it for everyone;
// this runs just that account's share, as the fake server's /api/dev/hook does for the fake Stripe). Used by the Stripe recording through appfn.cjs.
//   retry <userId>      holds.retryOwed (the daily automatic retry of what a held developer owes)
//   summaries <userId>  notify.sendSummaries (that person's email of their notifications)
//   renew <userId>      subscription.renewSubscriptions
const [action, id] = process.argv.slice(2);
const now = new Date();
let r: unknown;
if (action === "retry") r = await (await import("@/lib/server/holds")).retryOwed(id, now, "daily");
else if (action === "summaries") r = await (await import("@/lib/server/notify")).sendSummaries(now, [id]);
else if (action === "renew") r = await (await import("@/lib/server/subscription")).renewSubscriptions(now, [id]);
else throw new Error("unknown action");
console.log("RESULT " + JSON.stringify(r ?? null));
(await import("@/lib/db")).db.$disconnect();
