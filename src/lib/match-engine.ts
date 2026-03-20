/**
 * nod intros match engine
 * 
 * scores pairs of opted-in users based on:
 * - need/offer alignment (40%) — does user A need what user B offers?
 * - interest/expertise overlap (20%) — shared topics
 * - industry overlap (20%) — same industries
 * - recency (10%) — both recently active
 * - history (10%) — haven't been matched before / past success
 * 
 * runs as a callable function (triggered by cron or on profile update)
 */

import { supabase } from "./supabase.js";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

interface IntroProfile {
  id: string;
  user_id: string;
  current_projects: any[];
  needs: any[];
  offers: any[];
  interests: string[];
  expertise: string[];
  industries: string[];
  intro_frequency: string;
  trust_radius: string;
  blocklist: string[];
  last_match_check: string | null;
  last_profile_update: string | null;
}

interface MatchCandidate {
  userA: IntroProfile;
  userB: IntroProfile;
  score: number;
  reason: string;
  details: {
    needOfferScore: number;
    interestScore: number;
    industryScore: number;
    recencyScore: number;
    historyScore: number;
  };
  pitchForA: string;
  pitchForB: string;
}

// compute jaccard similarity between two string arrays (case-insensitive)
function jaccardSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const setA = new Set(a.map(s => s.toLowerCase().trim()));
  const setB = new Set(b.map(s => s.toLowerCase().trim()));
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

// score need/offer alignment between two users using keyword overlap
function scoreNeedOfferAlignment(a: IntroProfile, b: IntroProfile): number {
  let score = 0;
  let comparisons = 0;

  // check if A's needs match B's offers
  for (const need of a.needs) {
    const needWords = new Set((need.description || "").toLowerCase().split(/\s+/).filter((w: string) => w.length > 3));
    for (const offer of b.offers) {
      const offerWords = new Set((offer.description || "").toLowerCase().split(/\s+/).filter((w: string) => w.length > 3));
      const overlap = [...needWords].filter(w => offerWords.has(w)).length;
      const total = new Set([...needWords, ...offerWords]).size;
      if (total > 0) {
        score += overlap / total;
        comparisons++;
      }
    }
  }

  // check if B's needs match A's offers
  for (const need of b.needs) {
    const needWords = new Set((need.description || "").toLowerCase().split(/\s+/).filter((w: string) => w.length > 3));
    for (const offer of a.offers) {
      const offerWords = new Set((offer.description || "").toLowerCase().split(/\s+/).filter((w: string) => w.length > 3));
      const overlap = [...needWords].filter(w => offerWords.has(w)).length;
      const total = new Set([...needWords, ...offerWords]).size;
      if (total > 0) {
        score += overlap / total;
        comparisons++;
      }
    }
  }

  // also check project descriptions against offers
  for (const proj of a.current_projects) {
    const projWords = new Set((proj.description || "").toLowerCase().split(/\s+/).filter((w: string) => w.length > 3));
    for (const offer of b.offers) {
      const offerWords = new Set((offer.description || "").toLowerCase().split(/\s+/).filter((w: string) => w.length > 3));
      const overlap = [...projWords].filter(w => offerWords.has(w)).length;
      const total = new Set([...projWords, ...offerWords]).size;
      if (total > 0) {
        score += overlap / total * 0.5; // lower weight for project-offer
        comparisons++;
      }
    }
  }

  return comparisons === 0 ? 0 : Math.min(score / comparisons, 1);
}

// score recency — both users recently updated their profiles
function scoreRecency(a: IntroProfile, b: IntroProfile): number {
  const now = Date.now();
  const aAge = a.last_profile_update ? (now - new Date(a.last_profile_update).getTime()) / (1000 * 60 * 60 * 24) : 999;
  const bAge = b.last_profile_update ? (now - new Date(b.last_profile_update).getTime()) / (1000 * 60 * 60 * 24) : 999;

  // score higher if both updated recently (within 7 days = 1.0, 30 days = 0.5, older = 0.1)
  const aScore = aAge < 7 ? 1.0 : aAge < 30 ? 0.5 : 0.1;
  const bScore = bAge < 7 ? 1.0 : bAge < 30 ? 0.5 : 0.1;
  return (aScore + bScore) / 2;
}

// compute full match score between two profiles
function computeMatchScore(a: IntroProfile, b: IntroProfile): {
  score: number;
  details: MatchCandidate["details"];
} {
  const needOfferScore = scoreNeedOfferAlignment(a, b);
  const interestScore = jaccardSimilarity(
    [...(a.interests || []), ...(a.expertise || [])],
    [...(b.interests || []), ...(b.expertise || [])]
  );
  const industryScore = jaccardSimilarity(a.industries || [], b.industries || []);
  const recencyScore = scoreRecency(a, b);
  const historyScore = 1.0; // default — reduced later if they've been matched before

  const score =
    needOfferScore * 0.4 +
    interestScore * 0.2 +
    industryScore * 0.2 +
    recencyScore * 0.1 +
    historyScore * 0.1;

  return {
    score,
    details: { needOfferScore, interestScore, industryScore, recencyScore, historyScore },
  };
}

