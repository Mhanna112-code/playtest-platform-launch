import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Brand } from "@/components/Brand";
import { getPageUser } from "@/lib/server/page-auth";
// Fonts are bundled with the site (no requests to font hosts), as on the full Playtest Platform.
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/inter";
import "@fontsource/jetbrains-mono/400.css";
import "./globals.css";

export const viewport: Viewport = { themeColor: "#0a0d18" };
export const metadata: Metadata = { title: "Playtest", description: "Real people test your apps, games and more. You choose what to pay for their feedback." };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getPageUser();
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col">
        <div className="flex-1">{children}</div>
        <footer className="mt-16 border-t border-white/[0.06]">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-slate-500">
            <div className="flex items-center gap-3">
              <Brand />
              <span className="hidden text-slate-500 sm:inline">Real people test your apps, games and more.</span>
            </div>
            <nav className="flex flex-wrap gap-4">
              <a href="/terms" target="_blank" rel="noopener" className="hover:text-slate-200">Terms of Use</a>
              <Link href="/privacy" className="hover:text-slate-200">Privacy</Link>
              {user && <Link href="/app/help" target="_blank" rel="noopener" className="hover:text-slate-200">Contact us</Link>}
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
