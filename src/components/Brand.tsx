import Link from "next/link";

/** The full Playtest Platform's mark: a "play" button with a red recording dot on the lime tile. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="1" y="2" width="30" height="28" rx="9" fill="#62820b" />
      <rect x="1" y="1" width="30" height="27" rx="9" fill="#d8fc52" />
      <path d="M12.2 8.6c0-1.1 1.2-1.8 2.2-1.2l8.3 5.2c.9.6.9 1.9 0 2.5l-8.3 5.2c-1 .6-2.2-.1-2.2-1.2z" fill="#0a0d18" />
      <circle cx="25" cy="7" r="3.6" fill="#ff3f72" stroke="#0a0d18" strokeWidth="1.6" />
    </svg>
  );
}

export function Brand() {
  return (
    <Link href="/" className="group flex items-center gap-2 no-underline hover:no-underline">
      <span className="transition group-hover:-rotate-6"><LogoMark /></span>
      <span className="font-display text-lg font-extrabold tracking-tight text-white">Playtest</span>
    </Link>
  );
}