// generate a reason string explaining why two users match
function generateMatchReason(a: IntroProfile, b: IntroProfile, details: MatchCandidate["details"]): string {
  const parts: string[] = [];

  if (details.needOfferScore > 0.3) {
    // find the best need/offer alignment
    const aNeeds = (a.needs || []).map((n: any) => n.description).join(", ");
    const bOffers = (b.offers || []).map((o: any) => o.description).join(", ");
    const bNeeds = (b.needs || []).map((n: any) => n.description).join(", ");
    const aOffers = (a.offers || []).map((o: any) => o.description).join(", ");

    if (aNeeds && bOffers) parts.push(`${a.user_id} needs help with ${aNeeds.substring(0, 80)} and ${b.user_id} offers ${bOffers.substring(0, 80)}`);
    if (bNeeds && aOffers) parts.push(`${b.user_id} needs ${bNeeds.substring(0, 80)} and ${a.user_id} offers ${aOffers.substring(0, 80)}`);
  }

  const sharedInterests = (a.interests || []).filter((i: string) =>
    (b.interests || []).some((j: string) => j.toLowerCase() === i.toLowerCase())
  );
  if (sharedInterests.length > 0) {
    parts.push(`both interested in ${sharedInterests.slice(0, 3).join(", ")}`);
  }

  const sharedIndustries = (a.industries || []).filter((i: string) =>
    (b.industries || []).some((j: string) => j.toLowerCase() === i.toLowerCase())
  );
  if (sharedIndustries.length > 0) {
    parts.push(`both in ${sharedIndustries.slice(0, 2).join(" and ")}`);
  }

  return parts.length > 0 ? parts.join(". ") : "potential synergy based on profiles";
}

// generate the pitch each user sees about the other (sanitized — no raw profile data)
function generatePitch(viewer: IntroProfile, subject: IntroProfile, reason: string): string {
  const projects = (subject.current_projects || []).map((p: any) => p.name).filter(Boolean);
  const offers = (subject.offers || []).map((o: any) => o.description).filter(Boolean);
  const expertise = (subject.expertise || []).slice(0, 3);

  const parts: string[] = [];
  if (projects.length > 0) parts.push(`working on ${projects.slice(0, 2).join(" and ")}`);
  if (expertise.length > 0) parts.push(`skilled in ${expertise.join(", ")}`);
  if (offers.length > 0) parts.push(`can help with ${offers[0].substring(0, 60)}`);

  const intro = parts.length > 0 ? `someone in the network ${parts.join(", ")}` : "someone who might be a good match";
  return intro;
}

// use LLM to generate better pitches when available
async function generateLLMPitch(viewer: IntroProfile, subject: IntroProfile, reason: string): Promise<string> {
  if (!OPENAI_API_KEY) return generatePitch(viewer, subject, reason);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You write brief, compelling intro pitches for a professional networking tool. The pitch explains why someone should meet another person. Keep it under 2 sentences. Be specific about what makes this connection valuable. Never include names, emails, or identifying info — use vague references like "someone in the network". Don't use filler phrases like "exciting opportunity" or "perfect match".`,
          },
          {
            role: "user",
            content: `The viewer's needs: ${JSON.stringify((viewer.needs || []).map((n: any) => n.description))}
The viewer's interests: ${(viewer.interests || []).join(", ")}

The person being pitched:
- Projects: ${JSON.stringify((subject.current_projects || []).map((p: any) => ({ name: p.name, description: p.description })))}
- Offers: ${JSON.stringify((subject.offers || []).map((o: any) => o.description))}
- Expertise: ${(subject.expertise || []).join(", ")}
- Industries: ${(subject.industries || []).join(", ")}

Match reason: ${reason}

Write a 1-2 sentence pitch for the viewer about why they should meet this person.`,
          },
        ],
        temperature: 0.7,
        max_tokens: 100,
      }),
    });

    if (!response.ok) return generatePitch(viewer, subject, reason);
    const data = (await response.json()) as any;
    return data.choices?.[0]?.message?.content?.trim() || generatePitch(viewer, subject, reason);
  } catch {
    return generatePitch(viewer, subject, reason);
  }
}

/**
 * Run the match engine.
 * Finds all opted-in, non-paused profiles, scores all pairs,
 * and creates match records for scores above threshold.
 */
