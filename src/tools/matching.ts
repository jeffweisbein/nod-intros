import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerMatchingTools(server: McpServer) {
  // intros_search
  server.tool(
    "intros_search",
    "search opted-in profiles by need, offer, expertise, or project. returns matching profiles with reasons. does not create a match — use intros_suggest for that.",
    {
      user_id: z.string().uuid().describe("the searching user's id (for blocklist filtering)"),
      query: z.string().describe("search text to match against needs, offers, expertise, and projects"),
      category: z.string().optional().describe("filter by category"),
      limit: z.number().optional().describe("max results (default 10)"),
    },
    async ({ user_id, query, category, limit }) => {
      const maxResults = limit || 10;
      const searchPattern = `%${query}%`;

      // get the searcher's blocklist
      const { data: myProfile } = await supabase
        .from("intro_profiles")
        .select("id, blocklist")
        .eq("user_id", user_id)
        .single();

      const blocklist = myProfile?.blocklist || [];

      // get all opted-in profiles (excluding self and blocked users)
      const { data: profiles } = await supabase
        .from("intro_profiles")
        .select("id, user_id, bio")
        .eq("opted_in", true)
        .neq("user_id", user_id);

      if (!profiles || profiles.length === 0) {
        return { content: [{ type: "text" as const, text: "no opted-in profiles found." }] };
      }

      // filter out blocked users
      const eligible = profiles.filter(
        (p: any) => !blocklist.includes(p.user_id)
      );

      if (eligible.length === 0) {
        return { content: [{ type: "text" as const, text: "no eligible profiles found." }] };
      }

      const profileIds = eligible.map((p: any) => p.id);

      // search across all context tables in parallel
      const [needsRes, offersRes, expertiseRes, projectsRes] = await Promise.all([
        supabase
          .from("intro_needs")
          .select("profile_id, description, category")
          .in("profile_id", profileIds)
          .eq("fulfilled", false)
          .ilike("description", searchPattern),
        supabase
          .from("intro_offers")
          .select("profile_id, description, category")
          .in("profile_id", profileIds)
          .ilike("description", searchPattern),
        supabase
          .from("intro_expertise")
          .select("profile_id, label, type")
          .in("profile_id", profileIds)
          .ilike("label", searchPattern),
        supabase
          .from("intro_projects")
          .select("profile_id, name, description, stage")
          .in("profile_id", profileIds)
          .or(`name.ilike.${searchPattern},description.ilike.${searchPattern}`),
      ]);

      // also filter by category if provided
      const categoryFilter = (items: any[], catField: string = "category") => {
        if (!category) return items;
        return items.filter((i: any) => i[catField]?.toLowerCase() === category.toLowerCase());
      };

      // score profiles by match count
      const scores = new Map<string, { score: number; reasons: string[] }>();

      const addMatch = (profileId: string, reason: string) => {
        if (!scores.has(profileId)) {
          scores.set(profileId, { score: 0, reasons: [] });
        }
        const entry = scores.get(profileId)!;
        entry.score += 1;
        entry.reasons.push(reason);
      };

      for (const n of categoryFilter(needsRes.data || [])) {
        addMatch(n.profile_id, `needs: ${n.description}`);
      }
      for (const o of categoryFilter(offersRes.data || [])) {
        addMatch(o.profile_id, `offers: ${o.description}`);
      }
      for (const e of (expertiseRes.data || [])) {
        addMatch(e.profile_id, `${e.type}: ${e.label}`);
      }
      for (const p of (projectsRes.data || [])) {
        addMatch(p.profile_id, `project: ${p.name}${p.stage ? ` (${p.stage})` : ""}`);
      }

      if (scores.size === 0) {
        return { content: [{ type: "text" as const, text: `no profiles match "${query}".` }] };
      }

      // sort by score descending, take top N
      const sorted = [...scores.entries()]
        .sort((a, b) => b[1].score - a[1].score)
        .slice(0, maxResults);

      // resolve user_ids for results
      const profileMap = new Map(eligible.map((p: any) => [p.id, p]));

      // get display names
      const resultUserIds = sorted
        .map(([pid]) => profileMap.get(pid)?.user_id)
        .filter(Boolean);

      const { data: users } = await supabase
        .from("profiles")
        .select("id, username, display_name")
        .in("id", resultUserIds);

      const userMap = new Map((users || []).map((u: any) => [u.id, u]));

      const lines = sorted.map(([profileId, info], i) => {
        const profile = profileMap.get(profileId);
        const user = userMap.get(profile?.user_id);
        const name = user?.display_name || user?.username || profile?.user_id;
        return `${i + 1}. ${name} (user_id: ${profile?.user_id})\n   matches: ${info.score}\n   ${info.reasons.join("\n   ")}`;
      });

      return {
        content: [{
          type: "text" as const,
          text: `found ${sorted.length} matching profile${sorted.length !== 1 ? "s" : ""} for "${query}":\n\n${lines.join("\n\n")}\n\nuse intros_suggest to propose an intro.`,
        }],
      };
    }
  );

  // intros_suggest
  server.tool(
    "intros_suggest",
    "suggest an intro between you and another user. creates a match in pending_a status and logs to consent audit.",
    {
      user_id: z.string().uuid().describe("the suggesting user's id (user A)"),
      target_user_id: z.string().uuid().describe("the target user's id (user B)"),
      reason: z.string().describe("why this intro makes sense"),
    },
    async ({ user_id, target_user_id, reason }) => {
      if (user_id === target_user_id) {
        return { content: [{ type: "text" as const, text: "can't suggest an intro with yourself." }] };
      }

      // check both users are opted in
      const { data: profiles } = await supabase
        .from("intro_profiles")
        .select("user_id, opted_in, blocklist")
        .in("user_id", [user_id, target_user_id]);

      if (!profiles || profiles.length < 2) {
        return { content: [{ type: "text" as const, text: "both users must have intro profiles to create a match." }] };
      }

      const userA = profiles.find((p: any) => p.user_id === user_id);
      const userB = profiles.find((p: any) => p.user_id === target_user_id);

      if (!userA?.opted_in) {
        return { content: [{ type: "text" as const, text: "you must be opted in to suggest intros." }] };
      }
      if (!userB?.opted_in) {
        return { content: [{ type: "text" as const, text: "target user is not opted in to intros." }] };
      }

      // check blocklists both ways
      if (userA.blocklist?.includes(target_user_id)) {
        return { content: [{ type: "text" as const, text: "target user is on your blocklist." }] };
      }
      if (userB.blocklist?.includes(user_id)) {
        // don't reveal they blocked you — just say not available
        return { content: [{ type: "text" as const, text: "target user is not available for intros right now." }] };
      }

      // check for existing pending match between these users
      const { data: existing } = await supabase
        .from("intro_matches")
        .select("id, status")
        .or(
          `and(user_a_id.eq.${user_id},user_b_id.eq.${target_user_id}),and(user_a_id.eq.${target_user_id},user_b_id.eq.${user_id})`
        )
        .in("status", ["pending_a", "pending_b"]);

      if (existing && existing.length > 0) {
        return { content: [{ type: "text" as const, text: "there's already a pending match between you and this user." }] };
      }

      // create the match
      const { data: match, error } = await supabase
        .from("intro_matches")
        .insert({
          user_a_id: user_id,
          user_b_id: target_user_id,
          match_reason: reason,
          source: "on_demand",
          status: "pending_a",
        })
        .select()
        .single();

      if (error) {
        return { content: [{ type: "text" as const, text: `error creating match: ${error.message}` }] };
      }

      // log to consent audit
      await supabase.from("intro_consent_log").insert({
        match_id: (match as any).id,
        user_id: user_id,
        action: "suggested",
        metadata: { reason },
      });

      return {
        content: [{
          type: "text" as const,
          text: `match suggested. id: ${(match as any).id}\nstatus: pending_a (waiting for your approval)\nuse intros_respond to approve or decline.`,
        }],
      };
    }
  );
}
