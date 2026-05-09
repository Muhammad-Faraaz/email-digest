const Anthropic = require('@anthropic-ai/sdk');

function parseJsonFromText(text) {
  const trimmed = (text || '').trim();

  // Strip markdown code fences if present
  const cleaned = trimmed
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      throw new Error('Claude returned invalid JSON.');
    }
    return JSON.parse(cleaned.slice(start, end + 1));
  }
}

async function summariseEmails(emails) {
  if (!emails.length) {
    return {
      highlight: 'Inbox is clear - nothing new today.',
      stats: { total: 0, need_action: 0, fyi: 0 },
      emails: []
    };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('Missing ANTHROPIC_API_KEY environment variable.');
  }

  const client = new Anthropic({ apiKey });

  const sanitisedEmails = emails.map((e) => ({
    from: (e.from || '').slice(0, 100).replace(/[\u0000-\u001F\u007F]/g, ' '),
    subject: (e.subject || '').slice(0, 150).replace(/[\u0000-\u001F\u007F]/g, ' '),
    body: (e.body || e.snippet || '')
      .slice(0, 400)
      .replace(/[\u0000-\u001F\u007F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }));

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2000,
    system:
      'You are an email assistant. Given a list of emails, return ONLY valid JSON with no markdown, no code fences, no explanation — just the raw JSON object. Use this exact shape: {"highlight":"One sentence - the most important thing from today","stats":{"total":0,"need_action":0,"fyi":0},"emails":[{"from":"Name or address","subject":"Subject line","summary":"1-2 sentence plain English summary","tag":"urgent | action | info | fyi"}]}. The tag field must be exactly one of: urgent, action, info, fyi.',
    messages: [
      {
        role: 'user',
        content: `Summarise these emails:\n${JSON.stringify(sanitisedEmails, null, 2)}`
      }
    ]
  });

  const text = response.content
    .filter((chunk) => chunk.type === 'text')
    .map((chunk) => chunk.text)
    .join('\n');

  return parseJsonFromText(text);
}

module.exports = {
  summariseEmails
};