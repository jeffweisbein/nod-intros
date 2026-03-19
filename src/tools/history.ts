import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerHistoryTools(server: McpServer) {
  // intros_rate
  server.tool(
    "intros_rate",
    "rate how an intro went. only works for approved/completed matches you're part of.",
    {
      user_id: z.string().uuid().describe("the rating user's id"),
      match_id: z.string().uuid().describe("the match id to rate"),
      outcome: z
        .enum(["great", "good", "neutral", "not_helpful"])
        .describe("how the intro went"),
      notes: z.string().optional().describe("optional notes about the outcome"),
    },
    async ({ user_id, match_id, outcome, notes }) => {
      // verify the user is part of this match
      const { data: match } = await supabase
        .from("intro_matches")
        .select("user_a_id, user_b_id, status")
        .eq("id", match_id)
        .single();

      if (!match) {
        return { content: [{ type: "text" as const, text: "match not found." }] };
      }

      if ((match as any).user_a_id !== user_id && (match as any).user_b_id !== user_id) {
        return { content: [{ type: "text" as const, text: "you're not part of this match." }] };
      }

      if (!["approved", "completed"].includes((match as any).status)) {
        return { content: [{ type: "text" as const, text: "can only rate approved or completed intros." }] };
      }

      // update the connection
      const { error } = await supabase
        .from("intro_connections")
        .update({
          outcome,
          outcome_notes: notes || null,
        })
        .eq("match_id", match_id);

      if (error) {
        return { content: [{ type: "text" as const, text: `error rating: ${error.message}` }] };
      }

      // mark match as completed
      await supabase
        .from("intro_matches")
        .update({
          status: "completed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", match_id);

      return { content: [{ type: "text" as const, text: `rated "${outcome}". thanks for the feedback.` }] };
    }
  );

  // intros_history
  server.tool(
    "intros_history",
    "see your past intros and outcomes.",
    {
      user_id: z.string().uuid().describe("the user's id"),
      limit: z.number().optional().describe("max results (default 20)"),
    },
    async ({ user_id, limit }) => {
      const maxResults = limit || 20;

      // get completed/approved connections involving this user
      const { data: connections } = await supabase
        .from("intro_connections")
        .select("*, intro_matches(*)")
        .or(`user_a_id.eq.${user_id},user_b_id.eq.${user_id}`)
        .order("connected_at", { ascending: false })
        .limit(maxResults);

      if (!connections || connections.length === 0) {
        return { content: [{ type: "text" as const, text: "no intro history yet." }] };
      }

      // get user names
      const otherIds = connections.map((c: any) =>
        c.user_a_id === user_id ? c.user_b_id : c.user_a_id
      );

      const { data: users } = await supabase
        .from("profiles")
        .select("id, username, display_name")
        .in("id", otherIds);

      const userMap = new Map((users || []).map((u: any) => [u.id, u]));

      const lines = connections.map((c: any, i: number) => {
        const otherId = c.user_a_id === user_id ? c.user_b_id : c.user_a_id;
        const other = userMap.get(otherId);
        const name = other?.display_name || other?.username || otherId;
        const match = c.intro_matches;
        const outcomeStr = c.outcome ? ` — ${c.outcome}` : " — not rated";
        return `${i + 1}. ${name}${outcomeStr}\n   reason: ${match?.match_reason || "n/a"}\n   via: ${c.intro_method}\n   date: ${c.connected_at}${c.outcome_notes ? `\n   notes: ${c.outcome_notes}` : ""}`;
      });

      return {
        content: [{
          type: "text" as const,
          text: `${connections.length} intro${connections.length !== 1 ? "s" : ""}:\n\n${lines.join("\n\n")}`,
        }],
      };
    }
  );
}
