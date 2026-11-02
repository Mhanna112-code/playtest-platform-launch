import Link from "next/link";
import { MessageCircle } from "lucide-react";
import type { User } from "@prisma/client";
import { directButtonAllowed } from "@/lib/server/directMessages";

export function ProfileMessageButton({ viewer, other, blocked }: { viewer: User; other: User; blocked: boolean }) {
  if (!directButtonAllowed(viewer, other, blocked)) return null;
  return <Link className="btn-secondary px-3 py-1.5 text-sm" href={`/app/direct/${encodeURIComponent(other.id)}`} data-profile-message=""><MessageCircle className="h-4 w-4" /> Message</Link>;
}
