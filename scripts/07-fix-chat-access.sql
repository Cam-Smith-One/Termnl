-- Drop all existing policies to start fresh
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;

DROP POLICY IF EXISTS "chats_select_owner" ON public.chats;
DROP POLICY IF EXISTS "chats_insert_owner" ON public.chats;
DROP POLICY IF EXISTS "chats_update_owner" ON public.chats;
DROP POLICY IF EXISTS "chats_delete_owner" ON public.chats;

DROP POLICY IF EXISTS "chat_participants_select_own" ON public.chat_participants;
DROP POLICY IF EXISTS "chat_participants_insert_own" ON public.chat_participants;
DROP POLICY IF EXISTS "chat_participants_delete_own" ON public.chat_participants;

DROP POLICY IF EXISTS "messages_select_own_chats" ON public.messages;
DROP POLICY IF EXISTS "messages_insert_own" ON public.messages;

-- Create comprehensive policies that allow proper access

-- Profiles policies
CREATE POLICY "profiles_all_access" ON public.profiles
    FOR ALL USING (auth.uid() = id);

-- Chats policies - allow access if user is owner OR participant
CREATE POLICY "chats_select_access" ON public.chats
    FOR SELECT USING (
        auth.uid() = owner_id 
        OR 
        EXISTS (
            SELECT 1 FROM public.chat_participants 
            WHERE chat_participants.chat_id = chats.id 
            AND chat_participants.user_id = auth.uid()
        )
    );

CREATE POLICY "chats_insert_owner" ON public.chats
    FOR INSERT WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "chats_update_owner" ON public.chats
    FOR UPDATE USING (auth.uid() = owner_id);

CREATE POLICY "chats_delete_owner" ON public.chats
    FOR DELETE USING (auth.uid() = owner_id);

-- Chat participants policies - allow viewing all participants in chats user has access to
CREATE POLICY "chat_participants_select_access" ON public.chat_participants
    FOR SELECT USING (
        auth.uid() = user_id
        OR
        EXISTS (
            SELECT 1 FROM public.chats 
            WHERE chats.id = chat_participants.chat_id 
            AND chats.owner_id = auth.uid()
        )
        OR
        EXISTS (
            SELECT 1 FROM public.chat_participants cp2
            WHERE cp2.chat_id = chat_participants.chat_id 
            AND cp2.user_id = auth.uid()
        )
    );

CREATE POLICY "chat_participants_insert_own" ON public.chat_participants
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "chat_participants_delete_own" ON public.chat_participants
    FOR DELETE USING (auth.uid() = user_id);

-- Messages policies - allow access to messages in chats user has access to
CREATE POLICY "messages_select_access" ON public.messages
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
    FOR INSERT WITH CHECK (
        auth.uid() = user_id
        AND
        (
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
        )
    );

-- Grant necessary permissions
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;

-- Ensure service role can bypass RLS
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

-- Create indexes to improve performance of RLS policies
CREATE INDEX IF NOT EXISTS idx_chat_participants_user_chat ON public.chat_participants(user_id, chat_id);
CREATE INDEX IF NOT EXISTS idx_chats_owner ON public.chats(owner_id);
CREATE INDEX IF NOT EXISTS idx_messages_chat_user ON public.messages(chat_id, user_id);
