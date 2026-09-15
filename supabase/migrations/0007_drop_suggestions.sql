-- The article-suggestion feature was removed (never used — the table held
-- zero rows when it was dropped). Nothing else references rc_suggestions.
drop table if exists rc_suggestions;
