-- A share password is worth looking up: the link is already out there, and
-- resetting it to remember what it was locks out everyone who has it. Kept
-- encrypted next to the hash, never in the clear.
ALTER TABLE "share_links" ADD COLUMN "passwordEnc" TEXT;
