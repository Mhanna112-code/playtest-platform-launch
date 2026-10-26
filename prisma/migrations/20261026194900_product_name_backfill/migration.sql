-- (Design doc 4) Existing tests: the product name starts as the title (the owner can change it in Edit).
UPDATE "Test" SET "productName" = "title" WHERE "productName" = '';
