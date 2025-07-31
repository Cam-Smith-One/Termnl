-- This script helps diagnose email verification issues

-- Check if there are any pending email confirmations
SELECT 
    id,
    email,
    email_confirmed_at,
    confirmation_sent_at,
    created_at,
    raw_user_meta_data
FROM auth.users 
WHERE email_confirmed_at IS NULL
ORDER BY created_at DESC
LIMIT 10;

-- Check if profiles are being created for unconfirmed users
SELECT 
    u.id,
    u.email,
    u.email_confirmed_at,
    p.username,
    p.created_at as profile_created
FROM auth.users u
LEFT JOIN public.profiles p ON u.id = p.id
WHERE u.email_confirmed_at IS NULL
ORDER BY u.created_at DESC
LIMIT 10;

-- Ensure the trigger function is working properly
SELECT 
    trigger_name,
    event_manipulation,
    action_statement
FROM information_schema.triggers 
WHERE trigger_name = 'on_auth_user_created';

-- Check if there are any auth configuration issues
SELECT 'Email verification diagnostics complete' as status;
