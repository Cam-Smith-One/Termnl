-- Disable RLS temporarily to clean up
ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.chats DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_participants DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages DISABLE ROW LEVEL SECURITY;

-- Drop ALL existing policies
DROP POLICY IF EXISTS "profiles_own_access" ON public.profiles;
DROP POLICY IF EXISTS "profiles_all_access" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;

DROP POLICY IF EXISTS "chats_owner_access" ON public.chats;
DROP POLICY IF EXISTS "chats_select_access" ON public.chats;
DROP POLICY IF EXISTS "chats_select_owner" ON public.chats;
DROP POLICY IF EXISTS "chats_insert_owner" ON public.chats;
DROP POLICY IF EXISTS "chats_update_owner" ON public.chats;
DROP POLICY IF EXISTS "chats_delete_owner" ON public.chats;

DROP POLICY IF EXISTS "chat_participants_own_access" ON public.chat_participants;
DROP POLICY IF EXISTS "chat_participants_select_access" ON public.chat_participants;
DROP POLICY IF EXISTS "chat_participants_select_own" ON public.chat_participants;
DROP POLICY IF EXISTS "chat_participants_insert_own" ON public.chat_participants;
DROP POLICY IF EXISTS "chat_participants_delete_own" ON public.chat_participants;

DROP POLICY IF EXISTS "messages_own_access" ON public.messages;
DROP POLICY IF EXISTS "messages_select_access" ON public.messages;
DROP POLICY IF EXISTS "messages_select_own_chats" ON public.messages;
DROP POLICY IF EXISTS "messages_insert_own" ON public.messages;

-- Re-enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Create VERY simple policies that don't reference other tables

-- Profiles: Only allow users to access their own profile
CREATE POLICY "profiles_simple" ON public.profiles
    FOR ALL USING (auth.uid() = id);

-- Chats: Only allow owners to access their chats directly
CREATE POLICY "chats_owner_only" ON public.chats
    FOR ALL USING (auth.uid() = owner_id);

-- Chat participants: Only allow users to manage their own participation
CREATE POLICY "participants_own_only" ON public.chat_participants
    FOR ALL USING (auth.uid() = user_id);

-- Messages: Only allow users to access their own messages
CREATE POLICY "messages_own_only" ON public.messages
    FOR ALL USING (auth.uid() = user_id);

-- Grant necessary permissions
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;

-- Ensure service role can bypass RLS
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- Create indexes to improve performance
CREATE INDEX IF NOT EXISTS idx_chat_participants_user_chat ON public.chat_participants(user_id, chat_id);
CREATE INDEX IF NOT EXISTS idx_chats_owner ON public.chats(owner_id);
CREATE INDEX IF NOT EXISTS idx_messages_chat_user ON public.messages(chat_id, user_id);

-- Test the policies by selecting from each table
SELECT 'Profiles policy test' as test, count(*) as count FROM public.profiles;
SELECT 'Chats policy test' as test, count(*) as count FROM public.chats;
SELECT 'Participants policy test' as test, count(*) as count FROM public.chat_participants;
SELECT 'Messages policy test' as test, count(*) as count FROM public.messages;
