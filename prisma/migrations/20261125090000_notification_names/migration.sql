-- (Owner, Nov 11, §388) Bell lines show people's and tests' CURRENT names: each line keeps where it named a person or a test ([{k, id, at, name}]); the bell
-- and the emails read the current names there. Older lines (NULL) keep their stored text.
ALTER TABLE "Notification" ADD COLUMN "names" JSONB;
