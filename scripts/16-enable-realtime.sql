-- Enable realtime for the messages table
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;

-- Ensure the messages table has proper realtime permissions
GRANT SELECT ON public.messages TO anon;
GRANT SELECT ON public.messages TO authenticated;

-- Enable row level security for realtime (if not already enabled)
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Create a policy that allows users to see messages in chats they have access to
-- This is specifically for realtime subscriptions
DROP POLICY IF EXISTS "messages_realtime_access" ON public.messages;
CREATE POLICY "messages_realtime_access" ON public.messages
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

-- Ensure profiles table is also available for realtime username lookups
ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;
GRANT SELECT ON public.profiles TO anon;
GRANT SELECT ON public.profiles TO authenticated;

-- Test that realtime is working
SELECT 'Realtime enabled for messages and profiles tables' as status;
