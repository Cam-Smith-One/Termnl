-- Drop and recreate all functions with proper security checks
DROP FUNCTION IF EXISTS get_user_chats(uuid);
DROP FUNCTION IF EXISTS get_chat_messages(uuid, uuid);
DROP FUNCTION IF EXISTS send_message(uuid, uuid, text, text);
DROP FUNCTION IF EXISTS join_chat_by_code(text, uuid);

-- Function to get chats a user can access
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
            c.id,
            c.name,
            c.owner_id,
            c.invite_code,
            c.invite_url,
            c.encryption_key,
            c.created_at,
            c.updated_at,
            true as is_owner
        FROM chats c
        WHERE c.owner_id = input_user_id
        
        UNION
        
        -- Get participated chats
        SELECT 
            c.id,
            c.name,
            c.owner_id,
            c.invite_code,
            c.invite_url,
            c.encryption_key,
            c.created_at,
            c.updated_at,
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

-- Function to get chat messages for a user
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

-- Function to send a message (with access control)
CREATE OR REPLACE FUNCTION send_message(
    input_chat_id uuid,
    input_user_id uuid,
    input_content text,
    input_message_type text DEFAULT 'text'
)
RETURNS uuid
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
    message_id uuid;
BEGIN
    -- Check if user has access to this chat
    IF NOT EXISTS (
        SELECT 1 FROM chats c WHERE c.id = input_chat_id AND c.owner_id = input_user_id
        UNION
        SELECT 1 FROM chat_participants cp WHERE cp.chat_id = input_chat_id AND cp.user_id = input_user_id
    ) THEN
        RAISE EXCEPTION 'Access denied to chat';
    END IF;

    -- Insert the message
    INSERT INTO messages (chat_id, user_id, content, message_type)
    VALUES (input_chat_id, input_user_id, input_content, input_message_type)
    RETURNING id INTO message_id;

    RETURN message_id;
END;
$$;

-- Function to join a chat by code
CREATE OR REPLACE FUNCTION join_chat_by_code(
    input_invite_code text,
    input_user_id uuid
)
RETURNS uuid
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
DECLARE
    chat_id uuid;
BEGIN
    -- Find the chat by invite code
    SELECT id INTO chat_id
    FROM chats
    WHERE invite_code = input_invite_code;

    IF chat_id IS NULL THEN
        RAISE EXCEPTION 'Invalid invite code';
    END IF;

    -- Check if user is already a participant or owner
    IF EXISTS (
        SELECT 1 FROM chats WHERE id = chat_id AND owner_id = input_user_id
        UNION
        SELECT 1 FROM chat_participants WHERE chat_id = chat_id AND user_id = input_user_id
    ) THEN
        RAISE EXCEPTION 'User already in chat';
    END IF;

    -- Add user as participant
    INSERT INTO chat_participants (chat_id, user_id)
    VALUES (chat_id, input_user_id);

    RETURN chat_id;
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION get_user_chats(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_chats(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION get_chat_messages(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION get_chat_messages(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION send_message(uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION send_message(uuid, uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION join_chat_by_code(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION join_chat_by_code(text, uuid) TO service_role;

SELECT 'All functions created successfully' as status;
