const { isOwner, resolveNumber } = require('../../utils/permissions');
const { getBotJid, getBotLid } = require('../../utils/waCompat');

function normalizeCode(raw) {
  return (raw || '').replace(/[^\d]/g, '');
}

function normalizeId(id) {
  return (id || '').split('@')[0].split(':')[0];
}

const MAX_PER_RUN = 20; // safety cap per run
const BATCH_SIZE = 5; // members removed per request
const BATCH_DELAY_MS = 4000; // pause between batches

module.exports = {
  name: 'kickcountry',
  category: 'moderation',
  description:
    '/kickcountry +91 [confirm] - kick every group member whose number starts with a country code. Shows a preview first; re-run with "confirm" to actually remove them.',
  adminOnly: true,
  groupOnly: true,
  requiresBotAdmin: true,
  async execute({ client, msg, chat, args }) {
    const code = normalizeCode(args[0]);
    if (!code) return msg.reply('Usage: /kickcountry +91 [confirm]');

    const confirmed = (args[1] || '').toLowerCase() === 'confirm';

    const botCandidates = [getBotJid(client), getBotLid(client)].filter(Boolean).map(normalizeId);

    // Resolution is best-effort: WhatsApp now hides most participants behind
    // opaque @lid ids (see utils/permissions.js), so some members' real
    // numbers simply aren't resolvable and can never be matched here -
    // that's a WhatsApp limitation, not a bug in this command.
    const matches = [];
    await Promise.all(
      chat.participants.map(async (p) => {
        if (p.isAdmin || p.isSuperAdmin) return; // never touch admins
        const serialized = p.id._serialized;
        if (botCandidates.includes(normalizeId(serialized))) return;
        if (await isOwner(client, serialized)) return;

        const number = await resolveNumber(client, serialized);
        if (number && number.startsWith(code)) {
          matches.push({ id: serialized, number });
        }
      })
    );

    if (matches.length === 0) {
      return msg.reply(
        `No kickable members found with country code +${code}. (Admins, the bot, and the owner are always excluded - some other members may be unresolvable due to WhatsApp's @lid privacy ids.)`
      );
    }

    if (!confirmed) {
      const preview = matches.slice(0, 20).map((m) => `+${m.number}`).join('\n');
      const more = matches.length > 20 ? `\n...and ${matches.length - 20} more` : '';
      return msg.reply(
        `⚠️ This would kick ${matches.length} member(s) matching +${code}:\n${preview}${more}\n\nRun /kickcountry ${args[0]} confirm to actually remove them.`
      );
    }

    // Removing lots of people in one burst is one of the fastest ways to get
    // a number restricted (same reasoning as MAX_PER_RUN in removeinactive.js):
    // cap each run and remove in small, spaced-out batches.
    const ids = matches.slice(0, MAX_PER_RUN).map((m) => m.id);
    let ok = 0;
    try {
      for (let i = 0; i < ids.length; i += BATCH_SIZE) {
        const result = await chat.removeParticipants(ids.slice(i, i + BATCH_SIZE));
        ok += Array.isArray(result) ? result.filter((r) => r.status === '200').length : Math.min(BATCH_SIZE, ids.length - i);
        if (i + BATCH_SIZE < ids.length) await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
      }
      const left = matches.length - ids.length;
      await chat.sendMessage(
        `👢 Kicked ${ok}/${ids.length} member(s) matching +${code}.` +
          (left > 0 ? `\n${left} more match - run the command again in a little while (safety cap of ${MAX_PER_RUN} per run).` : '')
      );
    } catch (err) {
      await msg.reply(`❌ Failed to remove members matching +${code}: ${err.message}`);
    }
  },
};
