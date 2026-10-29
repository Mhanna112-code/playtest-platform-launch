-- (Owner, Oct 29, batch 26 section 14) Questions are NOT required by default now: a required question is stored with "[required] " in front, an unmarked one is
-- not required. Data only (no schema change): every stored question list loses the old "[not required] " marker; the questions that had no marker (required
-- before) become not required, as the owner asked. Covers the tests, contracts, terms offers (offered and before), pending applications' listing snapshots and the
-- Contract changes history.
CREATE OR REPLACE FUNCTION pg_temp.playtest_strip_not_required(q jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN q IS NULL OR jsonb_typeof(q) <> 'array' THEN q ELSE (
    SELECT COALESCE(jsonb_agg(CASE WHEN jsonb_typeof(e) = 'string' AND starts_with(e #>> '{}', '[not required] ') THEN to_jsonb(substr(e #>> '{}', 16)) ELSE e END ORDER BY i), '[]'::jsonb)
    FROM jsonb_array_elements(q) WITH ORDINALITY AS x(e, i)
  ) END
$$;

UPDATE "Test" SET "questions" = pg_temp.playtest_strip_not_required("questions") WHERE "questions"::text LIKE '%[not required] %';
UPDATE "Contract" SET "questions" = pg_temp.playtest_strip_not_required("questions") WHERE "questions"::text LIKE '%[not required] %';
UPDATE "TermsOffer" SET "questions" = pg_temp.playtest_strip_not_required("questions") WHERE "questions"::text LIKE '%[not required] %';
UPDATE "TermsOffer" SET "fromQuestions" = pg_temp.playtest_strip_not_required("fromQuestions") WHERE "fromQuestions"::text LIKE '%[not required] %';
UPDATE "Application" SET "listing" = jsonb_set("listing", '{questions}', pg_temp.playtest_strip_not_required("listing"->'questions'))
  WHERE jsonb_typeof("listing"->'questions') = 'array' AND ("listing"->'questions')::text LIKE '%[not required] %';
UPDATE "TestChange" SET "before" = jsonb_set("before", '{questions}', pg_temp.playtest_strip_not_required("before"->'questions'))
  WHERE jsonb_typeof("before"->'questions') = 'array' AND ("before"->'questions')::text LIKE '%[not required] %';
UPDATE "TestChange" SET "after" = jsonb_set("after", '{questions}', pg_temp.playtest_strip_not_required("after"->'questions'))
  WHERE jsonb_typeof("after"->'questions') = 'array' AND ("after"->'questions')::text LIKE '%[not required] %';

DROP FUNCTION pg_temp.playtest_strip_not_required(jsonb);
