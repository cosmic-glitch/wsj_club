-- Self-serve signup (the topline Join button): an optional email on every
-- account, stored ONLY for future password recovery — never shown on the site.
alter table rc_users add column email text;
