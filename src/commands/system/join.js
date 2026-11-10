const GroupSettings = require('../../models/GroupSettings');
const { INTRO_MESSAGE, markIntroduced } = require('../../utils/introMessage');
const logger = require('../../utils/logger');

// Matches both the group invite link format (chat.whatsapp.com/CODE) and a
// bare invite code, in case the owner just pastes the code itself.
const INVITE_RE = /(?:chat\.whatsapp\.com\/)?([a-zA-Z0-9]{20,24})/i;

module.exports = {
  name: 'join',
  category: 'system',
  description: '/join <WhatsApp group invite link> - make the bot join a group and introduce itself (owner only)',
  ownerOnly: true,
  async execute({ client, msg, args }) {
    const input = args[0];
    if (!input) {
      return msg.reply('Usage: /join <WhatsApp group invite link>\nExample: /join https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv');
    }

    const match = INVITE_RE.exec(input);
    if (!match) {
      return msg.reply('⚠️ That doesn\'t look like a valid WhatsApp group invite link or code.');
    }
    const inviteCode = match[1];

    let groupId;
    try {
      groupId = await client.groupAcceptInvite(inviteCode);
    } catch (err) {
      logger.warn('join: failed to accept invite:', err.message);
      return msg.reply(`⚠️ Couldn't join that group - the link may be invalid, expired, or already used up.\n(${err.message})`);
    }

    // Don't rejoin a group we were previously auto-left from for a real
    // safety violation - leave again immediately instead of settling in.
    const existingSettings = await GroupSettings.findOne({ groupId });
    if (existingSettings?.autoLeftForSafety) {
      try {
        await client.groupLeave(groupId);
      } catch (err) {
        // best effort
      }
      return msg.reply('⚠️ That group was previously removed for a safety policy violation, so I left it again instead of settling in. Use /allowgroup to clear the flag first if this was a mistake.');
    }

    markIntroduced(groupId); // so group-participants.update doesn't send a second intro
    await GroupSettings.findOneAndUpdate({ groupId }, { introduced: true }, { upsert: true });
    try {
      await client.sendMessage(groupId, { text: INTRO_MESSAGE });
    } catch (err) {
      logger.warn('join: joined group but failed to send intro:', err.message);
    }

    let groupName = groupId;
    try {
      const metadata = await client.groupMetadata(groupId);
      groupName = metadata.subject || groupId;
    } catch (err) {
      // non-fatal - just fall back to the raw id in the confirmation below
    }

    await msg.reply(`✅ Joined "${groupName}" and introduced myself there.`);
  },
};
