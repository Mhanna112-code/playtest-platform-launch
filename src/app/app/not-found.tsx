import { PAGE_MISSING, ProfileUnavailable } from "@/components/ProfileUnavailable";

/** (Owner, Oct 28, batch 20 section 17) An unknown or deleted id under /app: the normal header and "This page doesn't exist." (not the bare 404). */
export default function AppNotFound() {
  return <ProfileUnavailable line={PAGE_MISSING} />;
}
