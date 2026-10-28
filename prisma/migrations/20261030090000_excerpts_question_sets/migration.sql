-- (Owner, Oct 29, batch 13) Excerpt requests, and written answers stored as whole sets of questions and answers.

-- CreateTable
CREATE TABLE "Excerpt" (
    "id" TEXT NOT NULL,
    "testerId" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "question" TEXT NOT NULL DEFAULT '',
    "text" TEXT NOT NULL,
    "hideProduct" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "closedReason" TEXT NOT NULL DEFAULT '',
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Excerpt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Excerpt_testerId_status_idx" ON "Excerpt"("testerId", "status");

-- CreateIndex
CREATE INDEX "Excerpt_testId_status_idx" ON "Excerpt"("testId", "status");

-- AddForeignKey
ALTER TABLE "Excerpt" ADD CONSTRAINT "Excerpt_testerId_fkey" FOREIGN KEY ("testerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Excerpt" ADD CONSTRAINT "Excerpt_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Excerpt" ADD CONSTRAINT "Excerpt_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Excerpt" ADD CONSTRAINT "Excerpt_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "Submission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: the tester's previous sets of questions and answers (sent or draft), newest first, at most 3
ALTER TABLE "Contract" ADD COLUMN     "prevSets" JSONB NOT NULL DEFAULT '[]';

-- AlterTable: the developer's earlier SENT sets, and when the set last sent stopped being the current questions
ALTER TABLE "Submission" ADD COLUMN     "prevSets" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "setUntil" TIMESTAMP(3);

-- Data: a written part's answers (a list of strings) become [{ question, required, answer }], paired with the contract's questions by position.
-- A question stored with the "[not required] " marker is a not-required question. An answer past the last question keeps a numbered label.
UPDATE "Submission" s
SET "answers" = COALESCE((
  SELECT jsonb_agg(jsonb_build_object(
      'question', CASE WHEN q.val IS NULL THEN 'Question ' || a.idx WHEN q.val LIKE '[not required] %' THEN substr(q.val, 16) ELSE q.val END,
      'required', NOT COALESCE(q.val LIKE '[not required] %', false),
      'answer', a.val
    ) ORDER BY a.idx)
  FROM jsonb_array_elements_text(s."answers") WITH ORDINALITY AS a(val, idx)
  JOIN "Contract" c ON c."id" = s."contractId"
  LEFT JOIN LATERAL (
    SELECT x.val FROM jsonb_array_elements_text(CASE WHEN jsonb_typeof(c."questions") = 'array' THEN c."questions" ELSE '[]'::jsonb END) WITH ORDINALITY AS x(val, idx) WHERE x.idx = a.idx
  ) q ON true
), '[]'::jsonb)
WHERE s."kind" = 'written'
  AND jsonb_typeof(s."answers") = 'array'
  AND jsonb_array_length(s."answers") > 0
  AND jsonb_typeof(s."answers"->0) = 'string';
