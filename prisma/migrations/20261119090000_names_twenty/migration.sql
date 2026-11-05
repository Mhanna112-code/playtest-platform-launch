-- (Owner, Nov 5, batch 35 section 245) Person names, test titles and product names are at most 20 characters, so nothing is ever cut (with ...) or needs expanding.
-- Existing longer ones keep their first 20 characters, spaces at the end trimmed.
UPDATE "User" SET "name" = rtrim(left("name", 20)) WHERE char_length("name") > 20;
UPDATE "Test" SET "title" = rtrim(left("title", 20)) WHERE char_length("title") > 20;
UPDATE "Test" SET "productName" = rtrim(left("productName", 20)) WHERE char_length("productName") > 20;

-- Copies of a test's title (and product name) that are shown as its name: the contract's title (the test's name when the tester joined), the listing an application was made on (so a
-- pending application doesn't read as "changed since you applied" because of this shortening alone) and a Save's before / after (the listing's "before and now").
UPDATE "Contract" SET "title" = rtrim(left("title", 20)) WHERE char_length("title") > 20;
UPDATE "Application" SET "listing" = jsonb_set("listing", '{title}', to_jsonb(rtrim(left("listing"->>'title', 20))))
  WHERE jsonb_typeof("listing") = 'object' AND jsonb_typeof("listing"->'title') = 'string' AND char_length("listing"->>'title') > 20;
UPDATE "Application" SET "listing" = jsonb_set("listing", '{productName}', to_jsonb(rtrim(left("listing"->>'productName', 20))))
  WHERE jsonb_typeof("listing") = 'object' AND jsonb_typeof("listing"->'productName') = 'string' AND char_length("listing"->>'productName') > 20;
UPDATE "TestChange" SET "before" = jsonb_set("before", '{title}', to_jsonb(rtrim(left("before"->>'title', 20))))
  WHERE jsonb_typeof("before") = 'object' AND jsonb_typeof("before"->'title') = 'string' AND char_length("before"->>'title') > 20;
UPDATE "TestChange" SET "before" = jsonb_set("before", '{productName}', to_jsonb(rtrim(left("before"->>'productName', 20))))
  WHERE jsonb_typeof("before") = 'object' AND jsonb_typeof("before"->'productName') = 'string' AND char_length("before"->>'productName') > 20;
UPDATE "TestChange" SET "after" = jsonb_set("after", '{title}', to_jsonb(rtrim(left("after"->>'title', 20))))
  WHERE jsonb_typeof("after") = 'object' AND jsonb_typeof("after"->'title') = 'string' AND char_length("after"->>'title') > 20;
UPDATE "TestChange" SET "after" = jsonb_set("after", '{productName}', to_jsonb(rtrim(left("after"->>'productName', 20))))
  WHERE jsonb_typeof("after") = 'object' AND jsonb_typeof("after"->'productName') = 'string' AND char_length("after"->>'productName') > 20;

-- Left as they were (historic free text, written once): notification, event and contract-note texts, emails, chat, payment (Stripe) descriptions and kept drafts.
