import { Brand } from "@/components/Brand";
import { VerifyButton } from "./VerifyButton";

export const metadata = { title: "Sign in · Playtest" };

// The link lands here and the user presses a button: email scanners that open links can't use up the token.
export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <main className="wrap max-w-xl space-y-4">
      <Brand />
      <div className="panel">
        <h1>Sign in</h1>
        {token ? <VerifyButton token={token} /> : <p className="err">That link is missing its code. <a href="/login">Ask for a new one</a>.</p>}
      </div>
    </main>
  );
}
