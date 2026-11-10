const LINK_REGEX = /chat\.whatsapp\.com\/([a-zA-Z0-9]+)/gi;
const SCHEME_OR_WWW_REGEX = /\b(?:https?:\/\/|www\.)\S+/gi;
const COMMON_TLDS = [
  'com', 'net', 'org', 'io', 'co', 'me', 'ly', 'tv', 'gg', 'info', 'xyz',
  'app', 'link', 'click', 'us', 'uk', 'ca', 'de', 'ng', 'biz', 'shop',
  'online', 'site', 'live', 'club', 'vip', 'top', 'pro', 'dev', 'gov', 'edu', 'to', 'so',
];
const BARE_DOMAIN_REGEX = new RegExp(
  `\\b[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.(?:${COMMON_TLDS.join('|')})\\b(?:/\\S*)?`,
  'gi'
);

function extractInviteCodes(text) {
  if (!text) return [];
  return [...text.matchAll(LINK_REGEX)].map((m) => m[1].toLowerCase());
}

/** Strips scheme/www/path off a link (or a whitelist entry) down to a bare lowercase domain. */
function normalizeDomain(raw) {
  if (!raw) return '';
  let d = raw.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '');
  d = d.split(/[/?#\s]/)[0];
  d = d.replace(/^www\./, '');
  return d;
}

/** Every distinct domain mentioned in a message (chat.whatsapp.com excluded - that's handled via invite codes instead). */
function extractDomains(text) {
  if (!text) return [];
  const matches = [...text.matchAll(SCHEME_OR_WWW_REGEX), ...text.matchAll(BARE_DOMAIN_REGEX)];
  const domains = matches.map((m) => normalizeDomain(m[0])).filter(Boolean);
  return [...new Set(domains)].filter((d) => d !== 'chat.whatsapp.com');
}

function domainIsAllowed(domain, allowedDomains) {
  for (const allowed of allowedDomains) {
    if (domain === allowed || domain.endsWith(`.${allowed}`)) return true;
  }
  return false;
}

// A message trips antilink if it contains a WhatsApp group invite link whose
// code isn't whitelisted, OR any other link whose domain isn't whitelisted
// (a subdomain of a whitelisted domain also counts as whitelisted, e.g.
// whitelisting "tiktok.com" also allows "vm.tiktok.com"). Whitelist entries
// can be a bare invite code, a full invite link, a bare domain, or a full
// URL - all normalized down before comparing.
function containsBlockedLink(text, whitelist = []) {
  if (!text) return false;

  const allowedCodes = new Set(whitelist.map((entry) => extractInviteCodes(entry)[0]).filter(Boolean));
  const allowedDomains = new Set(whitelist.map((entry) => normalizeDomain(entry)).filter(Boolean));

  const inviteCodes = extractInviteCodes(text);
  if (inviteCodes.some((code) => !allowedCodes.has(code))) return true;

  return extractDomains(text).some((domain) => !domainIsAllowed(domain, allowedDomains));
}

module.exports = { extractInviteCodes, containsBlockedLink };
