-- ============================================================================
-- Migration: nod intros — agent-brokered warm introductions
-- ============================================================================

-- clean slate (safe for fresh deploy)
DROP TABLE IF EXISTS intro_consent_log CASCADE;
DROP TABLE IF EXISTS intros CASCADE;
DROP TABLE IF EXISTS intro_matches CASCADE;
DROP TABLE IF EXISTS intro_profiles CASCADE;

-- context profiles: what users are working on, need, and can offer
CREATE TABLE IF NOT EXISTS intro_profiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,  -- matches profiles.user_id from shout
  opted_in BOOLEAN DEFAULT false,
  
  -- structured context (auto-extracted + manually set)
  current_projects JSONB DEFAULT '[]',   -- [{name, description, stage, updated_at}]
  needs JSONB DEFAULT '[]',              -- [{description, urgency, category, created_at}]
  offers JSONB DEFAULT '[]',             -- [{description, category, confidence}]
  interests TEXT[] DEFAULT '{}',
  expertise TEXT[] DEFAULT '{}',
  industries TEXT[] DEFAULT '{}',
  
  -- preferences
  intro_frequency TEXT DEFAULT 'weekly' CHECK (intro_frequency IN ('daily', 'weekly', 'monthly', 'on_demand')),
  trust_radius TEXT DEFAULT 'open' CHECK (trust_radius IN ('contacts_only', 'friends_of_friends', 'open')),
  blocklist TEXT[] DEFAULT '{}',
  preferred_intro_method TEXT DEFAULT 'agent_chat' CHECK (preferred_intro_method IN ('agent_chat', 'email', 'text')),
  
  -- state
  paused BOOLEAN DEFAULT false,
  last_match_check TIMESTAMPTZ,
  last_profile_update TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- matches: potential intros detected by the match engine
CREATE TABLE IF NOT EXISTS intro_matches (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_a_id TEXT NOT NULL,  -- first user
  user_b_id TEXT NOT NULL,  -- second user
  
  -- match details
  score FLOAT NOT NULL,
  match_reason TEXT NOT NULL,         -- human-readable explanation
  match_details JSONB DEFAULT '{}',   -- {need_offer_score, interest_score, etc}
  
  -- consent state
  user_a_status TEXT DEFAULT 'pending' CHECK (user_a_status IN ('pending', 'approved', 'declined', 'deferred', 'expired')),
  user_b_status TEXT DEFAULT 'pending' CHECK (user_b_status IN ('pending', 'approved', 'declined', 'deferred', 'expired')),
  user_a_responded_at TIMESTAMPTZ,
  user_b_responded_at TIMESTAMPTZ,
  
  -- what each user sees (sanitized — no raw profile data)
  user_a_pitch TEXT,  -- what user A sees about user B
  user_b_pitch TEXT,  -- what user B sees about user A
  
  -- lifecycle
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'matched', 'completed', 'expired', 'declined')),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '7 days'),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- prevent duplicate matches
  UNIQUE(user_a_id, user_b_id)
);

-- completed intros: record of successful connections
CREATE TABLE IF NOT EXISTS intros (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  match_id UUID REFERENCES intro_matches(id) ON DELETE SET NULL,
  user_a_id TEXT NOT NULL,
  user_b_id TEXT NOT NULL,
  
  -- intro context shared with both parties
  shared_context TEXT,
  intro_method TEXT NOT NULL,  -- how they were connected
  
  -- outcome tracking
  outcome TEXT CHECK (outcome IN ('connected', 'no_response', 'positive', 'neutral', 'negative')),
  user_a_feedback TEXT,
  user_b_feedback TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- consent log: audit trail for all consent-related actions
CREATE TABLE IF NOT EXISTS intro_consent_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,  -- 'opt_in', 'opt_out', 'approve_match', 'decline_match', 'defer_match', 'pause', 'unpause', 'forget'
  target_match_id UUID REFERENCES intro_matches(id) ON DELETE SET NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- indexes
CREATE INDEX IF NOT EXISTS idx_intro_profiles_user ON intro_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_intro_profiles_opted_in ON intro_profiles(opted_in) WHERE opted_in IS TRUE AND paused IS NOT TRUE;
CREATE INDEX IF NOT EXISTS idx_intro_matches_users ON intro_matches(user_a_id, user_b_id);
CREATE INDEX IF NOT EXISTS idx_intro_matches_status ON intro_matches(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_intros_users ON intros(user_a_id, user_b_id);
CREATE INDEX IF NOT EXISTS idx_consent_log_user ON intro_consent_log(user_id);

-- RLS
ALTER TABLE intro_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE intro_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE intros ENABLE ROW LEVEL SECURITY;
ALTER TABLE intro_consent_log ENABLE ROW LEVEL SECURITY;

-- service role access (MCP server uses service key)
CREATE POLICY "Service role full access" ON intro_profiles FOR ALL USING (true);
CREATE POLICY "Service role full access" ON intro_matches FOR ALL USING (true);
CREATE POLICY "Service role full access" ON intros FOR ALL USING (true);
CREATE POLICY "Service role full access" ON intro_consent_log FOR ALL USING (true);
