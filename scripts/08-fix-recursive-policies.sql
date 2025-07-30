-- Drop all existing policies to start fresh
DROP POLICY IF EXISTS "profiles_all_access" ON public.profiles;

DROP POLICY IF EXISTS "chats_select_access" ON public.chats;
DROP POLICY IF EXISTS "chats_insert_owner" ON public.chats;
DROP POLICY IF EXISTS "chats_update_owner" ON public.chats;
DROP POLICY IF EXISTS "chats_delete_owner" ON public.chats;

DROP POLICY IF EXISTS "chat_participants_select_access" ON public.chat_participants;
DROP POLICY IF EXISTS "chat_participants_insert_own" ON public.chat_participants;
DROP POLICY IF EXISTS "chat_participants_delete_own" ON public.chat_participants;

DROP POLICY IF EXISTS "messages_select_access" ON public.messages;
DROP POLICY IF EXISTS "messages_insert_own" ON public.messages;

-- Drop the function that might be causing issues
DROP FUNCTION IF EXISTS user_can_access_chat(uuid, uuid);

-- Create simple, non-recursive policies

-- Profiles policies - simple ownership
CREATE POLICY "profiles_own_access" ON public.profiles
    FOR ALL USING (auth.uid() = id);

-- Chats policies - SIMPLE ownership only, no participant checks
CREATE POLICY "chats_owner_access" ON public.chats
    FOR ALL USING (auth.uid() = owner_id);

-- Chat participants policies - simple ownership
CREATE POLICY "chat_participants_own_access" ON public.chat_participants
    FOR ALL USING (auth.uid() = user_id);

-- Messages policies - simple checks without recursion
CREATE POLICY "messages_own_access" ON public.messages
    FOR ALL USING (auth.uid() = user_id);

-- Grant necessary permissions
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;

-- Ensure service role can bypass RLS
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

-- Create indexes to improve performance
CREATE INDEX IF NOT EXISTS idx_chat_participants_user_chat ON public.chat_participants(user_id, chat_id);
CREATE INDEX IF NOT EXISTS idx_chats_owner ON public.chats(owner_id);
CREATE INDEX IF NOT EXISTS idx_messages_chat_user ON public.messages(chat_id, user_id);
