-- Intros context profiles
CREATE TABLE IF NOT EXISTS intro_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  opted_in BOOLEAN NOT NULL DEFAULT true,
  intro_frequency TEXT NOT NULL DEFAULT 'weekly' CHECK (intro_frequency IN ('daily', 'weekly', 'monthly', 'on_demand')),
  trust_radius TEXT NOT NULL DEFAULT 'open' CHECK (trust_radius IN ('contacts_only', 'friends_of_friends', 'open')),
  preferred_method TEXT NOT NULL DEFAULT 'agent_chat' CHECK (preferred_method IN ('agent_chat', 'email', 'text')),
  blocklist TEXT[] DEFAULT '{}',
  bio TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

-- What users are working on
CREATE TABLE IF NOT EXISTS intro_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES intro_profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  stage TEXT CHECK (stage IN ('idea', 'building', 'launched', 'scaling', 'completed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- What users need
CREATE TABLE IF NOT EXISTS intro_needs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES intro_profiles(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  category TEXT,
  urgency TEXT NOT NULL DEFAULT 'medium' CHECK (urgency IN ('low', 'medium', 'high')),
  fulfilled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- What users can offer
CREATE TABLE IF NOT EXISTS intro_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES intro_profiles(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  category TEXT,
  confidence REAL NOT NULL DEFAULT 0.8,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Expertise and interests (extracted from conversations + shout data)
CREATE TABLE IF NOT EXISTS intro_expertise (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES intro_profiles(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('expertise', 'interest', 'industry')),
  source TEXT DEFAULT 'manual' CHECK (source IN ('manual', 'conversation', 'shout', 'inferred')),
  confidence REAL NOT NULL DEFAULT 0.8,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Match suggestions (before consent)
CREATE TABLE IF NOT EXISTS intro_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a_id UUID NOT NULL REFERENCES profiles(id),
  user_b_id UUID NOT NULL REFERENCES profiles(id),
  match_reason TEXT NOT NULL,
  match_score REAL,
  source TEXT NOT NULL DEFAULT 'on_demand' CHECK (source IN ('on_demand', 'automated', 'manual')),
  status TEXT NOT NULL DEFAULT 'pending_a' CHECK (status IN (
    'pending_a',
    'pending_b',
    'approved',
    'declined_a',
    'declined_b',
    'expired',
    'completed'
  )),
  user_a_responded_at TIMESTAMPTZ,
  user_b_responded_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ DEFAULT (now() + interval '7 days'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT different_users CHECK (user_a_id != user_b_id)
);

-- Completed intros with outcome tracking
CREATE TABLE IF NOT EXISTS intro_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES intro_matches(id),
  user_a_id UUID NOT NULL REFERENCES profiles(id),
  user_b_id UUID NOT NULL REFERENCES profiles(id),
  intro_method TEXT NOT NULL,
  intro_message TEXT,
  outcome TEXT CHECK (outcome IN ('great', 'good', 'neutral', 'not_helpful')),
  outcome_notes TEXT,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Consent audit log — every action logged
CREATE TABLE IF NOT EXISTS intro_consent_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES intro_matches(id),
  user_id UUID NOT NULL REFERENCES profiles(id),
  action TEXT NOT NULL CHECK (action IN ('suggested', 'viewed', 'approved', 'declined', 'deferred', 'expired', 'intro_sent')),
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_intro_profiles_user ON intro_profiles(user_id);
CREATE INDEX idx_intro_profiles_opted_in ON intro_profiles(user_id) WHERE opted_in = true;
CREATE INDEX idx_intro_needs_profile ON intro_needs(profile_id) WHERE fulfilled = false;
CREATE INDEX idx_intro_offers_profile ON intro_offers(profile_id);
CREATE INDEX idx_intro_matches_user_a ON intro_matches(user_a_id, status);
CREATE INDEX idx_intro_matches_user_b ON intro_matches(user_b_id, status);
CREATE INDEX idx_intro_matches_pending ON intro_matches(status) WHERE status IN ('pending_a', 'pending_b');
CREATE INDEX idx_intro_expertise_profile ON intro_expertise(profile_id);
CREATE INDEX idx_intro_consent_match ON intro_consent_log(match_id);
