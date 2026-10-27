"use client";
import { usePathname } from "next/navigation";

export type ContractLinkMode = "scroll" | { testId: string };

/** (Owner, Oct 28) Where "See their contract" goes from this page: the test page scrolls to the row; Edit opens the test page at that row in a new tab; elsewhere, nothing. */
export function contractLinkModeFor(path: string): ContractLinkMode | null {
  const m = /^\/app\/tests\/([^/?#]+)(\/edit)?\/?$/.exec(path.split(/[?#]/)[0]);
  if (!m || m[1] === "new") return null;
  return m[2] ? { testId: m[1] } : "scroll";
}

/**
 * (Owner, Oct 27-28) "See their contract" after "Ana switched to the new terms" / "kept their current terms", in the top box and in the stop-once box under a button.
 * On the test page it scrolls to that tester's row with the contract shown (opening the Testers fold); on Edit it opens the test page at that row in a new tab.
 */
export function ContractLink({ contract, mode }: { contract: string; mode?: ContractLinkMode | null }) {
  const path = usePathname() ?? "";
  const m = mode === undefined ? contractLinkModeFor(path) : mode;
  if (!m) return null;
  if (m === "scroll")
    return (
      <a href={`#tester-${contract}`} data-contract-link={contract}
        onClick={() => {
          const fold = document.querySelector("#testers-joined") as HTMLDetailsElement | null;
          fold?.setAttribute("open", "");
          setTimeout(() => document.getElementById(`tester-${contract}`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 0);
        }}>
        See their contract
      </a>
    );
  return <a href={`/app/tests/${m.testId}#tester-${contract}`} target="_blank" rel="noreferrer" data-contract-link={contract}>See their contract</a>;
}
