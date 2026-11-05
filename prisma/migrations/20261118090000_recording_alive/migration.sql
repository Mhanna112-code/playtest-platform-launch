-- (Owner, Nov 5) When the uploading page last said the upload is still going: only a live upload holds Send.
ALTER TABLE "Recording" ADD COLUMN "aliveAt" TIMESTAMP(3);
