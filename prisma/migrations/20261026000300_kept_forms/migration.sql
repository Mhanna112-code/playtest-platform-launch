-- CreateTable
CREATE TABLE "KeptForm" (
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KeptForm_pkey" PRIMARY KEY ("userId","key")
);

-- AddForeignKey
ALTER TABLE "KeptForm" ADD CONSTRAINT "KeptForm_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
