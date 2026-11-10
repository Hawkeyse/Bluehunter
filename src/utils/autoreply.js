// Very small canned-response system used by /autoreply on.
// Extend RULES with your own keyword -> reply pairs as needed.

const RULES = [
  { match: /\b(hi|hello|hey)\b/i, reply: '👋 Hey! How can I help?' },
  { match: /\b(thanks|thank you|thx)\b/i, reply: 'You\'re welcome! 🙌' },
  { match: /\b(help|support)\b/i, reply: 'Type /help to see everything I can do, or /support to reach the Bluehunter support group.' },
];

function getAutoReply(body) {
  if (!body) return null;
  const rule = RULES.find((r) => r.match.test(body));
  return rule ? rule.reply : null;
}

module.exports = { getAutoReply };
