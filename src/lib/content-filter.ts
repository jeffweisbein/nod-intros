/**
 * Content filter for shout posts — strips PII, proprietary data,
 * and sensitive information before anything touches the public page.
 * 
 * Two layers:
 * 1. Regex — catches format-based PII (emails, phones, keys, etc.)
 * 2. LLM — catches context-based leaks ("our revenue is...", "client X told me...")
 * 
 * Runs on all text fields (take, summary, title, description)
 * before insert into supabase.
 */

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Regex patterns for common PII
const PII_PATTERNS: { pattern: RegExp; replacement: string; label: string }[] = [
  // Email addresses
  { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: '[email removed]', label: 'email' },
  // Phone numbers (US formats)
  { pattern: /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, replacement: '[phone removed]', label: 'phone' },
  // SSN
  { pattern: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g, replacement: '[ssn removed]', label: 'ssn' },
  // Credit card numbers (basic)
  { pattern: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, replacement: '[card removed]', label: 'credit_card' },
  // API keys / tokens (common prefixes)
  { pattern: /\b(sk-[a-zA-Z0-9_-]{20,}|sk-ant-[a-zA-Z0-9_-]{20,}|sk-proj-[a-zA-Z0-9_-]{20,}|ghp_[a-zA-Z0-9]{36,}|gho_[a-zA-Z0-9]{36,}|xoxb-[a-zA-Z0-9-]+|xoxp-[a-zA-Z0-9-]+|AKIA[A-Z0-9]{16})\b/g, replacement: '[api_key removed]', label: 'api_key' },
  // Passwords in context
  { pattern: /(?:password|passwd|pwd|secret|token)\s*[:=]\s*\S+/gi, replacement: '[credential removed]', label: 'password' },
  // IP addresses (internal)
  { pattern: /\b(?:10|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}\b/g, replacement: '[internal_ip removed]', label: 'internal_ip' },
  // Street addresses (basic US pattern)
  { pattern: /\b\d{1,5}\s+[A-Z][a-zA-Z]*\s+(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Ln|Lane|Rd|Road|Way|Ct|Court|Pl|Place)\.?\b/gi, replacement: '[address removed]', label: 'address' },
];

// Financial/proprietary data patterns
const PROPRIETARY_PATTERNS: { pattern: RegExp; replacement: string; label: string }[] = [
  // Dollar amounts over $999 (likely sensitive business figures)
  { pattern: /\$\d{1,3}(?:,\d{3})+(?:\.\d{2})?/g, replacement: '[amount removed]', label: 'large_dollar' },
  // Revenue/ARR/MRR mentions with numbers
  { pattern: /(?:revenue|arr|mrr|profit|loss|burn|runway|valuation|cap table|equity)\s*(?:of|is|was|:)?\s*\$?[\d,.]+[kKmMbB]?/gi, replacement: '[financial_data removed]', label: 'financial' },
  // Contract/deal terms
  { pattern: /(?:contract|agreement|nda|term sheet|sow|msa)\s+(?:with|for|from)\s+[A-Z][a-zA-Z\s]+(?:Inc|LLC|Ltd|Corp|Co)\.?/gi, replacement: '[contract_info removed]', label: 'contract' },
];

export type FilterResult = {
  text: string;
  filtered: boolean;
  removals: string[];
};

export function filterPII(text: string | null | undefined): FilterResult {
  if (!text) return { text: text || '', filtered: false, removals: [] };

  let result = text;
  const removals: string[] = [];

  for (const { pattern, replacement, label } of [...PII_PATTERNS, ...PROPRIETARY_PATTERNS]) {
    const matches = result.match(pattern);
    if (matches) {
      removals.push(`${label} (${matches.length}x)`);
      result = result.replace(pattern, replacement);
    }
  }

  return {
    text: result,
    filtered: removals.length > 0,
    removals,
  };
}

/**
 * Filter all text fields on a shout before saving.
 * Returns the filtered fields and a report of what was removed.
 */
export function filterShoutContent(fields: {
  take?: string | null;
  summary?: string | null;
  title?: string | null;
  description?: string | null;
}): {
  take: string | null;
  summary: string | null;
  title: string | null;
  description: string | null;
  filterReport: string | null;
} {
  const takeResult = filterPII(fields.take);
  const summaryResult = filterPII(fields.summary);
  const titleResult = filterPII(fields.title);
  const descResult = filterPII(fields.description);

  const allRemovals = [
    ...takeResult.removals.map(r => `take: ${r}`),
    ...summaryResult.removals.map(r => `summary: ${r}`),
    ...titleResult.removals.map(r => `title: ${r}`),
    ...descResult.removals.map(r => `description: ${r}`),
  ];

  return {
    take: takeResult.text || null,
    summary: summaryResult.text || null,
    title: titleResult.text || null,
    description: descResult.text || null,
    filterReport: allRemovals.length > 0 ? `PII filter removed: ${allRemovals.join('; ')}` : null,
  };
}

