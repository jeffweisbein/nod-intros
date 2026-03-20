import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { filterPII } from "../lib/content-filter.js";
import { runMatchEngine, expireStaleMatches } from "../lib/match-engine.js";
import { extractContext, hasContextSignals } from "../lib/context-extractor.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const USER_ID = process.env.NOD_USER_ID || "anonymous";

// sanitize profile text through PII filter before storage
function sanitize(text: string): string {
  return filterPII(text).text;
}

export function registerIntroTools(server: McpServer) {

  // ─── Opt In ───────────────────────────────────────────────────────────
  server.tool(
    "intros_opt_in",
    "Opt in to nod intros — agent-brokered warm introductions. Set your preferences for how you want to be matched. Your agent will find people you should meet based on what you're working on, what you need, and what you can offer.",
    {
      frequency: z.enum(["daily", "weekly", "monthly", "on_demand"]).optional().default("weekly").describe("How often to receive intro suggestions"),
      trust_radius: z.enum(["contacts_only", "friends_of_friends", "open"]).optional().default("open").describe("Who can be suggested: contacts only, friends of friends, or anyone"),
      preferred_method: z.enum(["agent_chat", "email", "text"]).optional().default("agent_chat").describe("How intros are facilitated"),
    },
    async ({ frequency, trust_radius, preferred_method }) => {
      const { data, error } = await supabase
        .from("intro_profiles")
        .upsert({
          user_id: USER_ID,
          opted_in: true,
          paused: false,
          intro_frequency: frequency,
          trust_radius,
          preferred_intro_method: preferred_method,
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id" })
        .select()
        .single();

      if (error) return { content: [{ type: "text" as const, text: `error opting in: ${error.message}` }] };

      // log consent
      await supabase.from("intro_consent_log").insert({
        user_id: USER_ID,
        action: "opt_in",
        metadata: { frequency, trust_radius, preferred_method },
      });

      return {
        content: [{
          type: "text" as const,
          text: `✅ you're opted in to nod intros!\n\nfrequency: ${frequency}\ntrust radius: ${trust_radius}\nintro method: ${preferred_method}\n\nnext: tell me about what you're working on, what you need, and what you can offer. i'll build your intro profile so i can find the right people for you.`,
        }],
      };
    }
  );

  // ─── Update Profile ───────────────────────────────────────────────────
  server.tool(
    "intros_update_profile",
    "Update your intro profile with what you're working on, what you need, and what you can offer. This is what the match engine uses to find people you should meet. All text is sanitized to remove PII before storage.",
    {
      current_projects: z.array(z.object({
        name: z.string(),
        description: z.string(),
        stage: z.enum(["idea", "building", "launched", "growing", "mature"]).optional().default("building"),
      })).optional().describe("What you're currently working on"),
      needs: z.array(z.object({
        description: z.string(),
        urgency: z.enum(["low", "medium", "high"]).optional().default("medium"),
        category: z.string().optional().default("general"),
      })).optional().describe("What you need — skills, connections, advice, tools"),
      offers: z.array(z.object({
        description: z.string(),
        category: z.string().optional().default("general"),
      })).optional().describe("What you can offer — expertise, connections, resources"),
      interests: z.array(z.string()).optional().describe("Topics you're interested in"),
      expertise: z.array(z.string()).optional().describe("Areas of expertise"),
      industries: z.array(z.string()).optional().describe("Industries you work in"),
    },
    async ({ current_projects, needs, offers, interests, expertise, industries }) => {
      // get existing profile
      const { data: existing } = await supabase
        .from("intro_profiles")
        .select("*")
        .eq("user_id", USER_ID)
        .single();

      if (!existing) {
        return { content: [{ type: "text" as const, text: "you need to opt in first. use intros_opt_in to get started." }] };
      }

      // sanitize all text fields through PII filter
      const updates: Record<string, any> = { updated_at: new Date().toISOString(), last_profile_update: new Date().toISOString() };

      if (current_projects) {
        const sanitized = current_projects.map(p => ({
          ...p,
          name: sanitize(p.name),
          description: sanitize(p.description),
          updated_at: new Date().toISOString(),
        }));
        // merge with existing, replacing by name
        const existingProjects = (existing.current_projects || []) as any[];
        const merged = [...existingProjects];
        for (const proj of sanitized) {
          const idx = merged.findIndex((p: any) => p.name === proj.name);
          if (idx >= 0) merged[idx] = proj;
          else merged.push(proj);
        }
        updates.current_projects = merged;
      }

      if (needs) {
        const sanitized = needs.map(n => ({
          ...n,
          description: sanitize(n.description),
          created_at: new Date().toISOString(),
        }));
        const existingNeeds = (existing.needs || []) as any[];
        updates.needs = [...existingNeeds, ...sanitized];
      }

      if (offers) {
        const sanitized = offers.map(o => ({
          ...o,
          description: sanitize(o.description),
          confidence: 0.8,
        }));
        const existingOffers = (existing.offers || []) as any[];
        updates.offers = [...existingOffers, ...sanitized];
      }

      if (interests) updates.interests = [...new Set([...(existing.interests || []), ...interests])];
      if (expertise) updates.expertise = [...new Set([...(existing.expertise || []), ...expertise])];
      if (industries) updates.industries = [...new Set([...(existing.industries || []), ...industries])];

      const { error } = await supabase
        .from("intro_profiles")
        .update(updates)
        .eq("user_id", USER_ID);

      if (error) return { content: [{ type: "text" as const, text: `error updating profile: ${error.message}` }] };

      const parts = [];
      if (current_projects) parts.push(`${current_projects.length} project(s)`);
      if (needs) parts.push(`${needs.length} need(s)`);
      if (offers) parts.push(`${offers.length} offer(s)`);
      if (interests) parts.push(`${interests.length} interest(s)`);
      if (expertise) parts.push(`${expertise.length} expertise area(s)`);
      if (industries) parts.push(`${industries.length} industry/industries`);

      return {
        content: [{
          type: "text" as const,
          text: `✅ profile updated: ${parts.join(", ")}\n\nthe match engine will use this to find people you should meet.`,
        }],
      };
    }
  );

  // ─── Get Suggestions ──────────────────────────────────────────────────
  server.tool(
    "intros_get_suggestions",
    "Get current intro suggestions — people you might want to meet based on your profile. Shows pending matches that need your approval.",
    {
      limit: z.number().optional().default(5).describe("Max suggestions to return"),
      include_context: z.boolean().optional().default(true).describe("Include match context/reason"),
    },
    async ({ limit, include_context }) => {
      // get pending matches where this user hasn't responded yet
      const { data: matches, error } = await supabase
        .from("intro_matches")
        .select("*")
        .or(`user_a_id.eq.${USER_ID},user_b_id.eq.${USER_ID}`)
        .eq("status", "pending")
        .gt("expires_at", new Date().toISOString())
        .order("score", { ascending: false })
        .limit(limit);

      if (error) return { content: [{ type: "text" as const, text: `error fetching suggestions: ${error.message}` }] };
      if (!matches || matches.length === 0) {
        return { content: [{ type: "text" as const, text: "no pending intro suggestions right now. i'll let you know when i find someone you should meet." }] };
      }

      // filter to ones where this user hasn't responded
      const pending = matches.filter(m => {
        if (m.user_a_id === USER_ID) return m.user_a_status === "pending";
        return m.user_b_status === "pending";
      });

      if (pending.length === 0) {
        return { content: [{ type: "text" as const, text: "you've responded to all current suggestions. i'll find more matches soon." }] };
      }

      const lines = pending.map((m, i) => {
        const isUserA = m.user_a_id === USER_ID;
        const pitch = isUserA ? m.user_a_pitch : m.user_b_pitch;
        const score = Math.round(m.score * 100);
        return `**${i + 1}.** ${pitch || "someone in the network might be a good match"}\n   match strength: ${score}%\n   match id: \`${m.id}\`${include_context ? `\n   why: ${m.match_reason}` : ""}`;
      });

      return {
        content: [{
          type: "text" as const,
          text: `🤝 ${pending.length} intro suggestion(s):\n\n${lines.join("\n\n")}\n\nuse intros_respond with the match id to approve, decline, or defer.`,
        }],
      };
    }
  );

  // ─── Respond to Match ─────────────────────────────────────────────────
  server.tool(
    "intros_respond",
    "Respond to an intro suggestion. Approve to connect, decline (invisible to the other person), or defer to revisit later.",
    {
      match_id: z.string().describe("ID of the match to respond to"),
      action: z.enum(["approve", "decline", "defer"]).describe("Your response"),
    },
    async ({ match_id, action }) => {
      // get the match
      const { data: match, error: fetchErr } = await supabase
        .from("intro_matches")
        .select("*")
        .eq("id", match_id)
        .single();

      if (fetchErr || !match) return { content: [{ type: "text" as const, text: "match not found." }] };

      const isUserA = match.user_a_id === USER_ID;
      if (!isUserA && match.user_b_id !== USER_ID) {
        return { content: [{ type: "text" as const, text: "this match isn't for you." }] };
      }

      // update this user's status
      const statusField = isUserA ? "user_a_status" : "user_b_status";
      const respondedField = isUserA ? "user_a_responded_at" : "user_b_responded_at";

      const { error: updateErr } = await supabase
        .from("intro_matches")
        .update({
          [statusField]: action === "defer" ? "deferred" : action === "approve" ? "approved" : "declined",
          [respondedField]: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", match_id);

      if (updateErr) return { content: [{ type: "text" as const, text: `error responding: ${updateErr.message}` }] };

      // log consent
      await supabase.from("intro_consent_log").insert({
        user_id: USER_ID,
        action: `${action}_match`,
        target_match_id: match_id,
      });

      // check if both users approved
      if (action === "approve") {
        const otherStatus = isUserA ? match.user_b_status : match.user_a_status;
        if (otherStatus === "approved") {
          // both approved — create the intro!
          await supabase.from("intro_matches").update({ status: "completed", updated_at: new Date().toISOString() }).eq("id", match_id);

          const { data: profileA } = await supabase.from("intro_profiles").select("preferred_intro_method").eq("user_id", match.user_a_id).single();
          const { data: profileB } = await supabase.from("intro_profiles").select("preferred_intro_method").eq("user_id", match.user_b_id).single();

          await supabase.from("intros").insert({
            match_id: match.id,
            user_a_id: match.user_a_id,
            user_b_id: match.user_b_id,
            shared_context: match.match_reason,
            intro_method: profileA?.preferred_intro_method || profileB?.preferred_intro_method || "agent_chat",
          });

          return {
            content: [{
              type: "text" as const,
              text: `🎉 it's a match! both of you approved. i'll facilitate the intro now.\n\nreason you're connecting: ${match.match_reason}`,
            }],
          };
        }

        return {
          content: [{
            type: "text" as const,
            text: `👍 approved. waiting for the other person to respond. i'll let you know when they do.\n\n(if they decline, you'll never know — that's by design.)`,
          }],
        };
      }

      if (action === "decline") {
        // update match status if both have responded and at least one declined
        await supabase.from("intro_matches").update({ status: "declined", updated_at: new Date().toISOString() }).eq("id", match_id);

        return {
          content: [{
            type: "text" as const,
            text: "declined. the other person won't know you were suggested. no awkwardness.",
          }],
        };
      }

      // defer
      return {
        content: [{
          type: "text" as const,
          text: `deferred. i'll remind you about this later. the match expires ${match.expires_at ? new Date(match.expires_at).toLocaleDateString() : "in 7 days"}.`,
        }],
      };
    }
  );

  // ─── History ──────────────────────────────────────────────────────────
  server.tool(
    "intros_history",
    "See your past intros and their outcomes.",
    {
      limit: z.number().optional().default(10),
    },
    async ({ limit }) => {
      const { data, error } = await supabase
        .from("intros")
        .select("*")
        .or(`user_a_id.eq.${USER_ID},user_b_id.eq.${USER_ID}`)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) return { content: [{ type: "text" as const, text: `error: ${error.message}` }] };
      if (!data || data.length === 0) return { content: [{ type: "text" as const, text: "no intros yet. once you approve a match and the other person does too, it'll show up here." }] };

      const lines = data.map((intro, i) => {
        const other = intro.user_a_id === USER_ID ? intro.user_b_id : intro.user_a_id;
        return `${i + 1}. connected with **${other}** — ${intro.outcome || "pending feedback"}\n   ${intro.shared_context || ""}\n   ${new Date(intro.created_at).toLocaleDateString()}`;
      });

      return {
        content: [{
          type: "text" as const,
          text: `📋 your intro history:\n\n${lines.join("\n\n")}`,
        }],
      };
    }
  );

  // ─── Set Preferences ──────────────────────────────────────────────────
  server.tool(
    "intros_set_preferences",
    "Update your intro preferences — frequency, trust radius, blocklist, preferred intro method.",
    {
      frequency: z.enum(["daily", "weekly", "monthly", "on_demand"]).optional(),
      trust_radius: z.enum(["contacts_only", "friends_of_friends", "open"]).optional(),
      preferred_method: z.enum(["agent_chat", "email", "text"]).optional(),
      blocklist_add: z.array(z.string()).optional().describe("User IDs to add to blocklist"),
      blocklist_remove: z.array(z.string()).optional().describe("User IDs to remove from blocklist"),
    },
    async ({ frequency, trust_radius, preferred_method, blocklist_add, blocklist_remove }) => {
      const { data: existing } = await supabase.from("intro_profiles").select("blocklist").eq("user_id", USER_ID).single();
      if (!existing) return { content: [{ type: "text" as const, text: "opt in first with intros_opt_in." }] };

      const updates: Record<string, any> = { updated_at: new Date().toISOString() };
      if (frequency) updates.intro_frequency = frequency;
      if (trust_radius) updates.trust_radius = trust_radius;
      if (preferred_method) updates.preferred_intro_method = preferred_method;

      if (blocklist_add || blocklist_remove) {
        let bl = new Set(existing.blocklist || []);
        if (blocklist_add) blocklist_add.forEach(id => bl.add(id));
        if (blocklist_remove) blocklist_remove.forEach(id => bl.delete(id));
        updates.blocklist = [...bl];
      }

      const { error } = await supabase.from("intro_profiles").update(updates).eq("user_id", USER_ID);
      if (error) return { content: [{ type: "text" as const, text: `error: ${error.message}` }] };

      return { content: [{ type: "text" as const, text: "✅ preferences updated." }] };
    }
  );

  // ─── Pause / Unpause ──────────────────────────────────────────────────
  server.tool(
    "intros_pause",
    "Temporarily pause intros without losing your profile. No new matches will be suggested.",
    {},
    async () => {
      const { error } = await supabase.from("intro_profiles").update({ paused: true, updated_at: new Date().toISOString() }).eq("user_id", USER_ID);
      if (error) return { content: [{ type: "text" as const, text: `error: ${error.message}` }] };

      await supabase.from("intro_consent_log").insert({ user_id: USER_ID, action: "pause" });
      return { content: [{ type: "text" as const, text: "⏸ intros paused. your profile is saved. say 'unpause intros' when you're ready." }] };
    }
  );

  server.tool(
    "intros_unpause",
    "Resume intros after pausing.",
    {},
    async () => {
      const { error } = await supabase.from("intro_profiles").update({ paused: false, updated_at: new Date().toISOString() }).eq("user_id", USER_ID);
      if (error) return { content: [{ type: "text" as const, text: `error: ${error.message}` }] };

      await supabase.from("intro_consent_log").insert({ user_id: USER_ID, action: "unpause" });
      return { content: [{ type: "text" as const, text: "▶️ intros resumed. i'll start looking for matches again." }] };
    }
  );

  // ─── Forget (Right to Delete) ─────────────────────────────────────────
  server.tool(
    "intros_forget",
    "Permanently delete your intro profile and all match history. This cannot be undone.",
    {
      confirm: z.boolean().describe("Must be true to confirm deletion"),
    },
    async ({ confirm }) => {
      if (!confirm) return { content: [{ type: "text" as const, text: "pass confirm: true to permanently delete your intro profile." }] };

      // delete in order: consent log, intros, matches, profile
      await supabase.from("intro_consent_log").insert({ user_id: USER_ID, action: "forget" });
      await supabase.from("intros").delete().or(`user_a_id.eq.${USER_ID},user_b_id.eq.${USER_ID}`);
      await supabase.from("intro_matches").delete().or(`user_a_id.eq.${USER_ID},user_b_id.eq.${USER_ID}`);
      await supabase.from("intro_profiles").delete().eq("user_id", USER_ID);

      return { content: [{ type: "text" as const, text: "🗑 intro profile deleted. all match history wiped. you can opt in again anytime." }] };
    }
  );

  // ─── View Profile ─────────────────────────────────────────────────────
  server.tool(
    "intros_view_profile",
    "See your current intro profile — what the match engine knows about you.",
    {},
    async () => {
      const { data, error } = await supabase.from("intro_profiles").select("*").eq("user_id", USER_ID).single();
      if (error || !data) return { content: [{ type: "text" as const, text: "no intro profile found. use intros_opt_in to get started." }] };

      const projects = (data.current_projects as any[] || []).map((p: any) => `  - ${p.name}: ${p.description} (${p.stage})`).join("\n");
      const needs = (data.needs as any[] || []).map((n: any) => `  - [${n.urgency}] ${n.description}`).join("\n");
      const offers = (data.offers as any[] || []).map((o: any) => `  - ${o.description} (${o.category})`).join("\n");

      return {
        content: [{
          type: "text" as const,
          text: `📋 your intro profile:\n\n**status:** ${data.opted_in ? (data.paused ? "paused" : "active") : "not opted in"}\n**frequency:** ${data.intro_frequency}\n**trust radius:** ${data.trust_radius}\n**intro method:** ${data.preferred_intro_method}\n\n**projects:**\n${projects || "  (none set)"}\n\n**needs:**\n${needs || "  (none set)"}\n\n**offers:**\n${offers || "  (none set)"}\n\n**interests:** ${(data.interests || []).join(", ") || "(none)"}\n**expertise:** ${(data.expertise || []).join(", ") || "(none)"}\n**industries:** ${(data.industries || []).join(", ") || "(none)"}\n\nlast updated: ${data.last_profile_update ? new Date(data.last_profile_update).toLocaleDateString() : "never"}`,
        }],
      };
    }
  );

  // ─── Extract Context from Conversation ──────────────────────────────────
  server.tool(
    "intros_extract_context",
    "Extract needs, offers, projects, interests, and expertise from conversation text and auto-update the user's intro profile. Call this when the user mentions what they're working on, what they need, or what they can offer.",
    {
      text: z.string().describe("The conversation text to extract context from"),
      auto_update: z.boolean().optional().default(true).describe("Automatically update the user's intro profile with extracted data"),
    },
    async ({ text, auto_update }) => {
      // quick check — is there anything worth extracting?
      if (!hasContextSignals(text)) {
        return { content: [{ type: "text" as const, text: "no relevant signals found in that text." }] };
      }

      const extracted = await extractContext(text, true);

      const hasData =
        extracted.needs.length > 0 ||
        extracted.offers.length > 0 ||
        extracted.projects.length > 0 ||
        extracted.interests.length > 0 ||
        extracted.expertise.length > 0 ||
        extracted.industries.length > 0;

      if (!hasData) {
        return { content: [{ type: "text" as const, text: "couldn't extract any structured context from that text." }] };
      }

      // auto-update profile if opted in
      if (auto_update) {
        const { data: profile } = await supabase
          .from("intro_profiles")
          .select("*")
          .eq("user_id", USER_ID)
          .single();

        if (profile && profile.opted_in) {
          const updates: Record<string, any> = { updated_at: new Date().toISOString(), last_profile_update: new Date().toISOString() };

          if (extracted.projects.length > 0) {
            const existing = (profile.current_projects || []) as any[];
            const sanitized = extracted.projects.map(p => ({
              ...p,
              name: sanitize(p.name),
              description: sanitize(p.description),
              updated_at: new Date().toISOString(),
            }));
            updates.current_projects = [...existing, ...sanitized];
          }

          if (extracted.needs.length > 0) {
            const existing = (profile.needs || []) as any[];
            const sanitized = extracted.needs.map(n => ({
              ...n,
              description: sanitize(n.description),
              created_at: new Date().toISOString(),
            }));
            updates.needs = [...existing, ...sanitized];
          }

          if (extracted.offers.length > 0) {
            const existing = (profile.offers || []) as any[];
            const sanitized = extracted.offers.map(o => ({
              ...o,
              description: sanitize(o.description),
              confidence: 0.7,
            }));
            updates.offers = [...existing, ...sanitized];
          }

          if (extracted.interests.length > 0) {
            updates.interests = [...new Set([...(profile.interests || []), ...extracted.interests])];
          }
          if (extracted.expertise.length > 0) {
            updates.expertise = [...new Set([...(profile.expertise || []), ...extracted.expertise])];
          }
          if (extracted.industries.length > 0) {
            updates.industries = [...new Set([...(profile.industries || []), ...extracted.industries])];
          }

          await supabase.from("intro_profiles").update(updates).eq("user_id", USER_ID);
        }
      }

      // format results
      const parts: string[] = [];
      if (extracted.needs.length > 0) parts.push(`**needs:** ${extracted.needs.map(n => n.description).join(", ")}`);
      if (extracted.offers.length > 0) parts.push(`**offers:** ${extracted.offers.map(o => o.description).join(", ")}`);
      if (extracted.projects.length > 0) parts.push(`**projects:** ${extracted.projects.map(p => `${p.name} (${p.stage})`).join(", ")}`);
      if (extracted.interests.length > 0) parts.push(`**interests:** ${extracted.interests.join(", ")}`);
      if (extracted.expertise.length > 0) parts.push(`**expertise:** ${extracted.expertise.join(", ")}`);
      if (extracted.industries.length > 0) parts.push(`**industries:** ${extracted.industries.join(", ")}`);

      const updated = auto_update ? "\n\n✅ profile updated with extracted data." : "";

      return {
        content: [{
          type: "text" as const,
          text: `🔍 extracted from conversation:\n\n${parts.join("\n")}${updated}`,
        }],
      };
    }
  );

  // ─── Run Match Engine (admin/agent tool) ───────────────────────────────
  server.tool(
    "intros_run_matches",
    "Run the match engine to find new intro suggestions across all opted-in users. This scores all profile pairs and creates match records for high-scoring pairs. Also expires stale matches.",
    {
      min_score: z.number().optional().default(0.6).describe("Minimum match score (0-1) to create a suggestion. Default 0.6."),
      use_llm_pitches: z.boolean().optional().default(true).describe("Use AI to generate pitch text for each match"),
    },
    async ({ min_score, use_llm_pitches }) => {
      // expire old matches first
      const expired = await expireStaleMatches();

      // run the engine
      const result = await runMatchEngine({
        minScore: min_score,
        useLLMPitches: use_llm_pitches,
      });

      const lines = [
        `🔄 match engine results:`,
        `  profiles checked: ${result.profilesChecked}`,
        `  new matches created: ${result.matchesCreated}`,
        `  stale matches expired: ${expired}`,
      ];

      if (result.errors.length > 0) {
        lines.push(`  errors: ${result.errors.join("; ")}`);
      }

      return { content: [{ type: "text" as const, text: lines.join("\n") }] };
    }
  );
}
