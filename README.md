# nod-intros 🤝

Agent-brokered warm introductions. Your AI agent knows what you're working on, what you need, and what you can offer. When there's a match with someone else in the network, both agents facilitate a double opt-in intro.

Part of [nod social](https://nodsocial.com).

## Install

### Quick setup (openclaw / Claude Code)

```bash
# Clone and install
git clone https://github.com/jeffweisbein/nod-intros.git
cd nod-intros
npm install
npm run build

# Copy env (uses nod social's shared supabase)
cp .env.example .env
# Edit .env — fill in your SUPABASE_URL and keys (get these from nodsocial.com/join or ask @jeffweisbein)

# Add to your MCP config (~/.claude.json or your agent's mcp config)
# See "MCP Config" section below
```

### MCP Config

Add to your `~/.claude.json` (or equivalent MCP config):

```json
{
  "mcpServers": {
    "nod-intros": {
      "command": "node",
      "args": ["/path/to/nod-intros/dist/index.js"],
      "env": {
        "SUPABASE_URL": "https://ooykzbkcquvreeheaijy.supabase.co",
        "SUPABASE_ANON_KEY": "your_anon_key",
        "SUPABASE_SERVICE_ROLE_KEY": "your_service_role_key"
      }
    }
  }
}
```

### OpenClaw Skill Install

Copy this into your openclaw skills directory:

```bash
mkdir -p ~/.openclaw/sandboxes/$(ls ~/.openclaw/sandboxes/ | head -1)/skills/nod-intros
```

Then create `SKILL.md` inside with:

```markdown
---
name: nod-intros
description: Agent-brokered warm introductions with double opt-in consent.
homepage: https://nodsocial.com
metadata: {"openclaw":{"emoji":"🤝"}}
---

# nod-intros 🤝

19 tools for agent-facilitated introductions.

## Setup

cd /path/to/nod-intros && node dist/index.js

## Tools

- intros_opt_in — join the network
- intros_add_project — add what you're working on
- intros_add_need — add what you need
- intros_add_offer — add what you can offer
- intros_search — find people in the network
- intros_suggest — suggest an intro (double opt-in)
- intros_respond — approve or decline (declines are invisible)

Full docs: https://github.com/jeffweisbein/nod-intros
```

## How It Works

1. **Opt in** — your agent creates your profile with what you're working on, what you need, what you offer
2. **Your agent updates your profile** — from conversations, it learns your current projects and needs
3. **Search or get matched** — search the network yourself, or wait for suggestions
4. **Double opt-in** — both people must approve before any info is shared
5. **Invisible decline** — if someone says no, the other person never knows
6. **Connect** — agents facilitate the intro through your preferred method

## Privacy

- Profiles are only visible to other opted-in users
- Declines are invisible to the other party
- Blocklist prevents specific users from seeing you
- Every action is logged in an append-only consent audit trail
- `intros_forget` permanently deletes all your data

## Tools Reference

### Profile
| Tool | Description |
|------|-------------|
| `intros_opt_in` | Join the network (bio, frequency, trust radius, contact method) |
| `intros_pause` | Temporarily pause without deleting data |
| `intros_forget` | Permanently delete everything |
| `intros_update_profile` | Update preferences |
| `intros_get_profile` | View your or another user's profile |

### Context
| Tool | Description |
|------|-------------|
| `intros_add_project` | Add a current project (name, description, stage) |
| `intros_remove_project` | Remove a project |
| `intros_add_need` | Add something you need |
| `intros_fulfill_need` | Mark a need as fulfilled |
| `intros_add_offer` | Add something you can offer |
| `intros_remove_offer` | Remove an offer |
| `intros_add_expertise` | Add expertise/interest/industry tag |

### Matching
| Tool | Description |
|------|-------------|
| `intros_search` | Search opted-in profiles by query |
| `intros_suggest` | Create an intro suggestion (triggers consent flow) |

### Consent
| Tool | Description |
|------|-------------|
| `intros_respond` | Approve, decline, or defer a suggestion |
| `intros_list_pending` | List pending intro suggestions |
| `intros_get_match` | Get match details |

### History
| Tool | Description |
|------|-------------|
| `intros_rate` | Rate how an intro went |
| `intros_history` | View past intros |

## License

MIT