export async function runMatchEngine(options?: {
  minScore?: number;
  maxMatchesPerUser?: number;
  useLLMPitches?: boolean;
}): Promise<{ matchesCreated: number; profilesChecked: number; errors: string[] }> {
  const minScore = options?.minScore ?? 0.6;
  const maxPerUser = options?.maxMatchesPerUser ?? 3;
  const useLLM = options?.useLLMPitches ?? true;

  const errors: string[] = [];

  // fetch all active profiles
  const { data: profiles, error } = await supabase
    .from("intro_profiles")
    .select("*")
    .eq("opted_in", true)
    .eq("paused", false);

  if (error || !profiles) {
    return { matchesCreated: 0, profilesChecked: 0, errors: [`failed to fetch profiles: ${error?.message}`] };
  }

  if (profiles.length < 2) {
    return { matchesCreated: 0, profilesChecked: profiles.length, errors: ["need at least 2 active profiles to match"] };
  }

  // fetch existing pending/completed matches to avoid duplicates
  const { data: existingMatches } = await supabase
    .from("intro_matches")
    .select("user_a_id, user_b_id, status")
    .in("status", ["pending", "completed"]);

  const existingPairs = new Set(
    (existingMatches || []).map(m => [m.user_a_id, m.user_b_id].sort().join("::"))
  );

  // track matches per user to respect max limit
  const matchCountPerUser: Record<string, number> = {};

  // count existing pending matches per user
  for (const m of existingMatches || []) {
    if (m.status === "pending") {
      matchCountPerUser[m.user_a_id] = (matchCountPerUser[m.user_a_id] || 0) + 1;
      matchCountPerUser[m.user_b_id] = (matchCountPerUser[m.user_b_id] || 0) + 1;
    }
  }

  // score all pairs
  const candidates: MatchCandidate[] = [];

  for (let i = 0; i < profiles.length; i++) {
    for (let j = i + 1; j < profiles.length; j++) {
      const a = profiles[i] as IntroProfile;
      const b = profiles[j] as IntroProfile;

      // skip if already matched
      const pairKey = [a.user_id, b.user_id].sort().join("::");
      if (existingPairs.has(pairKey)) continue;

      // skip if either has the other on blocklist
      if ((a.blocklist || []).includes(b.user_id) || (b.blocklist || []).includes(a.user_id)) continue;

      // skip if either has too many pending matches
      if ((matchCountPerUser[a.user_id] || 0) >= maxPerUser) continue;
      if ((matchCountPerUser[b.user_id] || 0) >= maxPerUser) continue;

      const { score, details } = computeMatchScore(a, b);

      if (score >= minScore) {
        const reason = generateMatchReason(a, b, details);

        let pitchForA: string;
        let pitchForB: string;

        if (useLLM) {
          [pitchForA, pitchForB] = await Promise.all([
            generateLLMPitch(a, b, reason),
            generateLLMPitch(b, a, reason),
          ]);
        } else {
          pitchForA = generatePitch(a, b, reason);
          pitchForB = generatePitch(b, a, reason);
        }

        candidates.push({
          userA: a,
          userB: b,
          score,
          reason,
          details,
          pitchForA,
          pitchForB,
        });
      }
    }
  }

  // sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  // create matches (respecting per-user limits)
  let matchesCreated = 0;

  for (const candidate of candidates) {
    const aId = candidate.userA.user_id;
    const bId = candidate.userB.user_id;

    if ((matchCountPerUser[aId] || 0) >= maxPerUser) continue;
    if ((matchCountPerUser[bId] || 0) >= maxPerUser) continue;

    const { error: insertError } = await supabase.from("intro_matches").insert({
      user_a_id: aId,
      user_b_id: bId,
      score: candidate.score,
      match_reason: candidate.reason,
      match_details: candidate.details,
      user_a_pitch: candidate.pitchForA,
      user_b_pitch: candidate.pitchForB,
      status: "pending",
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    });

    if (insertError) {
      // unique constraint violation = already matched, skip
      if (insertError.code !== "23505") {
        errors.push(`failed to create match ${aId} <> ${bId}: ${insertError.message}`);
      }
      continue;
    }

    matchCountPerUser[aId] = (matchCountPerUser[aId] || 0) + 1;
    matchCountPerUser[bId] = (matchCountPerUser[bId] || 0) + 1;
    matchesCreated++;
  }

  // update last_match_check for all profiles
  const profileIds = profiles.map(p => p.id);
  await supabase
    .from("intro_profiles")
    .update({ last_match_check: new Date().toISOString() })
    .in("id", profileIds);

  return {
    matchesCreated,
    profilesChecked: profiles.length,
    errors,
  };
}

/**
 * Expire old matches that haven't been responded to.
 */
export async function expireStaleMatches(): Promise<number> {
  const { data, error } = await supabase
    .from("intro_matches")
    .update({ status: "expired", updated_at: new Date().toISOString() })
    .eq("status", "pending")
    .lt("expires_at", new Date().toISOString())
    .select("id");

  return data?.length || 0;
}
