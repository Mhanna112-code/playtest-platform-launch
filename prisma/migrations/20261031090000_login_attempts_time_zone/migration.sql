-- Batch 15 section 7: sign-in and sign-up attempts (limits); section 11: each person's time zone.
ALTER TABLE "User" ADD COLUMN "timeZone" TEXT NOT NULL DEFAULT '';

CREATE TABLE "LoginAttempt" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'login',
    "ok" BOOLEAN NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LoginAttempt_email_at_idx" ON "LoginAttempt"("email", "at");
CREATE INDEX "LoginAttempt_ip_at_idx" ON "LoginAttempt"("ip", "at");
