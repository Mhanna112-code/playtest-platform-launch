import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Batch 16 section 10 (owner, Oct 28): every form with field mistakes shows each mistake at its field (red box, red line, the same text from the
// client check or the server), lists the red fields under the button (one linked bullet each), and goes to the first one on a press.
const src = (f: string) => readFileSync(path.resolve(__dirname, "../src", f), "utf8");

const FORMS: [file: string, uses: "FormMistakes" | "MistakeList", press: string][] = [
  ["components/AuthForm.tsx", "FormMistakes", "press={p.submit}"],
  ["app/app/profile/ProfileForm.tsx", "FormMistakes", 'press={first ? "Continue" : "Save profile"}'],
  ["app/app/profile/PasswordForm.tsx", "FormMistakes", 'press="Save the new password"'],
  ["app/app/help/ContactForm.tsx", "FormMistakes", 'press="Send to the team"'],
  ["app/app/sessions/[id]/SessionActions.tsx", "FormMistakes", 'press="Send the dispute"'],
  ["components/RateBox.tsx", "FormMistakes", 'press={p.working ? "Rate and finish" : "Rate"}'],
  ["app/app/tests/[id]/PayBox.tsx", "FormMistakes", 'press={more ? "Pay more" : "Pay"}'],
  ["app/app/sessions/[id]/ChoiceBox.tsx", "FormMistakes", 'press="Charge"'],
  ["app/app/sessions/[id]/RecordingUpload.tsx", "FormMistakes", "press={sentBefore"],
  ["app/app/sessions/[id]/WrittenAttachments.tsx", "FormMistakes", 'press="Attach"'],
  ["app/admin/DisputeDecision.tsx", "FormMistakes", 'press="Decide"'],
  ["app/admin/AdminButton.tsx", "FormMistakes", "press={label}"],
  ["components/CancelMenu.tsx", "MistakeList", 'press={p.label ?? "Cancel this call"}'],
  ["components/CallRequests.tsx", "FormMistakes", 'press="Request a time"'],
  ["app/app/tests/[id]/DevCallPanel.tsx", "FormMistakes", 'press="Request a time"'],
  ["app/app/tests/[id]/InvitePanel.tsx", "MistakeList", 'press="Invite"'],
  ["app/app/tests/[id]/TopPanel.tsx", "FormMistakes", 'press="End their work now"'],
  ["components/Chat.tsx", "FormMistakes", 'press="Send"'],
  ["components/Excerpts.tsx", "FormMistakes", 'press="Ask the developer"'],
  ["components/ReportButton.tsx", "FormMistakes", 'press="Send to the team"'],
];

// [form, server file, the exact line]: the client check says what the server says.
const SAME_TEXT: [string, string, string][] = [
  ["app/login/LoginForm.tsx", "lib/server/passwords.ts", "Enter a valid email"],
  ["app/login/LoginForm.tsx", "lib/server/passwords.ts", "Enter your password"],
  ["app/signup/page.tsx", "lib/server/passwords.ts", "Enter your name"],
  ["app/signup/page.tsx", "lib/server/passwords.ts", "Password must be at least 8 characters"],
  ["app/forgot/page.tsx", "lib/server/passwords.ts", "Enter a valid email"],
  ["app/reset/[token]/page.tsx", "lib/server/passwords.ts", "Use at least 8 characters"],
  ["app/app/profile/PasswordForm.tsx", "lib/server/passwords.ts", "Use at least 8 characters"],
  ["app/app/profile/ProfileForm.tsx", "lib/server/users.ts", "Enter your name (others see it)."],
  ["app/app/help/ContactForm.tsx", "app/api/help/route.ts", "Choose what it's about."],
  ["app/app/help/ContactForm.tsx", "app/api/help/route.ts", "Write a few words about what happened (at least 10 characters)."],
  // (Batch 26 section 14) The form and the server both check with answersMissing, which holds the lines.
  ["lib/questions.ts", "lib/questions.ts", "Answer every required question before sending."],
  ["lib/questions.ts", "lib/questions.ts", "Answer at least one question before sending."],
  ["app/app/sessions/[id]/SessionActions.tsx", "lib/server/payments.ts", "Say why you think the pay should be higher (at least a sentence)."],
  ["components/RateBox.tsx", "lib/server/ratings.ts", "Choose 1 to 5 stars."],
  ["app/app/tests/[id]/PayBox.tsx", "lib/rules.ts", "Enter an amount like 7.50."],
  ["app/app/sessions/[id]/ChoiceBox.tsx", "lib/server/holds.ts", "Enter an amount like 5.00."],
  ["app/app/sessions/[id]/ChoiceBox.tsx", "lib/server/holds.ts", "The smallest card charge is $0.50."],
  ["components/CancelMenu.tsx", "lib/rules.ts", "The call is less than 24 hours away: say why you're cancelling (the other side sees it)."],
  ["components/CallRequests.tsx", "lib/server/requests.ts", "Enter the call's length in minutes."],
  ["app/app/tests/[id]/DevCallPanel.tsx", "lib/server/requests.ts", "Enter the call's length in minutes."],
  ["app/app/tests/[id]/TopPanel.tsx", "lib/server/tests.ts", "Say why you're ending their work (they read it)."],
  ["app/app/sessions/[id]/RecordingUpload.tsx", "lib/server/recordings.ts", "Recordings can be at most 500 MB."],
  ["app/app/sessions/[id]/WrittenAttachments.tsx", "lib/server/recordings.ts", "Files can be at most 25 MB."],
  ["components/ReportButton.tsx", "lib/server/reports.ts", "Say what happened (the team reads it)."],
];

describe("section 10: one rule for every form with field mistakes", () => {
  for (const [file, uses, press] of FORMS) {
    it(`${file}: the list under the button (${uses}), naming its press`, () => {
      const s = src(file);
      expect(s).toContain(`<${uses} `);
      expect(s).toContain(press);
      // Red mistakes never show as a bare <Err> line any more (blue refusals still do, through FormMistakes or their own Err).
      expect(s).not.toMatch(/<Err text=\{err\} \/>\s*<\/(form|details)>/);
    });
  }
  for (const [form, server, line] of SAME_TEXT) {
    it(`${form}: "${line}" is the server's own line (${server})`, () => {
      expect(src(form)).toContain(line);
      expect(src(server)).toContain(line);
    });
  }
  it("server lines land on their field: data-match on the boxes", () => {
    expect(src("app/login/LoginForm.tsx")).toContain('data-match="your password|wrong email or password"');
    expect(src("app/signup/page.tsx")).toContain('data-match="terms of use"');
    expect(src("app/app/tests/[id]/PayBox.tsx")).toContain('data-match="^Tick “I understand"');
    expect(src("components/RateBox.tsx")).toContain('data-match="stars"');
    expect(src("app/app/sessions/[id]/SessionActions.tsx")).toContain("find={(m) => (m === ANSWER_ONE ? document.getElementById(`a${missingAt ?? 0}`) : m === ANSWER_REQUIRED");
  });
  it("boxes that aren't forms are their own root; a component's own red line is data-red-msg", () => {
    for (const f of ["app/app/tests/[id]/PayBox.tsx", "app/app/sessions/[id]/ChoiceBox.tsx", "components/RateBox.tsx", "components/CancelMenu.tsx", "app/admin/DisputeDecision.tsx", "app/app/tests/[id]/InvitePanel.tsx"])
      expect(src(f), f).toContain('data-mistakes-root=""');
    expect(src("app/app/tests/[id]/PayBox.tsx")).toContain("data-red-msg={overText || undefined}");
    expect(src("app/app/tests/[id]/InvitePanel.tsx")).toContain('data-red-msg={none ? "Tick at least one tester." : undefined}');
    // The password box's red line goes under the box (not inside it, under the Show button).
    expect(src("components/PasswordInput.tsx")).toContain('data-note-after=""');
    expect(src("components/FieldChecks.tsx")).toContain('(el.closest("[data-note-after]") ?? el).insertAdjacentElement("afterend", note)');
  });
  it("the field checks run on every page, signed out too", () => {
    expect(src("app/layout.tsx")).toContain("<FieldChecks />");
  });
});
