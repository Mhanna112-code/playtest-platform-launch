import type { LucideIcon } from "lucide-react";
import { BookOpen, Briefcase, Clapperboard, Code2, Gamepad2, HeartPulse, LayoutGrid, Shapes, ShoppingBag, Sparkles, Users, Wallet } from "lucide-react";

// The full app's category badges (src/components/category.tsx there): one icon + colour per category.
export const CATEGORY_STYLE: Record<string, { icon: LucideIcon; color: string }> = {
  Game: { icon: Gamepad2, color: "text-fuchsia-300" },
  Productivity: { icon: LayoutGrid, color: "text-sky-300" },
  Social: { icon: Users, color: "text-pink-300" },
  Entertainment: { icon: Clapperboard, color: "text-rose-300" },
  Education: { icon: BookOpen, color: "text-amber-300" },
  "Health & fitness": { icon: HeartPulse, color: "text-emerald-300" },
  Finance: { icon: Wallet, color: "text-lime-300" },
  Shopping: { icon: ShoppingBag, color: "text-orange-300" },
  Business: { icon: Briefcase, color: "text-indigo-300" },
  "Developer tools": { icon: Code2, color: "text-cyan-300" },
  AI: { icon: Sparkles, color: "text-violet-300" },
  Other: { icon: Shapes, color: "text-slate-300" },
};

export function CategoryIcon({ category, className = "h-4 w-4" }: { category: string; className?: string }) {
  const style = CATEGORY_STYLE[category] ?? CATEGORY_STYLE.Other;
  const Icon = style.icon;
  return <Icon className={`${className} ${style.color}`} />;
}

export function CategoryBadge({ category }: { category: string }) {
  return (
    <span className="badge">
      <CategoryIcon category={category} className="h-3.5 w-3.5" /> {category}
    </span>
  );
}

/** One badge per category. */
export function CategoryBadges({ categories }: { categories: string[] }) {
  return <>{categories.map((c) => <CategoryBadge key={c} category={c} />)}</>;
}
