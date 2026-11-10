const { getTargetUser } = require('../../utils/mentions');
const { getRecentMessages, recordDeletedMessage } = require('../../utils/deletedLogs');
const { isBotAdmin } = require('../../utils/permissions');

module.exports = {
  name: 'clear',
  category: 'chatcontrol',
  description: '/clear [@user] <count> - delete recent messages from a user, or clear bot-side chat history',
  adminOnly: true,
  groupOnly: true,
  async execute({ client, msg, chat, args, senderId }) {
    const target = await getTargetUser(msg);
    if (target || args.some((arg) => /^\d+$/.test(arg))) {
      const countArg = args.find((arg) => /^\d+$/.test(arg));
      const count = Number.parseInt(countArg || '', 10);
      if (!target || !Number.isInteger(count) || count < 1 || count > 50) {
        return msg.reply('Usage: /clear @user <1-50>\nYou can also reply to one of their messages. I can only delete messages I have tracked since startup.');
      }
      if (!isBotAdmin(chat, client)) return msg.reply('⚠️ I need to be a group admin to delete other members’ messages.');

      const entries = getRecentMessages(chat.id._serialized, target, count);
      if (!entries.length) return msg.reply('I have no recent messages from that user to delete.');

      let deleted = 0;
      let failed = 0;
      for (const entry of entries) {
        try {
          await client.sendMessage(chat.id._serialized, { delete: entry.key });
          recordDeletedMessage({
            ...entry,
            deletedBy: senderId,
          });
          deleted++;
        } catch (err) {
          failed++;
        }
      }

      const result = `🧹 Deleted ${deleted} of ${entries.length} message${entries.length === 1 ? '' : 's'} from @${target.split('@')[0]}.`;
      return msg.reply(failed ? `${result}\n⚠️ WhatsApp rejected ${failed}; make sure I am a group admin.` : result, undefined, { mentions: [target] });
    }

    try {
      await chat.clearMessages();
      await msg.reply('🧹 Chat history cleared (on the bot\'s side).');
    } catch (err) {
      await msg.reply(`❌ Failed to clear messages: ${err.message}`);
    }
  },
};
