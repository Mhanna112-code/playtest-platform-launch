-- (Batch 30 §2) An updated version sent after a piece was paid, and the developer's answer to it (Pay more, $0 included). Additive: nullable columns and a default.
ALTER TABLE "Submission" ADD COLUMN "paidUpdateAt" TIMESTAMP(3);
ALTER TABLE "Submission" ADD COLUMN "paidUpdateDoneAt" TIMESTAMP(3);
ALTER TABLE "Submission" ADD COLUMN "paidUpdateZeroAt" TIMESTAMP(3);
ALTER TABLE "Submission" ADD COLUMN "paidUpdateNote" TEXT NOT NULL DEFAULT '';

-- (Batch 30 §5) The team closed a piece for $0 (which admin). Additive: a nullable column.
ALTER TABLE "Review" ADD COLUMN "teamClosedById" TEXT;
