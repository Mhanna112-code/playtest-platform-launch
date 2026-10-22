import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "Playtest", description: "Real players test your game. You choose what to pay for their feedback." };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
