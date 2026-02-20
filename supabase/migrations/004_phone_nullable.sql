-- Allow email-only authentication by making phone nullable
ALTER TABLE public.users ALTER COLUMN phone DROP NOT NULL;

-- Replace the existing unique constraint with a partial unique index
-- that only enforces uniqueness when phone is non-null
DO $$
BEGIN
  -- Drop existing unique constraint/index on phone (could be either format)
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_phone_key') THEN
    ALTER TABLE public.users DROP CONSTRAINT users_phone_key;
  END IF;
END $$;

-- Create partial unique index (unique only when phone is non-null)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_unique
  ON public.users(phone) WHERE phone IS NOT NULL;
