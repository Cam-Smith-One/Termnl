-- Enable Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can view their own profile" ON public.profiles
    FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile" ON public.profiles
    FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile" ON public.profiles
    FOR INSERT WITH CHECK (auth.uid() = id);

-- Chats policies
CREATE POLICY "Users can view chats they participate in" ON public.chats
    FOR SELECT USING (
        auth.uid() = owner_id OR 
        auth.uid() IN (
            SELECT user_id FROM public.chat_participants 
            WHERE chat_id = public.chats.id
        )
    );

CREATE POLICY "Users can create chats" ON public.chats
    FOR INSERT WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Chat owners can update their chats" ON public.chats
    FOR UPDATE USING (auth.uid() = owner_id);

CREATE POLICY "Chat owners can delete their chats" ON public.chats
    FOR DELETE USING (auth.uid() = owner_id);

-- Chat participants policies
CREATE POLICY "Users can view participants of chats they're in" ON public.chat_participants
    FOR SELECT USING (
        auth.uid() = user_id OR
        auth.uid() IN (
            SELECT user_id FROM public.chat_participants cp2 
            WHERE cp2.chat_id = public.chat_participants.chat_id
        )
    );

CREATE POLICY "Users can join chats" ON public.chat_participants
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can leave chats" ON public.chat_participants
    FOR DELETE USING (auth.uid() = user_id);

-- Messages policies
CREATE POLICY "Users can view messages in chats they participate in" ON public.messages
    FOR SELECT USING (
        auth.uid() IN (
            SELECT user_id FROM public.chat_participants 
            WHERE chat_id = public.messages.chat_id
        ) OR
        auth.uid() IN (
            SELECT owner_id FROM public.chats 
            WHERE id = public.messages.chat_id
        )
    );

CREATE POLICY "Users can send messages to chats they participate in" ON public.messages
    FOR INSERT WITH CHECK (
        auth.uid() = user_id AND
        (auth.uid() IN (
            SELECT user_id FROM public.chat_participants 
            WHERE chat_id = public.messages.chat_id
        ) OR
        auth.uid() IN (
            SELECT owner_id FROM public.chats 
            WHERE id = public.messages.chat_id
        ))
    );
