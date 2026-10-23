import type { Metadata, Viewport } from "next";
// Fonts are bundled with the site (no requests to font hosts), as on the full Playtest Platform.
import "@fontsource-variable/bricolage-grotesque";
import "@fontsource-variable/inter";
import "@fontsource/jetbrains-mono/400.css";
import "./globals.css";

export const viewport: Viewport = { themeColor: "#0a0d18" };
export const metadata: Metadata = { title: "Playtest", description: "Real people test your apps, games and more. You choose what to pay for their feedback." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col">
        <div className="flex-1">{children}</div>
        <footer className="border-t border-white/[0.06] py-6 text-center text-xs text-ink-500">
          Playtest · real people test your apps, games and more · <a href="/">Home</a>
        </footer>
      </body>
    </html>
  );
}
