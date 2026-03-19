import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// helper to get profile_id from user_id
async function getProfileId(userId: string): Promise<string | null> {
  const { data } = await supabase
    .from("intro_profiles")
    .select("id")
    .eq("user_id", userId)
    .single();
  return data?.id || null;
}

export function registerContextTools(server: McpServer) {
  // intros_add_project
  server.tool(
    "intros_add_project",
    "add a project you're working on to your intro profile.",
    {
      user_id: z.string().uuid().describe("the user's profile id"),
      name: z.string().describe("project name"),
      description: z.string().optional().describe("what the project is about"),
      stage: z
        .enum(["idea", "building", "launched", "scaling", "completed"])
        .optional()
        .describe("current stage of the project"),
    },
    async ({ user_id, name, description, stage }) => {
      const profileId = await getProfileId(user_id);
      if (!profileId) {
        return { content: [{ type: "text" as const, text: "no intro profile found. use intros_opt_in first." }] };
      }

      const { data, error } = await supabase
        .from("intro_projects")
        .insert({
          profile_id: profileId,
          name,
          description: description || null,
          stage: stage || null,
        })
        .select()
        .single();

      if (error) {
        return { content: [{ type: "text" as const, text: `error adding project: ${error.message}` }] };
      }

      return { content: [{ type: "text" as const, text: `added project "${name}"${stage ? ` (${stage})` : ""}. id: ${(data as any).id}` }] };
    }
  );

  // intros_remove_project
  server.tool(
    "intros_remove_project",
    "remove a project from your intro profile.",
    {
      user_id: z.string().uuid().describe("the user's profile id"),
      project_id: z.string().uuid().describe("the project id to remove"),
    },
    async ({ user_id, project_id }) => {
      const profileId = await getProfileId(user_id);
      if (!profileId) {
        return { content: [{ type: "text" as const, text: "no intro profile found." }] };
      }

      const { error } = await supabase
        .from("intro_projects")
        .delete()
        .eq("id", project_id)
        .eq("profile_id", profileId);

      if (error) {
        return { content: [{ type: "text" as const, text: `error removing project: ${error.message}` }] };
      }

      return { content: [{ type: "text" as const, text: `project ${project_id} removed.` }] };
    }
  );

  // intros_add_need
  server.tool(
    "intros_add_need",
    "add something you need to your intro profile. this helps match you with people who can help.",
    {
      user_id: z.string().uuid().describe("the user's profile id"),
      description: z.string().describe("what you need"),
      category: z.string().optional().describe("category for this need"),
      urgency: z
        .enum(["low", "medium", "high"])
        .optional()
        .describe("how urgent this need is"),
    },
    async ({ user_id, description, category, urgency }) => {
      const profileId = await getProfileId(user_id);
      if (!profileId) {
        return { content: [{ type: "text" as const, text: "no intro profile found. use intros_opt_in first." }] };
      }

      const { data, error } = await supabase
        .from("intro_needs")
        .insert({
          profile_id: profileId,
          description,
          category: category || null,
          urgency: urgency || "medium",
        })
        .select()
        .single();

      if (error) {
        return { content: [{ type: "text" as const, text: `error adding need: ${error.message}` }] };
      }

      return { content: [{ type: "text" as const, text: `added need: "${description}" [${urgency || "medium"}]. id: ${(data as any).id}` }] };
    }
  );

  // intros_fulfill_need
  server.tool(
    "intros_fulfill_need",
    "mark a need as fulfilled.",
    {
      user_id: z.string().uuid().describe("the user's profile id"),
      need_id: z.string().uuid().describe("the need id to mark fulfilled"),
    },
    async ({ user_id, need_id }) => {
      const profileId = await getProfileId(user_id);
      if (!profileId) {
        return { content: [{ type: "text" as const, text: "no intro profile found." }] };
      }

      const { error } = await supabase
        .from("intro_needs")
        .update({ fulfilled: true })
        .eq("id", need_id)
        .eq("profile_id", profileId);

      if (error) {
        return { content: [{ type: "text" as const, text: `error fulfilling need: ${error.message}` }] };
      }

      return { content: [{ type: "text" as const, text: `need ${need_id} marked as fulfilled.` }] };
    }
  );

  // intros_add_offer
  server.tool(
    "intros_add_offer",
    "add something you can offer to others. this helps match you with people who need your help.",
    {
      user_id: z.string().uuid().describe("the user's profile id"),
      description: z.string().describe("what you can offer"),
      category: z.string().optional().describe("category for this offer"),
      confidence: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe("how confident you are in this offer (0-1)"),
    },
    async ({ user_id, description, category, confidence }) => {
      const profileId = await getProfileId(user_id);
      if (!profileId) {
        return { content: [{ type: "text" as const, text: "no intro profile found. use intros_opt_in first." }] };
      }

      const { data, error } = await supabase
        .from("intro_offers")
        .insert({
          profile_id: profileId,
          description,
          category: category || null,
          confidence: confidence ?? 0.8,
        })
        .select()
        .single();

      if (error) {
        return { content: [{ type: "text" as const, text: `error adding offer: ${error.message}` }] };
      }

      return { content: [{ type: "text" as const, text: `added offer: "${description}". id: ${(data as any).id}` }] };
    }
  );

  // intros_remove_offer
  server.tool(
    "intros_remove_offer",
    "remove an offer from your intro profile.",
    {
      user_id: z.string().uuid().describe("the user's profile id"),
      offer_id: z.string().uuid().describe("the offer id to remove"),
    },
    async ({ user_id, offer_id }) => {
      const profileId = await getProfileId(user_id);
      if (!profileId) {
        return { content: [{ type: "text" as const, text: "no intro profile found." }] };
      }

      const { error } = await supabase
        .from("intro_offers")
        .delete()
        .eq("id", offer_id)
        .eq("profile_id", profileId);

      if (error) {
        return { content: [{ type: "text" as const, text: `error removing offer: ${error.message}` }] };
      }

      return { content: [{ type: "text" as const, text: `offer ${offer_id} removed.` }] };
    }
  );

  // intros_add_expertise
  server.tool(
    "intros_add_expertise",
    "add an expertise tag, interest, or industry to your intro profile.",
    {
      user_id: z.string().uuid().describe("the user's profile id"),
      label: z.string().describe("the expertise, interest, or industry label"),
      type: z
        .enum(["expertise", "interest", "industry"])
        .describe("what kind of tag this is"),
      source: z
        .enum(["manual", "conversation", "shout", "inferred"])
        .optional()
        .describe("where this was sourced from"),
    },
    async ({ user_id, label, type, source }) => {
      const profileId = await getProfileId(user_id);
      if (!profileId) {
        return { content: [{ type: "text" as const, text: "no intro profile found. use intros_opt_in first." }] };
      }

      const { data, error } = await supabase
        .from("intro_expertise")
        .insert({
          profile_id: profileId,
          label,
          type,
          source: source || "manual",
        })
        .select()
        .single();

      if (error) {
        return { content: [{ type: "text" as const, text: `error adding expertise: ${error.message}` }] };
      }

      return { content: [{ type: "text" as const, text: `added ${type}: "${label}". id: ${(data as any).id}` }] };
    }
  );
}
