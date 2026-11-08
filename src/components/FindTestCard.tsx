import Link from "next/link";
import { Cut, NameLink, TestName } from "@/components/Cut";
import { CategoryBadges } from "@/components/Category";
import { CategoryTile, mainCategory, PartBadges } from "@/components/Ui";
import { keepAmounts } from "@/components/Amounts";
import { money } from "@/lib/format";
import { testerShare } from "@/lib/rules";
import { Languages, Monitor } from "lucide-react";
import type { ReactNode } from "react";
export type FindCardTest = { id:string; title:string; productName:string|null; categories:string[]; writtenCents:number|null; recordingCents:number|null; liveRateCents:number|null; devices:string[]; languages:string[]; mature:boolean; ndaText:string; joinMode:string; developerId:string; developer:{name:string;email:string;deletedAt?:Date|null} };
export function FindTestCard({test:t,href,terms,developerName,previousName,rating,state,joined=false,invited=false,spots,days,gaps=[],footer,redacted=false}: {test:FindCardTest;href:string;terms:string;developerName:string;previousName?:string;rating?:string;state?:string;joined?:boolean;invited?:boolean;spots?:string;days?:string;gaps?:string[];footer?:ReactNode;redacted?:boolean}) {
 const fixed=[t.writtenCents,t.recordingCents].filter((x):x is number=>x!=null);
 const pay=fixed.length?(Math.min(...fixed)===0?"free":`from ${money(testerShare(Math.min(...fixed)))}`):t.liveRateCents!=null?(t.liveRateCents===0?"free":`${money(testerShare(t.liveRateCents))}/h`):"free";
 return <div className="card card-hover relative flex h-full gap-4 text-ink-100" data-find-card={joined?"joined":"test"}>
 <Link href={href} aria-label={t.title} className="absolute inset-0 rounded-2xl no-underline"/>
 <CategoryTile category={mainCategory(t.categories)}/><div className="min-w-0 flex-1 space-y-2">
 <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1"><div className="min-w-[min(100%,10rem)] flex-1">
 {t.productName&&<p className="kicker"><Cut text={t.productName} kind="product"/></p>}
 <p className="relative z-10 font-semibold"><TestName text={t.title} href={href}/></p>
 <p className="text-sm text-slate-400 [overflow-wrap:anywhere]">by <span className="relative z-10"><NameLink text={developerName} href={t.developer.deletedAt?null:`/app/developers/${t.developerId}`}/></span>{previousName&&` · previously ${previousName}`}{rating&&` · ${rating}`}</p></div>
 {!redacted&&<div className="ml-auto max-w-full shrink-0 text-right sm:max-w-[50%]"><p className="whitespace-nowrap text-lg font-bold text-emerald-300">{pay}</p><p className="text-xs text-slate-400">{keepAmounts(terms)}</p>{spots&&<p className="text-xs text-slate-500">{spots}</p>}</div>}</div>
 <div className="flex flex-wrap gap-2">{state&&<span className={`badge ${state==="Open"||state==="Invited"?"border-emerald-400/40 text-emerald-200":state==="Paused"||state==="Full"||state==="Removed From"?"border-amber-300/40 text-amber-200":"border-slate-400/40 text-slate-300"}`} data-test-state={state}>{state}</span>}{joined&&<span className="badge border-emerald-400/40 text-emerald-200" data-find-joined="">Joined</span>}<CategoryBadges categories={t.categories}/>
 {!redacted&&<><PartBadges written={t.writtenCents!=null} recording={t.recordingCents!=null} live={t.liveRateCents!=null}/>
 {t.devices.length>0&&<span className="badge" title={t.devices.join(" · ")}><Monitor className="h-3.5 w-3.5"/>{t.devices.slice(0,3).join(" · ")}{t.devices.length>3?` +${t.devices.length-3} more`:""}</span>}
 {t.languages.length>0&&<span className="badge" title={t.languages.join(" · ")}><Languages className="h-3.5 w-3.5"/>{t.languages.slice(0,3).join(" · ")}{t.languages.length>3?` +${t.languages.length-3} more`:""}</span>}
 <span className="badge">{t.joinMode==="invite"?"Invitation only":t.joinMode==="apply"?"Approved only":"Anyone can join"}</span>{days&&<span className="badge" data-per-tester="">{days}</span>}{t.mature&&<span className="badge border-rose-300/40 text-rose-200">Mature (18+)</span>}{t.ndaText&&<span className="badge">NDA</span>}</>}{invited&&<span className="badge border-emerald-400/40 text-emerald-200">Invited</span>}</div>
 {gaps.slice(0,3).map(g=><p key={g} className="text-sm text-amber-300" title={g}>{g}</p>)}{gaps.length>3&&<p className="text-sm text-amber-300">+{gaps.length-3} more</p>}{footer&&<div className="relative z-10">{footer}</div>}
 </div></div>;
}
