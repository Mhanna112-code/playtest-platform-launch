import Link from "next/link";
import { CalendarClock, ArrowRight } from "lucide-react";
import { TestName } from "@/components/Cut";
import { fmtDateIn } from "@/lib/format";
export function TodoTestRow({id,title,dueAt,now,timeZone}: {id:string;title:string;dueAt:Date;now:Date;timeZone:string|null}) {
 return <div className="card flex flex-wrap items-center gap-3 p-4" data-todo-test={id}><div className="min-w-0 flex-1"><p className="font-semibold text-white"><TestName text={title} href={`/app/sessions/${id}`}/></p><p className="mt-1"><span className="badge"><CalendarClock className="h-3.5 w-3.5"/>Due {fmtDateIn(dueAt,timeZone)}{dueAt<now?" · Deadline passed":""}</span></p></div><Link href={`/app/sessions/${id}#parts`} className="btn text-sm">Send work <ArrowRight className="h-4 w-4"/></Link></div>;
}
