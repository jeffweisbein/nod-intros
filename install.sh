#!/bin/bash
# nod-intros quick install for openclaw / Claude Code users
# Usage: curl -sSL https://raw.githubusercontent.com/jeffweisbein/nod-intros/main/install.sh | bash

set -e

echo "🤝 Installing nod-intros..."

# Clone
INSTALL_DIR="$HOME/code/nod-intros"
if [ -d "$INSTALL_DIR" ]; then
    echo "Updating existing install..."
    cd "$INSTALL_DIR" && git pull
else
    echo "Cloning..."
    mkdir -p "$HOME/code"
    git clone https://github.com/jeffweisbein/nod-intros.git "$INSTALL_DIR"
    cd "$INSTALL_DIR"
fi

# Install and build
npm install --silent
npm run build

# Create .env if not exists
if [ ! -f .env ]; then
    cp .env.example .env
    echo ""
    echo "⚠️  Edit $INSTALL_DIR/.env with your supabase keys"
    echo "   Get keys from nodsocial.com/join or ask @jeffweisbein"
fi

# Detect openclaw and install skill
OPENCLAW_DIR=$(find "$HOME/.openclaw/sandboxes" -maxdepth 1 -type d 2>/dev/null | head -2 | tail -1)
if [ -n "$OPENCLAW_DIR" ]; then
    SKILL_DIR="$OPENCLAW_DIR/skills/nod-intros"
    mkdir -p "$SKILL_DIR"
    cat > "$SKILL_DIR/SKILL.md" << 'SKILLEOF'
---
name: nod-intros
description: Agent-brokered warm introductions with double opt-in consent. Your agent knows what you need and can offer — it finds matches and brokers intros.
homepage: https://nodsocial.com
metadata: {"openclaw":{"emoji":"🤝"}}
---

# nod-intros 🤝

19 tools for agent-facilitated warm introductions.

## Tools

**Profile:** intros_opt_in, intros_pause, intros_forget, intros_update_profile, intros_get_profile
**Context:** intros_add_project, intros_remove_project, intros_add_need, intros_fulfill_need, intros_add_offer, intros_remove_offer, intros_add_expertise
**Matching:** intros_search, intros_suggest
**Consent:** intros_respond, intros_list_pending, intros_get_match
**History:** intros_rate, intros_history

## Usage

Tell your agent: "opt me into nod intros" or "find someone who knows about [topic]"

Privacy: double opt-in, invisible declines, blocklist, right to forget.

Docs: https://github.com/jeffweisbein/nod-intros
SKILLEOF
    echo "✅ OpenClaw skill installed at $SKILL_DIR"
fi

# Detect Claude Code and suggest MCP config
CLAUDE_CONFIG="$HOME/.claude.json"
if [ -f "$CLAUDE_CONFIG" ]; then
    echo ""
    echo "📋 Add this to your $CLAUDE_CONFIG under mcpServers:"
    echo ""
    echo '    "nod-intros": {'
    echo '      "command": "node",'
    echo "      \"args\": [\"$INSTALL_DIR/dist/index.js\"]"
    echo '    }'
    echo ""
fi

echo ""
echo "🤝 nod-intros installed!"
echo ""
echo "Next steps:"
echo "  1. Edit $INSTALL_DIR/.env with your supabase keys"
echo "  2. Tell your agent: 'opt me into nod intros'"
echo "  3. Add your projects, needs, and offers"
echo "  4. Search the network: 'find someone who knows about X'"
echo ""
