-- Create a function to get chats a user can access
-- This avoids RLS recursion issues by using SECURITY DEFINER
CREATE OR REPLACE FUNCTION get_user_chats(input_user_id uuid)
RETURNS TABLE (
    id uuid,
    name text,
    owner_id uuid,
    invite_code text,
    invite_url text,
    encryption_key text,
    created_at timestamptz,
    updated_at timestamptz,
    is_owner boolean,
    participants_count bigint
) 
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    WITH user_chats AS (
        -- Get owned chats
        SELECT 
            c.*,
            true as is_owner
        FROM chats c
        WHERE c.owner_id = input_user_id
        
        UNION
        
        -- Get participated chats
        SELECT 
            c.*,
            false as is_owner
        FROM chats c
        INNER JOIN chat_participants cp ON c.id = cp.chat_id
        WHERE cp.user_id = input_user_id
    ),
    chat_counts AS (
        SELECT 
            c.id as chat_id,
            COUNT(cp.user_id) + 1 as participant_count -- +1 for owner
        FROM chats c
        LEFT JOIN chat_participants cp ON c.id = cp.chat_id
        WHERE c.owner_id = input_user_id 
           OR c.id IN (
               SELECT chat_id FROM chat_participants WHERE user_id = input_user_id
           )
        GROUP BY c.id
    )
    SELECT 
        uc.id,
        uc.name,
        uc.owner_id,
        uc.invite_code,
        uc.invite_url,
        uc.encryption_key,
        uc.created_at,
        uc.updated_at,
        uc.is_owner,
        COALESCE(cc.participant_count, 1) as participants_count
    FROM user_chats uc
    LEFT JOIN chat_counts cc ON uc.id = cc.chat_id
    ORDER BY uc.created_at DESC;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_user_chats(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_chats(uuid) TO service_role;

-- Create a function to get chat messages for a user
CREATE OR REPLACE FUNCTION get_chat_messages(input_chat_id uuid, input_user_id uuid)
RETURNS TABLE (
    id uuid,
    chat_id uuid,
    user_id uuid,
    content text,
    message_type text,
    created_at timestamptz,
    username text
)
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
    -- Check if user has access to this chat
    IF NOT EXISTS (
        SELECT 1 FROM chats c WHERE c.id = input_chat_id AND c.owner_id = input_user_id
        UNION
        SELECT 1 FROM chat_participants cp WHERE cp.chat_id = input_chat_id AND cp.user_id = input_user_id
    ) THEN
        RAISE EXCEPTION 'Access denied to chat';
    END IF;

    RETURN QUERY
    SELECT 
        m.id,
        m.chat_id,
        m.user_id,
        m.content,
        m.message_type,
        m.created_at,
        p.username
    FROM messages m
    INNER JOIN profiles p ON m.user_id = p.id
    WHERE m.chat_id = input_chat_id
    ORDER BY m.created_at ASC;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_chat_messages(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_chat_messages(uuid, uuid) TO service_role;
