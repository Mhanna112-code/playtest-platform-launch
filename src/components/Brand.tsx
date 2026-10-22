import Link from "next/link";

export function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2 text-lg font-bold text-slate-900 no-underline hover:no-underline">
      <span className="inline-block h-6 w-6 rounded-md bg-indigo-600" aria-hidden="true" />
      Playtest
    </Link>
  );
}
