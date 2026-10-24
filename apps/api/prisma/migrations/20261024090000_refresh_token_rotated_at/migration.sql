-- Which refresh tokens were revoked by being swapped for a new one.
--
-- Only those get the one-minute grace for a response that never arrived. Until
-- now any token revoked in the last minute did, including one revoked on purpose
-- (logout, a password change, an admin ending a session), which left whoever
-- had stolen it a minute to trade it for a fresh pair.
--
-- Tokens that are already revoked get no grace period: there is no telling a
-- swap from a deliberate revocation for rows that are already there.
ALTER TABLE "refresh_tokens" ADD COLUMN     "rotatedAt" TIMESTAMP(3);
