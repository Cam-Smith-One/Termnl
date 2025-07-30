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

-- Create simple, non-recursive policies

-- Profiles policies - simple ownership
CREATE POLICY "profiles_own_access" ON public.profiles
    FOR ALL USING (auth.uid() = id);

-- Chats policies - separate policies for different access patterns
CREATE POLICY "chats_owner_all_access" ON public.chats
    FOR ALL USING (auth.uid() = owner_id);

-- Allow participants to SELECT chats they're part of (using a function to avoid recursion)
CREATE OR REPLACE FUNCTION user_can_access_chat(chat_id uuid, user_id uuid)
RETURNS boolean AS $$
BEGIN
    -- Check if user is owner
    IF EXISTS (
        SELECT 1 FROM public.chats 
        WHERE id = chat_id AND owner_id = user_id
    ) THEN
        RETURN true;
    END IF;
    
    -- Check if user is participant
    IF EXISTS (
        SELECT 1 FROM public.chat_participants 
        WHERE chat_participants.chat_id = chat_id AND chat_participants.user_id = user_id
    ) THEN
        RETURN true;
    END IF;
    
    RETURN false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE POLICY "chats_participant_select" ON public.chats
    FOR SELECT USING (user_can_access_chat(id, auth.uid()));

-- Chat participants policies - simple ownership
CREATE POLICY "chat_participants_own_access" ON public.chat_participants
    FOR ALL USING (auth.uid() = user_id);

-- Allow viewing participants of chats the user owns
CREATE POLICY "chat_participants_owner_view" ON public.chat_participants
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.chats 
            WHERE chats.id = chat_participants.chat_id 
            AND chats.owner_id = auth.uid()
        )
    );

-- Messages policies - use the function to avoid recursion
CREATE POLICY "messages_access" ON public.messages
    FOR SELECT USING (user_can_access_chat(chat_id, auth.uid()));

CREATE POLICY "messages_insert_own" ON public.messages
    FOR INSERT WITH CHECK (
        auth.uid() = user_id 
        AND user_can_access_chat(chat_id, auth.uid())
    );

-- Grant permissions to the function
GRANT EXECUTE ON FUNCTION user_can_access_chat(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION user_can_access_chat(uuid, uuid) TO service_role;

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
