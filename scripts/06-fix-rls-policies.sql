-- Drop all existing policies to start fresh
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;

DROP POLICY IF EXISTS "Users can view chats they participate in" ON public.chats;
DROP POLICY IF EXISTS "Users can create chats" ON public.chats;
DROP POLICY IF EXISTS "Chat owners can update their chats" ON public.chats;
DROP POLICY IF EXISTS "Chat owners can delete their chats" ON public.chats;

DROP POLICY IF EXISTS "Users can view participants of chats they're in" ON public.chat_participants;
DROP POLICY IF EXISTS "Users can join chats" ON public.chat_participants;
DROP POLICY IF EXISTS "Users can leave chats" ON public.chat_participants;

DROP POLICY IF EXISTS "Users can view messages in chats they participate in" ON public.messages;
DROP POLICY IF EXISTS "Users can send messages to chats they participate in" ON public.messages;

-- Create simple, non-recursive policies

-- Profiles policies (simple)
CREATE POLICY "profiles_select_own" ON public.profiles
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "profiles_update_own" ON public.profiles
    FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "profiles_insert_own" ON public.profiles
    FOR INSERT WITH CHECK (auth.uid() = id);

-- Chats policies (simple - no recursive checks)
CREATE POLICY "chats_select_owner" ON public.chats
    FOR SELECT USING (auth.uid() = owner_id);

CREATE POLICY "chats_insert_owner" ON public.chats
    FOR INSERT WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "chats_update_owner" ON public.chats
    FOR UPDATE USING (auth.uid() = owner_id);

CREATE POLICY "chats_delete_owner" ON public.chats
    FOR DELETE USING (auth.uid() = owner_id);

-- Chat participants policies (simple)
CREATE POLICY "chat_participants_select_own" ON public.chat_participants
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "chat_participants_insert_own" ON public.chat_participants
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "chat_participants_delete_own" ON public.chat_participants
    FOR DELETE USING (auth.uid() = user_id);

-- Messages policies (simple)
CREATE POLICY "messages_select_own_chats" ON public.messages
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.chats 
            WHERE chats.id = messages.chat_id 
            AND chats.owner_id = auth.uid()
        )
        OR
        EXISTS (
            SELECT 1 FROM public.chat_participants 
            WHERE chat_participants.chat_id = messages.chat_id 
            AND chat_participants.user_id = auth.uid()
        )
    );

CREATE POLICY "messages_insert_own" ON public.messages
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Grant necessary permissions
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;

-- Ensure service role can bypass RLS
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
