import Link from "next/link";
import { Brand } from "@/components/Brand";

/**
 * The signed-out pages (log in, sign up, forgot, reset, confirm), as the full app lays them out: the site header (logo,
 * Log in / Sign up), then one narrow column with the title and a card.
 */
export function AuthShell({ title, intro, children }: { title: string; intro?: React.ReactNode; children: React.ReactNode }) {
  return (
    <>
      <header className="sticky top-0 z-20 border-b border-white/[0.07] bg-ink-950/75 backdrop-blur-xl">
        <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-2 gap-y-2 px-4 py-3">
          <Brand />
          <div className="ml-auto flex items-center gap-2">
            <Link href="/login" className="nav-link">Log in</Link>
            <Link href="/signup" className="btn px-3 py-1.5 text-sm no-underline hover:no-underline">Sign up</Link>
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mx-auto max-w-md">
          <h1 className={`${intro ? "mb-2" : "mb-6"} text-2xl font-semibold`}>{title}</h1>
          {intro && <p className="mb-6 text-sm text-slate-400">{intro}</p>}
          {children}
        </div>
      </main>
    </>
  );
}
