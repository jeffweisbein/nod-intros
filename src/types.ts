// shared types for nod-intros mcp server

export interface IntroProfile {
  id: string;
  user_id: string;
  opted_in: boolean;
  intro_frequency: "daily" | "weekly" | "monthly" | "on_demand";
  trust_radius: "contacts_only" | "friends_of_friends" | "open";
  preferred_method: "agent_chat" | "email" | "text";
  blocklist: string[];
  bio: string | null;
  created_at: string;
  updated_at: string;
}

export interface IntroProject {
  id: string;
  profile_id: string;
  name: string;
  description: string | null;
  stage: "idea" | "building" | "launched" | "scaling" | "completed" | null;
  created_at: string;
  updated_at: string;
}

export interface IntroNeed {
  id: string;
  profile_id: string;
  description: string;
  category: string | null;
  urgency: "low" | "medium" | "high";
  fulfilled: boolean;
  created_at: string;
}

export interface IntroOffer {
  id: string;
  profile_id: string;
  description: string;
  category: string | null;
  confidence: number;
  created_at: string;
}

export interface IntroExpertise {
  id: string;
  profile_id: string;
  label: string;
  type: "expertise" | "interest" | "industry";
  source: "manual" | "conversation" | "shout" | "inferred";
  confidence: number;
  created_at: string;
}

export interface IntroMatch {
  id: string;
  user_a_id: string;
  user_b_id: string;
  match_reason: string;
  match_score: number | null;
  source: "on_demand" | "automated" | "manual";
  status:
    | "pending_a"
    | "pending_b"
    | "approved"
    | "declined_a"
    | "declined_b"
    | "expired"
    | "completed";
  user_a_responded_at: string | null;
  user_b_responded_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface IntroConnection {
  id: string;
  match_id: string;
  user_a_id: string;
  user_b_id: string;
  intro_method: string;
  intro_message: string | null;
  outcome: "great" | "good" | "neutral" | "not_helpful" | null;
  outcome_notes: string | null;
  connected_at: string;
}

export interface IntroConsentLog {
  id: string;
  match_id: string;
  user_id: string;
  action:
    | "suggested"
    | "viewed"
    | "approved"
    | "declined"
    | "deferred"
    | "expired"
    | "intro_sent";
  metadata: Record<string, unknown> | null;
  created_at: string;
}
