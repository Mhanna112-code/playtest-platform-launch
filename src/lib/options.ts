export const DEVICES = ["Windows PC", "Mac", "Linux", "Steam Deck", "iPhone", "Android phone", "iPad", "Android tablet", "PlayStation", "Xbox", "Switch", "VR headset"];
// The full app's categories (src/lib/constants.ts there), exactly.
export const CATEGORIES = ["Game", "Productivity", "Social", "Entertainment", "Education", "Health & fitness", "Finance", "Shopping", "Business", "Developer tools", "AI", "Other"];
export const LANGUAGES = ["English", "Spanish", "Portuguese", "French", "German", "Italian", "Polish", "Turkish", "Russian", "Japanese", "Korean", "Chinese"];
/** The tester profile's own lines when no device or no language is ticked (the profile's Save and, batch 35 §153, sign-up as a tester or both). */
export const DEVICES_MISSING = "Pick at least one device you play on.";
export const LANGUAGES_MISSING = "Pick at least one language you can test in.";
/** (Batch 35 §153) The ticks sent for one of the lists above: only known values, each once, in the order sent (anything else is left out). */
export const pickFrom = (v: unknown, allowed: string[]) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && allowed.includes(x)))] : []);
