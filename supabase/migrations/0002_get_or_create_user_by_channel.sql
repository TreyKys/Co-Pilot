-- 0002_get_or_create_user_by_channel.sql

CREATE OR REPLACE FUNCTION get_or_create_user_by_channel(
    p_provider TEXT,
    p_provider_chat_id TEXT
) RETURNS TABLE (
    user_id UUID,
    user_channel_id UUID
) AS $$
DECLARE
    v_user_id UUID;
    v_user_channel_id UUID;
BEGIN
    -- Try to find existing channel
    SELECT id, user_channels.user_id
    INTO v_user_channel_id, v_user_id
    FROM user_channels
    WHERE provider = p_provider AND provider_chat_id = p_provider_chat_id;

    -- If not found, create new user and channel within the same transaction
    IF v_user_channel_id IS NULL THEN
        -- Insert new user
        INSERT INTO users (credit_balance)
        VALUES (50)
        RETURNING id INTO v_user_id;

        -- Insert new user_channel
        INSERT INTO user_channels (user_id, provider, provider_chat_id)
        VALUES (v_user_id, p_provider, p_provider_chat_id)
        RETURNING id INTO v_user_channel_id;
    END IF;

    -- Return the record
    RETURN QUERY SELECT v_user_id, v_user_channel_id;
END;
$$ LANGUAGE plpgsql;
