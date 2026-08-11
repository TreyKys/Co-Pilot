-- 0001_init_omnichannel_schema.sql

-- 1. Create Enums
CREATE TYPE job_status AS ENUM ('pending', 'processing', 'completed', 'failed');

-- 2. Create Tables

-- users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    credit_balance INTEGER NOT NULL DEFAULT 50,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- user_channels table (Omnichannel Identity Mapping)
CREATE TABLE user_channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL,
    provider_chat_id TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_user_channel UNIQUE (provider, provider_chat_id)
);

-- user_credentials table
CREATE TABLE user_credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    encrypted_session_data TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- job_queue table
CREATE TABLE job_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_channel_id UUID REFERENCES user_channels(id) ON DELETE SET NULL,
    status job_status NOT NULL DEFAULT 'pending',
    action_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    result JSONB,
    scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE
);

-- token_ledger table
CREATE TABLE token_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL,
    description TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- 3. Indexes
-- Index for optimizing queue polling
CREATE INDEX idx_job_queue_status_scheduled_at ON job_queue (status, scheduled_at);

-- 4. Enable Row Level Security (RLS)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE token_ledger ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies

-- users policies
CREATE POLICY "Users can view own data"
ON users FOR SELECT
TO authenticated
USING (id = auth.uid());

CREATE POLICY "Service role has full access to users"
ON users FOR ALL
TO service_role
USING (true) WITH CHECK (true);

-- user_channels policies
CREATE POLICY "Users can view own channels"
ON user_channels FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Service role has full access to user_channels"
ON user_channels FOR ALL
TO service_role
USING (true) WITH CHECK (true);

-- user_credentials policies
CREATE POLICY "Users can view own credentials"
ON user_credentials FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Users can insert own credentials"
ON user_credentials FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own credentials"
ON user_credentials FOR UPDATE
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Service role has full access to user_credentials"
ON user_credentials FOR ALL
TO service_role
USING (true) WITH CHECK (true);

-- job_queue policies
CREATE POLICY "Users can view own jobs"
ON job_queue FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Service role has full access to job_queue"
ON job_queue FOR ALL
TO service_role
USING (true) WITH CHECK (true);

-- token_ledger policies
CREATE POLICY "Users can view own ledger entries"
ON token_ledger FOR SELECT
TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Service role has full access to token_ledger"
ON token_ledger FOR ALL
TO service_role
USING (true) WITH CHECK (true);
