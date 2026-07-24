-- Dedicated source for auto-drawn road routes (deletable separately).
ALTER TYPE "PointSource" ADD VALUE IF NOT EXISTS 'ROUTE_FILL';
