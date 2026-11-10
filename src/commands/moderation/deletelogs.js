const { getTargetUser } = require('../../utils/mentions');
const { listDeletedLogs, getDeletedLogCount } = require('../../utils/deletedLogs');

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return date.toLocaleString([], { dateStyle: 'short', timeStyle: 'short' });
}

function getMediaLabel(mediaType) {
  switch (mediaType) {
    case 'image': return '🖼️ Image';
    case 'video': return '🎥 Video';
    case 'audio': return '🎵 Audio';
    case 'document': return '📄 Document';
    case 'sticker': return '😊 Sticker';
    case 'gif': return '🎞️ GIF';
    default: return '📎 Media';
  }
}

module.exports = {
  name: 'deletelogs',
  aliases: ['deletedlogs'],
  category: 'moderation',
  description: '/deletelogs [@user] [page] - view deleted messages for a user, or for the whole group if nobody is tagged (admins only)',
  adminOnly: true,
  groupOnly: true,
  async execute({ client, chat, msg, args }) {
    // No tag/reply = show everything logged for the whole group.
    const target = await getTargetUser(msg);
    const scope = target ? `@${target.split('@')[0]}` : 'this group';

    // The page number is the first small plain number in the args - a tagged
    // @user can sit in args[0], which used to break paging.
    const page = Number.parseInt(args.find((a) => /^\d{1,3}$/.test(a)) || '1', 10) || 1;
    const pageSize = 5;
    const logs = listDeletedLogs(chat.id._serialized, target, page, pageSize);
    const total = getDeletedLogCount(chat.id._serialized, target);

    if (!logs.length) {
      const hint = target ? '\nTip: send /deletelogs with nobody tagged to see everything logged in this group.' : '';
      return msg.reply(`🗑️ No deleted-message logs found for ${scope}.${hint}`, undefined, target ? { mentions: [target] } : {});
    }

    const header = `🗑️ **Deleted Messages — ${scope}**\nPage ${page}/${Math.max(1, Math.ceil(total / pageSize))}`;
    const lines = logs.map((entry, index) => {
      const number = (page - 1) * pageSize + index + 1;
      const time = formatTime(entry.timestamp);
      const id = entry.messageId ? `\n🆔 ID: ${entry.messageId}` : '';
      const who = `@${(entry.deletedBy || entry.userId || target || '').split('@')[0]}`;
      const from = target ? '' : `\nSent by: @${(entry.userId || '').split('@')[0]}`;
      if (entry.mediaType) {
        return `\n**${number}.** 🕐 ${time}${id}${from}\n${getMediaLabel(entry.mediaType)}\n📎 Deleted ${entry.mediaType} attached\nDeleted by: ${who}`;
      }
      const body = (entry.text || '').replace(/\s+/g, ' ').trim();
      return `\n**${number}.** 🕐 ${time}${id}${from}\n💬 "${body || '(empty message)'}"\nDeleted by: ${who}`;
    });

    const summary = `${header}\n${lines.join('\n')}`;
    const mentions = [...new Set(logs.flatMap((entry) => [entry.userId, entry.deletedBy]).concat(target ? [target] : []).filter((j) => typeof j === 'string' && j.includes('@')))];
    await msg.reply(summary, undefined, { mentions });

    for (const [index, entry] of logs.entries()) {
      if (!entry.mediaType || !entry.mediaBuffer) continue;
      const mediaIndex = (page - 1) * pageSize + index + 1;
      const attachText = `📎 Deleted ${entry.mediaType} #${mediaIndex} for @${(target || entry.userId || '').split('@')[0]}`;
      try {
        if (entry.mediaType === 'image') {
          await client.sendMessage(chat.id._serialized, { image: entry.mediaBuffer, caption: attachText, mimetype: entry.mediaMimeType || 'image/jpeg' });
        } else if (entry.mediaType === 'video') {
          await client.sendMessage(chat.id._serialized, { video: entry.mediaBuffer, caption: attachText, mimetype: entry.mediaMimeType || 'video/mp4' });
        } else if (entry.mediaType === 'audio') {
          await client.sendMessage(chat.id._serialized, { audio: entry.mediaBuffer, mimetype: entry.mediaMimeType || 'audio/mpeg', ptt: false });
        } else if (entry.mediaType === 'document') {
          await client.sendMessage(chat.id._serialized, { document: entry.mediaBuffer, fileName: `deleted-${entry.messageId || mediaIndex}.bin`, mimetype: entry.mediaMimeType || 'application/octet-stream', caption: attachText });
        } else if (entry.mediaType === 'sticker') {
          await client.sendMessage(chat.id._serialized, { sticker: entry.mediaBuffer, mimetype: entry.mediaMimeType || 'image/webp' });
        } else if (entry.mediaType === 'gif') {
          await client.sendMessage(chat.id._serialized, { video: entry.mediaBuffer, caption: attachText, mimetype: entry.mediaMimeType || 'video/mp4' });
        }
      } catch (err) {
        // The log is safely retained even if the attachment cannot be resent.
      }
    }
  },
};
