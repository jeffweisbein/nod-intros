import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export function registerConsentTools(server: McpServer) {
  // intros_respond
  server.tool(
    "intros_respond",
    "respond to a match suggestion. approve, decline, or defer. if both users approve, the intro is created automatically. declines are invisible to the other user.",
    {
      user_id: z.string().uuid().describe("the responding user's id"),
      match_id: z.string().uuid().describe("the match id to respond to"),
      action: z
        .enum(["approve", "decline", "defer"])
        .describe("your response"),
    },
    async ({ user_id, match_id, action }) => {
      // get the match
      const { data: match, error: fetchError } = await supabase
        .from("intro_matches")
        .select("*")
        .eq("id", match_id)
        .single();

      if (fetchError || !match) {
        return { content: [{ type: "text" as const, text: "match not found." }] };
      }

      const isUserA = (match as any).user_a_id === user_id;
      const isUserB = (match as any).user_b_id === user_id;

      if (!isUserA && !isUserB) {
        return { content: [{ type: "text" as const, text: "you're not part of this match." }] };
      }

      // check status validity
      const status = (match as any).status;
      if (isUserA && status !== "pending_a") {
        return { content: [{ type: "text" as const, text: `can't respond — match status is ${status}.` }] };
      }
      if (isUserB && status !== "pending_b") {
        return { content: [{ type: "text" as const, text: `can't respond — match status is ${status}.` }] };
      }

      const now = new Date().toISOString();

      // log the action (always, even defers)
      await supabase.from("intro_consent_log").insert({
        match_id,
        user_id,
        action: action === "approve" ? "approved" : action === "decline" ? "declined" : "deferred",
      });

      if (action === "defer") {
        return { content: [{ type: "text" as const, text: "deferred. we'll remind you later." }] };
      }

      if (action === "decline") {
        const newStatus = isUserA ? "declined_a" : "declined_b";
        const responseField = isUserA ? "user_a_responded_at" : "user_b_responded_at";

        await supabase
          .from("intro_matches")
          .update({
            status: newStatus,
            [responseField]: now,
            updated_at: now,
          })
          .eq("id", match_id);

        return { content: [{ type: "text" as const, text: "declined. the other user won't know this match was suggested." }] };
      }

      // approve
      if (isUserA) {
        // user A approves -> pending_b
        await supabase
          .from("intro_matches")
          .update({
            status: "pending_b",
            user_a_responded_at: now,
            updated_at: now,
          })
          .eq("id", match_id);

        return { content: [{ type: "text" as const, text: "approved! waiting for the other user to respond." }] };
      }

      // user B approves -> both approved, create connection
      await supabase
        .from("intro_matches")
        .update({
          status: "approved",
          user_b_responded_at: now,
          updated_at: now,
        })
        .eq("id", match_id);

      // get preferred method from user A's profile
      const { data: profileA } = await supabase
        .from("intro_profiles")
        .select("preferred_method")
        .eq("user_id", (match as any).user_a_id)
        .single();

      const method = (profileA as any)?.preferred_method || "agent_chat";

      // create the connection
      const { error: connError } = await supabase
        .from("intro_connections")
        .insert({
          match_id,
          user_a_id: (match as any).user_a_id,
          user_b_id: (match as any).user_b_id,
          intro_method: method,
          intro_message: (match as any).match_reason,
        });

      if (connError) {
        console.error("error creating connection:", connError.message);
      }

      // log intro_sent
      await supabase.from("intro_consent_log").insert({
        match_id,
        user_id,
        action: "intro_sent",
      });

      return {
        content: [{
          type: "text" as const,
          text: `both approved! intro created via ${method}.\nmatch reason: ${(match as any).match_reason}`,
        }],
      };
    }
  );

  // intros_list_pending
  server.tool(
    "intros_list_pending",
    "list pending match suggestions for a user.",
    {
      user_id: z.string().uuid().describe("the user's id"),
    },
    async ({ user_id }) => {
      // find matches where this user needs to respond
      const { data: asA } = await supabase
        .from("intro_matches")
        .select("*")
        .eq("user_a_id", user_id)
        .eq("status", "pending_a");

      const { data: asB } = await supabase
        .from("intro_matches")
        .select("*")
        .eq("user_b_id", user_id)
        .eq("status", "pending_b");

      const pending = [...(asA || []), ...(asB || [])];

      if (pending.length === 0) {
        return { content: [{ type: "text" as const, text: "no pending intro suggestions." }] };
      }

      // get user names for display
      const otherIds = pending.map((m: any) =>
        m.user_a_id === user_id ? m.user_b_id : m.user_a_id
      );

      const { data: users } = await supabase
        .from("profiles")
        .select("id, username, display_name")
        .in("id", otherIds);

      const userMap = new Map((users || []).map((u: any) => [u.id, u]));

      const lines = pending.map((m: any, i: number) => {
        const otherId = m.user_a_id === user_id ? m.user_b_id : m.user_a_id;
        const other = userMap.get(otherId);
        const name = other?.display_name || other?.username || otherId;
        const expires = m.expires_at ? new Date(m.expires_at).toLocaleDateString() : "no expiry";
        return `${i + 1}. match with ${name}\n   reason: ${m.match_reason}\n   expires: ${expires}\n   match_id: ${m.id}`;
      });

      return {
        content: [{
          type: "text" as const,
          text: `${pending.length} pending suggestion${pending.length !== 1 ? "s" : ""}:\n\n${lines.join("\n\n")}\n\nuse intros_respond to approve, decline, or defer.`,
        }],
      };
    }
  );

  // intros_get_match
  server.tool(
    "intros_get_match",
    "get details about a match. respects privacy — declined matches show as expired to the other user.",
    {
      user_id: z.string().uuid().describe("the requesting user's id"),
      match_id: z.string().uuid().describe("the match id"),
    },
    async ({ user_id, match_id }) => {
      const { data: match, error } = await supabase
        .from("intro_matches")
        .select("*")
        .eq("id", match_id)
        .single();

      if (error || !match) {
        return { content: [{ type: "text" as const, text: "match not found." }] };
      }

      const isUserA = (match as any).user_a_id === user_id;
      const isUserB = (match as any).user_b_id === user_id;

      if (!isUserA && !isUserB) {
        return { content: [{ type: "text" as const, text: "you're not part of this match." }] };
      }

      // privacy: if the OTHER user declined, show as expired
      let displayStatus = (match as any).status;
      if (isUserA && displayStatus === "declined_b") displayStatus = "expired";
      if (isUserB && displayStatus === "declined_a") displayStatus = "expired";

      const otherId = isUserA ? (match as any).user_b_id : (match as any).user_a_id;
      const { data: other } = await supabase
        .from("profiles")
        .select("username, display_name")
        .eq("id", otherId)
        .single();

      const otherName = (other as any)?.display_name || (other as any)?.username || otherId;

      let output = `## match ${match_id}\n`;
      output += `with: ${otherName}\n`;
      output += `reason: ${(match as any).match_reason}\n`;
      output += `status: ${displayStatus}\n`;
      output += `source: ${(match as any).source}\n`;
      output += `created: ${(match as any).created_at}\n`;
      if ((match as any).expires_at) output += `expires: ${(match as any).expires_at}\n`;

      // if approved, show connection info
      if (displayStatus === "approved" || displayStatus === "completed") {
        const { data: conn } = await supabase
          .from("intro_connections")
          .select("*")
          .eq("match_id", match_id)
          .single();

        if (conn) {
          output += `\nconnected via: ${(conn as any).intro_method}\n`;
          if ((conn as any).outcome) output += `outcome: ${(conn as any).outcome}\n`;
        }
      }

      return { content: [{ type: "text" as const, text: output }] };
    }
  );
}
