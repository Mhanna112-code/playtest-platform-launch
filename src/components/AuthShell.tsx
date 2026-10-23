import { Brand } from "@/components/Brand";

/** The signed-out pages (log in, sign up, forgot, reset, confirm): the logo and one card. */
export function AuthShell({ title, intro, children }: { title: string; intro?: React.ReactNode; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-md space-y-6 px-4 py-8">
      <Brand />
      <div>
        <h1>{title}</h1>
        {intro && <p className="note mt-2">{intro}</p>}
      </div>
      {children}
    </main>
  );
}
