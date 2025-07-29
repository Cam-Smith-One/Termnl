-- This script ensures all users have profiles and fixes any permission issues

-- First, grant necessary permissions
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;

-- Ensure the service role can execute functions
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- Fix any existing users that might not have profiles
DO $$
DECLARE
    user_record RECORD;
BEGIN
    FOR user_record IN 
        SELECT id, email, raw_user_meta_data
        FROM auth.users 
        WHERE id NOT IN (SELECT id FROM public.profiles)
    LOOP
        BEGIN
            INSERT INTO public.profiles (id, username, email)
            VALUES (
                user_record.id,
                COALESCE(user_record.raw_user_meta_data->>'username', split_part(user_record.email, '@', 1)),
                user_record.email
            )
            ON CONFLICT (id) DO NOTHING;
            
            RAISE NOTICE 'Created profile for user %', user_record.email;
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Failed to create profile for user %: %', user_record.email, SQLERRM;
        END;
    END LOOP;
END $$;

-- Ensure the trigger function has the right permissions
ALTER FUNCTION public.handle_new_user() SECURITY DEFINER;

-- Ensure RLS is properly configured
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Drop and recreate policies to ensure they're correct
DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;

-- Profiles policies
CREATE POLICY "Users can view their own profile" ON public.profiles
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile" ON public.profiles
    FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile" ON public.profiles
    FOR INSERT WITH CHECK (auth.uid() = id);

-- Allow service role to bypass RLS for the trigger function
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;

-- Grant service role access to bypass RLS
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chats TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_participants TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO service_role;

-- Ensure the authenticated role can create chats
DROP POLICY IF EXISTS "Users can create chats" ON public.chats;
CREATE POLICY "Users can create chats" ON public.chats
    FOR INSERT WITH CHECK (auth.uid() = owner_id);

-- Ensure the authenticated role can join chats
DROP POLICY IF EXISTS "Users can join chats" ON public.chat_participants;
CREATE POLICY "Users can join chats" ON public.chat_participants
    FOR INSERT WITH CHECK (auth.uid() = user_id);