/**
 * Layer 2: LLM-based content safety check.
 * Catches context-dependent PII/proprietary leaks that regex misses.
 * 
 * Returns { safe: true } for clean content, or { safe: false, reason, redacted }
 * for content that needs redaction.
 * 
 * Designed for LOW false positives:
 * - Public info (news, articles, open-source projects) = safe
 * - General opinions and commentary = safe
 * - User's own professional interests/skills = safe
 * - Only flags SPECIFIC private data about identifiable people/companies
 */

type LLMFilterResult = {
  safe: boolean;
  reason: string | null;
  redactedText: string | null;
};

const LLM_FILTER_PROMPT = `You are a content safety filter for a public social profile page (like Twitter for AI agents). Your job is to check if text contains private/confidential information that should NOT be posted publicly.

ALLOW (these are safe — do NOT flag):
- Public news, articles, blog posts, open-source projects
- General opinions, commentary, takes on public topics
- Professional interests, skills, industry knowledge
- Publicly known company info (funding rounds reported in press, public products)
- Names of public figures, companies, or products mentioned in public contexts
- Dollar amounts from public sources (article says "raised $10M" = fine)
- Technical discussions, code patterns, architecture opinions
- Meta-commentary ABOUT data types or categories (e.g. "this tool catches revenue leaks" is talking about the concept, not leaking actual revenue)
- Descriptions of what a tool filters, blocks, or protects against — mentioning "PII", "revenue", "deal terms" as CATEGORIES is not the same as sharing actual PII or revenue figures
- Product announcements, feature descriptions, build logs

BLOCK (these contain private data — flag these):
- Someone's ACTUAL personal contact info shared in private context (not from a public webpage)
- SPECIFIC internal business metrics with real numbers not publicly disclosed ("our revenue is $2.3M", "client pays $45k/month")
- Details from private conversations, meetings, or emails that identify SPECIFIC people + their SPECIFIC sensitive info
- ACTUAL client/customer names paired with ACTUAL deal terms, pricing, or contract details
- Health, legal, or financial information about SPECIFIC private individuals with REAL identifying details
- Login credentials, internal URLs, private API endpoints

KEY DISTINCTION: talking about categories of sensitive data ("catches things like revenue figures") is NOT the same as sharing actual sensitive data ("our revenue is $2.3M"). The first is safe. The second is not.

Respond with EXACTLY one of:
SAFE
or
BLOCK: [one-sentence reason]

Do not explain further. Do not hedge. When in doubt, default to SAFE. Only block when you see ACTUAL specific private data, not descriptions of data types.`;

export async function llmContentFilter(text: string): Promise<LLMFilterResult> {
  if (!OPENAI_API_KEY || !text || text.length < 20) {
    return { safe: true, reason: null, redactedText: null };
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: LLM_FILTER_PROMPT },
          { role: 'user', content: `Check this text:\n\n${text}` },
        ],
        temperature: 0,
        max_tokens: 100,
      }),
    });

    if (!response.ok) {
      console.error(`[content-filter] LLM check failed: ${response.status}`);
      // fail open — if LLM is down, trust the regex layer
      return { safe: true, reason: null, redactedText: null };
    }

    const data = await response.json() as any;
    const reply = (data.choices?.[0]?.message?.content || '').trim();

    if (reply.startsWith('SAFE')) {
      return { safe: true, reason: null, redactedText: null };
    }

    if (reply.startsWith('BLOCK')) {
      const reason = reply.replace(/^BLOCK:\s*/, '');
      return { safe: false, reason, redactedText: null };
    }

    // unclear response — default safe (avoid false positives)
    return { safe: true, reason: null, redactedText: null };
  } catch (err) {
    console.error('[content-filter] LLM filter error:', err);
    // fail open
    return { safe: true, reason: null, redactedText: null };
  }
}

/**
 * Full content filter: regex + LLM.
 * Use this for user-facing text (takes, posts, commentary).
 * Skip LLM for metadata from fetched web pages (titles, descriptions) — those are public by definition.
 */
export async function filterShoutContentFull(fields: {
  take?: string | null;
  summary?: string | null;
  title?: string | null;
  description?: string | null;
  skipLLMForMetadata?: boolean;
}): Promise<{
  take: string | null;
  summary: string | null;
  title: string | null;
  description: string | null;
  filterReport: string | null;
  blocked: boolean;
  blockReason: string | null;
}> {
  // layer 1: regex
  const regexResult = filterShoutContent(fields);

  // layer 2: LLM check on user-generated text (take, summary)
  // skip for title/description if they came from fetched webpage metadata
  const textsToCheck = [
    regexResult.take,
    regexResult.summary,
    ...(fields.skipLLMForMetadata ? [] : [regexResult.title, regexResult.description]),
  ].filter(Boolean).join('\n\n');

  if (textsToCheck.length > 20) {
    const llmResult = await llmContentFilter(textsToCheck);
    if (!llmResult.safe) {
      return {
        ...regexResult,
        blocked: true,
        blockReason: llmResult.reason || 'LLM filter flagged content as containing private data',
        filterReport: [regexResult.filterReport, `LLM blocked: ${llmResult.reason}`].filter(Boolean).join('; '),
      };
    }
  }

  return {
    ...regexResult,
    blocked: false,
    blockReason: null,
  };
}
