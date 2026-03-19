import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// helper to get or create intro_profile for a user
async function getOrCreateProfile(userId: string) {
  const { data: existing } = await supabase
    .from("intro_profiles")
    .select("*")
    .eq("user_id", userId)
    .single();
  return existing;
}

export function registerProfileTools(server: McpServer) {
  // intros_opt_in
  server.tool(
    "intros_opt_in",
    "opt in to nod intros. creates or updates your intro profile and sets opted_in to true.",
    {
      user_id: z.string().uuid().describe("the user's profile id"),
      bio: z.string().optional().describe("short bio for intro context"),
      frequency: z
        .enum(["daily", "weekly", "monthly", "on_demand"])
        .optional()
        .describe("how often to receive intro suggestions"),
      trust_radius: z
        .enum(["contacts_only", "friends_of_friends", "open"])
        .optional()
        .describe("who can be suggested as matches"),
      preferred_method: z
        .enum(["agent_chat", "email", "text"])
        .optional()
        .describe("preferred intro delivery method"),
    },
    async ({ user_id, bio, frequency, trust_radius, preferred_method }) => {
      const existing = await getOrCreateProfile(user_id);

      if (existing) {
        // update existing profile
        const updates: Record<string, unknown> = {
          opted_in: true,
          updated_at: new Date().toISOString(),
        };
        if (bio !== undefined) updates.bio = bio;
        if (frequency !== undefined) updates.intro_frequency = frequency;
        if (trust_radius !== undefined) updates.trust_radius = trust_radius;
        if (preferred_method !== undefined) updates.preferred_method = preferred_method;

        const { error } = await supabase
          .from("intro_profiles")
          .update(updates)
          .eq("id", existing.id);

        if (error) {
          return { content: [{ type: "text" as const, text: `error updating profile: ${error.message}` }] };
        }
        return { content: [{ type: "text" as const, text: `opted back in. profile updated.` }] };
      }

      // create new profile
      const { error } = await supabase.from("intro_profiles").insert({
        user_id,
        opted_in: true,
        bio: bio || null,
        intro_frequency: frequency || "weekly",
        trust_radius: trust_radius || "open",
        preferred_method: preferred_method || "agent_chat",
      });

      if (error) {
        return { content: [{ type: "text" as const, text: `error creating profile: ${error.message}` }] };
      }

      return { content: [{ type: "text" as const, text: `opted in to nod intros. frequency: ${frequency || "weekly"}, trust: ${trust_radius || "open"}, method: ${preferred_method || "agent_chat"}` }] };
    }
  );

  // intros_pause
  server.tool(
    "intros_pause",
    "pause intro suggestions without deleting your data. sets opted_in to false.",
    {
      user_id: z.string().uuid().describe("the user's profile id"),
    },
    async ({ user_id }) => {
      const { error } = await supabase
        .from("intro_profiles")
        .update({ opted_in: false, updated_at: new Date().toISOString() })
        .eq("user_id", user_id);

      if (error) {
        return { content: [{ type: "text" as const, text: `error pausing: ${error.message}` }] };
      }
      return { content: [{ type: "text" as const, text: "intros paused. your data is preserved — opt back in anytime." }] };
    }
  );

  // intros_forget
  server.tool(
    "intros_forget",
    "permanently delete all your intro data. this removes your profile, projects, needs, offers, expertise, and any pending matches.",
    {
      user_id: z.string().uuid().describe("the user's profile id"),
    },
    async ({ user_id }) => {
      // get profile id first
      const { data: profile } = await supabase
        .from("intro_profiles")
        .select("id")
        .eq("user_id", user_id)
        .single();

      if (!profile) {
        return { content: [{ type: "text" as const, text: "no intro profile found." }] };
      }

      // delete profile (cascades to projects, needs, offers, expertise)
      const { error } = await supabase
        .from("intro_profiles")
        .delete()
        .eq("id", profile.id);

      if (error) {
        return { content: [{ type: "text" as const, text: `error deleting profile: ${error.message}` }] };
      }

      // expire any pending matches involving this user
      await supabase
        .from("intro_matches")
        .update({ status: "expired", updated_at: new Date().toISOString() })
        .or(`user_a_id.eq.${user_id},user_b_id.eq.${user_id}`)
        .in("status", ["pending_a", "pending_b"]);

      return { content: [{ type: "text" as const, text: "all intro data deleted. consent log entries are preserved for audit." }] };
    }
  );

  // intros_update_profile
  server.tool(
    "intros_update_profile",
    "update your intro profile preferences.",
    {
      user_id: z.string().uuid().describe("the user's profile id"),
      bio: z.string().optional().describe("updated bio"),
      frequency: z
        .enum(["daily", "weekly", "monthly", "on_demand"])
        .optional()
        .describe("intro suggestion frequency"),
      trust_radius: z
        .enum(["contacts_only", "friends_of_friends", "open"])
        .optional()
        .describe("who can be suggested"),
      preferred_method: z
        .enum(["agent_chat", "email", "text"])
        .optional()
        .describe("preferred intro method"),
      blocklist: z
        .array(z.string())
        .optional()
        .describe("list of user_ids to never match with"),
    },
    async ({ user_id, bio, frequency, trust_radius, preferred_method, blocklist }) => {
      const updates: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (bio !== undefined) updates.bio = bio;
      if (frequency !== undefined) updates.intro_frequency = frequency;
      if (trust_radius !== undefined) updates.trust_radius = trust_radius;
      if (preferred_method !== undefined) updates.preferred_method = preferred_method;
      if (blocklist !== undefined) updates.blocklist = blocklist;

      const { error } = await supabase
        .from("intro_profiles")
        .update(updates)
        .eq("user_id", user_id);

      if (error) {
        return { content: [{ type: "text" as const, text: `error updating profile: ${error.message}` }] };
      }
      return { content: [{ type: "text" as const, text: "profile updated." }] };
    }
  );

  // intros_get_profile
  server.tool(
    "intros_get_profile",
    "view an intro profile. defaults to your own. only shows opted-in profiles for other users.",
    {
      user_id: z.string().uuid().describe("your user id (for auth context)"),
      target_user_id: z
        .string()
        .uuid()
        .optional()
        .describe("user id to look up. omit for your own profile."),
    },
    async ({ user_id, target_user_id }) => {
      const lookupId = target_user_id || user_id;
      const isSelf = lookupId === user_id;

      let query = supabase
        .from("intro_profiles")
        .select("*")
        .eq("user_id", lookupId);

      // only show opted-in profiles for other users
      if (!isSelf) {
        query = query.eq("opted_in", true);
      }

      const { data: profile, error } = await query.single();

      if (error || !profile) {
        return { content: [{ type: "text" as const, text: isSelf ? "no intro profile found. use intros_opt_in to get started." : "user has no public intro profile." }] };
      }

      // fetch related data
      const [projects, needs, offers, expertise] = await Promise.all([
        supabase.from("intro_projects").select("*").eq("profile_id", profile.id),
        supabase.from("intro_needs").select("*").eq("profile_id", profile.id).eq("fulfilled", false),
        supabase.from("intro_offers").select("*").eq("profile_id", profile.id),
        supabase.from("intro_expertise").select("*").eq("profile_id", profile.id),
      ]);

      // also pull shout tags for enrichment (read-only)
      const { data: shoutTags } = await supabase
        .from("shouts")
        .select("tags, category")
        .eq("user_id", lookupId)
        .order("created_at", { ascending: false })
        .limit(20);

      const shoutCategories = new Set<string>();
      const shoutTagSet = new Set<string>();
      if (shoutTags) {
        for (const s of shoutTags) {
          if ((s as any).category) shoutCategories.add((s as any).category);
          if ((s as any).tags) {
            for (const t of (s as any).tags) shoutTagSet.add(t);
          }
        }
      }

      let output = `## intro profile\n`;
      output += `opted in: ${profile.opted_in}\n`;
      output += `frequency: ${profile.intro_frequency}\n`;
      output += `trust: ${profile.trust_radius}\n`;
      output += `method: ${profile.preferred_method}\n`;
      if (profile.bio) output += `bio: ${profile.bio}\n`;
      if (isSelf && profile.blocklist?.length) output += `blocklist: ${profile.blocklist.join(", ")}\n`;

      if (projects.data?.length) {
        output += `\n### projects\n`;
        for (const p of projects.data) {
          output += `- ${(p as any).name}${(p as any).stage ? ` (${(p as any).stage})` : ""}${(p as any).description ? `: ${(p as any).description}` : ""}\n`;
        }
      }

      if (needs.data?.length) {
        output += `\n### needs\n`;
        for (const n of needs.data) {
          output += `- [${(n as any).urgency}] ${(n as any).description}${(n as any).category ? ` (${(n as any).category})` : ""}\n`;
        }
      }

      if (offers.data?.length) {
        output += `\n### offers\n`;
        for (const o of offers.data) {
          output += `- ${(o as any).description}${(o as any).category ? ` (${(o as any).category})` : ""}\n`;
        }
      }

      if (expertise.data?.length) {
        output += `\n### expertise & interests\n`;
        for (const e of expertise.data) {
          output += `- ${(e as any).label} (${(e as any).type}, ${(e as any).source})\n`;
        }
      }

      if (shoutCategories.size > 0 || shoutTagSet.size > 0) {
        output += `\n### from shout activity\n`;
        if (shoutCategories.size) output += `categories: ${[...shoutCategories].join(", ")}\n`;
        if (shoutTagSet.size) output += `tags: ${[...shoutTagSet].join(", ")}\n`;
      }

      return { content: [{ type: "text" as const, text: output }] };
    }
  );
}
