-- ============================================================
-- F-Society — Supabase Database Schema
-- EXN STUDIO
-- Run this in the Supabase SQL Editor to set up all tables,
-- RLS policies, and triggers.
-- ============================================================

-- ── ENABLE UUID EXTENSION ────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- TABLE: chat_messages
-- Stores all global chat messages and file metadata.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.chat_messages (
  id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  username      TEXT        NOT NULL,
  content       TEXT        NOT NULL DEFAULT '',
  message_type  TEXT        NOT NULL DEFAULT 'text'  CHECK (message_type IN ('text', 'file')),
  file_name     TEXT,
  file_path     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for chronological queries
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at
  ON public.chat_messages (created_at DESC);

-- ── RLS: chat_messages ────────────────────────────────────
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read all messages
CREATE POLICY "chat_messages_select_authenticated"
  ON public.chat_messages FOR SELECT
  TO authenticated
  USING (true);

-- Users can only insert their own messages
CREATE POLICY "chat_messages_insert_own"
  ON public.chat_messages FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users cannot update messages
-- (No UPDATE policy = no updates)

-- Users cannot delete their own messages (moderation-only)
-- (No DELETE policy for users)

-- ============================================================
-- TABLE: pending_deletions
-- Tracks accounts scheduled for deletion (14-day grace).
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pending_deletions (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  delete_at   TIMESTAMPTZ NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── RLS: pending_deletions ────────────────────────────────
ALTER TABLE public.pending_deletions ENABLE ROW LEVEL SECURITY;

-- Users can see their own pending deletion
CREATE POLICY "pending_deletions_select_own"
  ON public.pending_deletions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can insert their own deletion request
CREATE POLICY "pending_deletions_insert_own"
  ON public.pending_deletions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own (upsert support)
CREATE POLICY "pending_deletions_update_own"
  ON public.pending_deletions FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

-- Users can cancel their own deletion (delete the record = cancel)
CREATE POLICY "pending_deletions_delete_own"
  ON public.pending_deletions FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================
-- TABLE: file_upload_tracking
-- Server-side daily upload limit enforcement.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.file_upload_tracking (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  upload_date DATE        NOT NULL DEFAULT CURRENT_DATE,
  count       INTEGER     NOT NULL DEFAULT 0,
  UNIQUE (user_id, upload_date)
);

-- ── RLS: file_upload_tracking ─────────────────────────────
ALTER TABLE public.file_upload_tracking ENABLE ROW LEVEL SECURITY;

CREATE POLICY "upload_tracking_select_own"
  ON public.file_upload_tracking FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "upload_tracking_upsert_own"
  ON public.file_upload_tracking FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "upload_tracking_update_own"
  ON public.file_upload_tracking FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================
-- FUNCTION: increment_upload_count
-- Called server-side to safely increment user's daily upload count.
-- Returns false if limit (3) reached.
-- ============================================================
CREATE OR REPLACE FUNCTION public.increment_upload_count(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  INSERT INTO public.file_upload_tracking (user_id, upload_date, count)
  VALUES (p_user_id, CURRENT_DATE, 1)
  ON CONFLICT (user_id, upload_date)
  DO UPDATE SET count = file_upload_tracking.count + 1
  RETURNING count INTO v_count;

  RETURN v_count <= 3;
END;
$$;

-- ============================================================
-- STORAGE: Create buckets
-- Run these in the Supabase Dashboard > Storage, or via API.
-- ============================================================

-- Bucket: chat-files (for user-uploaded .txt files)
-- Settings:
--   Public: false (authenticated access only)
--   File size limit: 5120 (5KB)
--   Allowed MIME types: text/plain

-- Storage RLS policies for chat-files bucket:
-- (Apply these in Supabase Dashboard > Storage > Policies)

/*
  Policy: Allow authenticated users to upload to their own folder
  Operation: INSERT
  Definition: (bucket_id = 'chat-files') AND (auth.uid()::text = (storage.foldername(name))[1])

  Policy: Allow authenticated users to read all files
  Operation: SELECT
  Definition: bucket_id = 'chat-files'

  Policy: Allow users to delete their own files
  Operation: DELETE
  Definition: (bucket_id = 'chat-files') AND (auth.uid()::text = (storage.foldername(name))[1])
*/

-- ============================================================
-- REALTIME: Enable for chat_messages
-- Run in Supabase Dashboard > Database > Replication
-- Or via SQL:
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;

-- ============================================================
-- CRON JOB: Permanent deletion of expired accounts
-- Requires pg_cron extension (enable in Supabase Dashboard).
-- Runs daily at 02:00 UTC.
-- ============================================================
-- SELECT cron.schedule(
--   'delete-expired-accounts',
--   '0 2 * * *',
--   $$
--     DELETE FROM auth.users
--     WHERE id IN (
--       SELECT user_id FROM public.pending_deletions
--       WHERE delete_at < NOW()
--     );
--   $$
-- );

-- ============================================================
-- NOTES FOR SETUP:
--
-- 1. Run this entire script in Supabase SQL Editor.
-- 2. Create the "chat-files" Storage bucket in Dashboard:
--    - Public: OFF
--    - Max file size: 5120 bytes
--    - Allowed types: text/plain
-- 3. Add Storage RLS policies as described in comments above.
-- 4. Enable Realtime for chat_messages in Dashboard > Database > Replication.
-- 5. (Optional) Enable pg_cron for automatic account deletion.
-- 6. Set Netlify environment variables:
--    SUPABASE_URL, SUPABASE_ANON_KEY, JSONBIN_BIN_ID, JSONBIN_API_KEY
-- ============================================================
