import { qRequired, qText } from "@/lib/questions";

// (Owner-approved) The full app's "By question" view (views.tsx QuestionView there), on lean data: every written question,
// each tester's answer under it (testers can be on different versions of the questions: each answer goes under its own
// question), the question marked "not required" where someone could leave it blank, then "Other notes".

export type Sheet = {
  contractId: string; tester: string; questions: string[]; answers: string[]; notes: string; sentAt: Date;
  /** "paid" | "rejected" | "waiting" (not reviewed yet) */
  status: "paid" | "rejected" | "waiting"; paidCents: number;
};
export type QuestionBlock = { title: string; /** (batch 26 section 14) ticked Required in some version */ required: boolean; answers: { contractId: string; tester: string; text: string; sentAt: Date; status: Sheet["status"]; paidCents: number }[] };

export function byQuestion(testQuestions: string[], sheets: Sheet[]): QuestionBlock[] {
  const titles = [...new Set([...testQuestions.map(qText), ...sheets.flatMap((s) => s.questions.map(qText))])];

  const required = new Set([...testQuestions, ...sheets.flatMap((s) => s.questions)].filter(qRequired).map(qText));
  const row = (s: Sheet, text: string) => ({ contractId: s.contractId, tester: s.tester, text, sentAt: s.sentAt, status: s.status, paidCents: s.paidCents });
  const blocks: QuestionBlock[] = titles.map((title) => ({
    title,

    required: required.has(title),
    answers: sheets
      .map((s) => row(s, (s.answers[s.questions.map(qText).indexOf(title)] ?? "").trim()))
      .filter((a) => a.text),
  }));
  blocks.push({ title: "Other notes", required: false, answers: sheets.map((s) => row(s, s.notes.trim())).filter((a) => a.text) });
  return blocks.filter((b) => b.answers.length > 0);
}
