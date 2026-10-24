import Link from "next/link";
import { Brand } from "@/components/Brand";
import { getPageUser } from "@/lib/server/page-auth";

/** The public pages (Terms, Privacy): the site header (logo, Log in / Sign up, or Open the app when signed in), then the page. */
export async function PublicShell({ children }: { children: React.ReactNode }) {
  const u = await getPageUser();
  return (
    <>
      <header className="sticky top-0 z-20 border-b border-white/[0.07] bg-ink-950/75 backdrop-blur-xl">
        <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-2 gap-y-2 px-4 py-3">
          <Brand />
          <div className="ml-auto flex items-center gap-2">
            {u ? (
              <Link href="/app" className="btn px-3 py-1.5 text-sm no-underline hover:no-underline">Open the app</Link>
            ) : (
              <>
                <Link href="/login" className="nav-link">Log in</Link>
                <Link href="/signup" className="btn px-3 py-1.5 text-sm no-underline hover:no-underline">Sign up</Link>
              </>
            )}
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </>
  );
}
