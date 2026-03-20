/**
 * Context extraction pipeline for nod intros.
 * 
 * Takes natural language from conversations and extracts structured
 * profile data: needs, offers, projects, interests, expertise.
 * 
 * Two modes:
 * 1. keyword-based (fast, no API call) — catches explicit signals
 * 2. LLM-based (better, uses gpt-4o-mini) — understands context
 */

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

export interface ExtractedContext {
  needs: { description: string; urgency: "low" | "medium" | "high"; category: string }[];
  offers: { description: string; category: string }[];
  projects: { name: string; description: string; stage: string }[];
  interests: string[];
  expertise: string[];
  industries: string[];
}

// keyword patterns that signal needs
const NEED_PATTERNS = [
  /i(?:'m| am) looking for (.+?)(?:\.|$)/gi,
  /i need (?:help with |a |an )?(.+?)(?:\.|$)/gi,
  /looking for (?:someone|a person|anybody) (?:who|that) (.+?)(?:\.|$)/gi,
  /anyone know (?:a |an )?(.+?)(?:\?|$)/gi,
  /i could use (.+?)(?:\.|$)/gi,
  /hiring (?:a |an )?(.+?)(?:\.|$)/gi,
];

// keyword patterns that signal offers
const OFFER_PATTERNS = [
  /i(?:'m| am) (?:really )?good at (.+?)(?:\.|$)/gi,
  /i can help with (.+?)(?:\.|$)/gi,
  /i(?:'ve| have) (?:years of )?experience (?:in |with )(.+?)(?:\.|$)/gi,
  /my expertise is (?:in )?(.+?)(?:\.|$)/gi,
  /i specialize in (.+?)(?:\.|$)/gi,
  /i offer (.+?)(?:\.|$)/gi,
];

// keyword patterns that signal projects
const PROJECT_PATTERNS = [
  /i(?:'m| am) (?:currently )?(?:building|working on|developing|creating) (.+?)(?:\.|$)/gi,
  /i(?:'ve| have) been (?:building|working on) (.+?)(?:\.|$)/gi,
  /my (?:current )?(?:project|startup|company|app|product) (?:is |called )?(.+?)(?:\.|$)/gi,
  /just launched (.+?)(?:\.|$)/gi,
];

function extractKeyword(text: string): ExtractedContext {
  const result: ExtractedContext = {
    needs: [],
    offers: [],
    projects: [],
    interests: [],
    expertise: [],
    industries: [],
  };

  for (const pattern of NEED_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const desc = match[1].trim();
      if (desc.length > 5 && desc.length < 200) {
        result.needs.push({ description: desc, urgency: "medium", category: "general" });
      }
    }
  }

  for (const pattern of OFFER_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const desc = match[1].trim();
      if (desc.length > 3 && desc.length < 200) {
        result.offers.push({ description: desc, category: "general" });
      }
    }
  }

  for (const pattern of PROJECT_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const desc = match[1].trim();
      if (desc.length > 3 && desc.length < 200) {
        result.projects.push({ name: desc.split(/\s+/).slice(0, 4).join(" "), description: desc, stage: "building" });
      }
    }
  }

  return result;
}

async function extractLLM(text: string): Promise<ExtractedContext> {
  if (!OPENAI_API_KEY) return extractKeyword(text);

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
            content: `Extract structured profile data from conversation text for a professional networking tool. Return valid JSON only.

Extract:
- needs: things the person is looking for (skills, connections, advice, tools)
- offers: things they can provide (expertise, connections, resources)
- projects: what they're currently working on
- interests: topics they care about
- expertise: areas they're skilled in
- industries: sectors they work in

Rules:
- Only extract what's explicitly stated or strongly implied
- Keep descriptions concise (under 100 chars)
- Omit any field with no data (empty array)
- Never include names, emails, or identifying info
- If nothing relevant is found, return all empty arrays

JSON schema:
{
  "needs": [{"description": string, "urgency": "low"|"medium"|"high", "category": string}],
  "offers": [{"description": string, "category": string}],
  "projects": [{"name": string, "description": string, "stage": "idea"|"building"|"launched"|"growing"}],
  "interests": [string],
  "expertise": [string],
  "industries": [string]
}`,
          },
          { role: "user", content: text },
        ],
        temperature: 0,
        max_tokens: 500,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) return extractKeyword(text);
    const data = (await response.json()) as any;
    const content = data.choices?.[0]?.message?.content;
    if (!content) return extractKeyword(text);

    const parsed = JSON.parse(content);
    return {
      needs: parsed.needs || [],
      offers: parsed.offers || [],
      projects: parsed.projects || [],
      interests: parsed.interests || [],
      expertise: parsed.expertise || [],
      industries: parsed.industries || [],
    };
  } catch {
    return extractKeyword(text);
  }
}

/**
 * Extract context from text. Uses LLM when available, falls back to keywords.
 */
export async function extractContext(text: string, useLLM: boolean = true): Promise<ExtractedContext> {
  if (useLLM && OPENAI_API_KEY) {
    return extractLLM(text);
  }
  return extractKeyword(text);
}

/**
 * Check if text contains any signals worth extracting.
 * Fast check to avoid unnecessary LLM calls.
 */
export function hasContextSignals(text: string): boolean {
  const lower = text.toLowerCase();
  const signals = [
    "looking for", "i need", "help with", "hiring",
    "i'm building", "working on", "my project", "just launched",
    "good at", "can help", "experience in", "specialize in",
    "interested in", "my expertise",
  ];
  return signals.some(s => lower.includes(s));
}
