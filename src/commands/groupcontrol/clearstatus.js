const { getTrackedGroupStatuses, forgetTrackedGroupStatus } = require('../../utils/groupStatusStore');
const { isGroupAdmin, isBotAdmin } = require('../../utils/permissions');
const logger = require('../../utils/logger');

module.exports = {
  name: 'clearstatus',
  category: 'groupcontrol',
  description: '/clearstatus - delete tracked non-admin group Status posts',
  adminOnly: true,
  groupOnly: true,
  requiresBotAdmin: true,
  async execute({ client, msg, chat }) {
    if (!isBotAdmin(chat, client)) {
      return msg.reply('⚠️ I need to be a group admin to delete members’ Status posts.');
    }

    const groupId = chat.id._serialized;
    const statuses = getTrackedGroupStatuses(groupId);
    if (!statuses.length) {
      return msg.reply(
        'I have no recent group Status posts to clear. I can only delete Status posts WhatsApp has delivered to Bluehunter since it started.'
      );
    }

    let deleted = 0;
    let adminsKept = 0;
    let failed = 0;
    let unknownAuthor = 0;

    for (const status of statuses) {
      if (!status.authorId) {
        unknownAuthor++;
        continue;
      }

      if (await isGroupAdmin(client, chat, status.authorId)) {
        adminsKept++;
        continue;
      }

      try {
        await client.sendMessage(groupId, { delete: status.key });
        deleted++;
        forgetTrackedGroupStatus(groupId, status.key.id);
      } catch (err) {
        failed++;
        logger.warn(`Failed to delete tracked group Status ${status.key.id} in ${groupId}: ${err.message}`);
      }
    }

    const summary = `🧹 Deleted ${deleted} non-admin Status post${deleted === 1 ? '' : 's'}; kept ${adminsKept} admin post${adminsKept === 1 ? '' : 's'}.`;
    const details = [];
    if (failed) details.push(`⚠️ WhatsApp rejected ${failed} deletion${failed === 1 ? '' : 's'}.`);
    if (unknownAuthor) details.push(`⚠️ Kept ${unknownAuthor} post${unknownAuthor === 1 ? '' : 's'} because the author could not be verified.`);
    details.push('Only Status posts delivered to Bluehunter since startup can be cleared.');
    return msg.reply([summary, ...details].join('\n'));
  },
};
