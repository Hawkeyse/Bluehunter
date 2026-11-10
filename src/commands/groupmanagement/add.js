const { numberToJid } = require('../../utils/mentions');

module.exports = {
  name: 'add',
  category: 'groupmanagement',
  description: '/add 233xxxxxxxxx - add member (full international format, no leading 0 or +)',
  adminOnly: true,
  groupOnly: true,
  requiresBotAdmin: true,
  async execute({ client, msg, chat, args }) {
    if (!args[0]) {
      return msg.reply('Usage: /add 233501234567\n(full international format - country code first, no leading 0 or +)');
    }

    const jid = numberToJid(args[0]);

    try {
      const [check] = await client.onWhatsApp(jid);
      if (!check || !check.exists) {
        return msg.reply(
          `❌ ${args[0]} doesn't look like it's registered on WhatsApp.\n` +
          `Make sure it's full international format - country code first, no leading 0 or +.`
        );
      }

      const result = await client.groupParticipantsUpdate(chat.id._serialized, [check.jid], 'add');
      const entry = Array.isArray(result) ? result[0] : null;
      const status = entry?.status;

      if (!status || status === '200') {
        return msg.reply(`✅ Added ${args[0]} to the group.`);
      }
      if (status === '403') {
        return msg.reply(`⚠️ ${args[0]}'s privacy settings block direct adds. WhatsApp should send them an invite link instead.`);
      }
      if (status === '408') {
        return msg.reply(`❌ ${args[0]} isn't reachable on WhatsApp right now.`);
      }
      if (status === '409') {
        return msg.reply(`ℹ️ ${args[0]} is already in this group.`);
      }
      return msg.reply(`❌ Failed to add ${args[0]} (WhatsApp status ${status}).`);
    } catch (err) {
      // WhatsApp is actively restricting this account from reaching out to
      // numbers it has no prior relationship with - common after a ban/reactivation.
      // Fall back to a shareable invite link instead of a dead-end error.
      if ((err.message || '').includes('account_reachout_restricted')) {
        try {
          const code = await client.groupInviteCode(chat.id._serialized);
          return msg.reply(
            `⚠️ WhatsApp is currently restricting this bot account from adding new numbers directly ` +
            `(likely temporary, tied to the recent ban/reactivation).\n\n` +
            `Share this invite link with ${args[0]} instead:\nhttps://chat.whatsapp.com/${code}`
          );
        } catch (linkErr) {
          return msg.reply(
            `⚠️ WhatsApp is restricting this account from adding new numbers right now, and I couldn't ` +
            `generate an invite link either (${linkErr.message}). Try again later, or share the group ` +
            `invite manually from your own WhatsApp.`
          );
        }
      }

      await msg.reply(`❌ Failed to add that number: ${err.message}`);
    }
  },
};
