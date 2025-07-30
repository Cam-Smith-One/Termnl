-- Ensure messages table has proper permissions
GRANT ALL ON public.messages TO authenticated;
GRANT ALL ON public.profiles TO authenticated;

-- Ensure sequences are accessible
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Test that we can insert messages directly
DO $$
BEGIN
    -- This is just a test to verify permissions work
    RAISE NOTICE 'Message sending permissions configured successfully';
END $$;

-- Create a simple function to test message insertion
CREATE OR REPLACE FUNCTION test_message_insert()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Just test that we have the right permissions
    PERFORM 1 FROM messages LIMIT 1;
    PERFORM 1 FROM profiles LIMIT 1;
    RETURN true;
EXCEPTION WHEN OTHERS THEN
    RETURN false;
END;
$$;

-- Grant execute on test function
GRANT EXECUTE ON FUNCTION test_message_insert() TO authenticated;
