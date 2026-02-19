-- ============================================
-- ANONYMOUS CONVERSATIONS (guest buyer support)
-- ============================================

-- Make buyer_id nullable (anonymous users don't have a user record)
ALTER TABLE conversations ALTER COLUMN buyer_id DROP NOT NULL;

-- Add anonymous_id for client-generated session tokens
ALTER TABLE conversations ADD COLUMN anonymous_id text;

-- Replace the existing unique constraint to handle both cases
ALTER TABLE conversations DROP CONSTRAINT conversations_deal_id_buyer_id_key;
CREATE UNIQUE INDEX conversations_deal_id_buyer_id_key
  ON conversations (deal_id, buyer_id) WHERE buyer_id IS NOT NULL;
CREATE UNIQUE INDEX conversations_deal_id_anonymous_id_key
  ON conversations (deal_id, anonymous_id) WHERE anonymous_id IS NOT NULL;

-- Index for claim lookups (anonymous → authenticated transition)
CREATE INDEX idx_conversations_anonymous_id
  ON conversations (anonymous_id) WHERE anonymous_id IS NOT NULL;

-- At least one identifier must exist
ALTER TABLE conversations ADD CONSTRAINT conversations_has_identifier
  CHECK (buyer_id IS NOT NULL OR anonymous_id IS NOT NULL);
