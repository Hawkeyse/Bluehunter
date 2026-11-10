const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const ReminderPost = require('../../models/ReminderPost');
const rp = require('../../utils/reminderPosts');

const USAGE =
  'Reminder posts - scheduled posts in UTC, text or image/video.\n\n' +
  '/remindpost add <HH:mm> [days] <text>\n' +
  '  e.g. /remindpost add 16:00 Read the rules!\n' +
  '  e.g. /remindpost add 16:00 mon,thu Weekly meeting tonight\n' +
  '  days: daily (default), weekdays, weekends, or mon,tue,wed,thu,fri,sat,sun\n' +
  '  For media: send the image/video with the command as the caption, or reply to the image/video with the command.\n' +
  '/remindpost list\n' +
  '/remindpost remove <number>\n' +
  '/remindpost on <number> | off <number>\n' +
  '/remindpost test <number> - post it right now\n' +
  '/remindpost tagall <number> on|off - mention everyone when it posts';

function getMediaTarget(raw) {
  const m = raw.message;
  if (m?.imageMessage || m?.videoMessage) return raw;
  const ci = m?.extendedTextMessage?.contextInfo;
  const quoted = ci?.quotedMessage;
  if (quoted?.imageMessage || quoted?.videoMessage) {
    return { key: { remoteJid: raw.key.remoteJid, id: ci.stanzaId, participant: ci.participant }, message: quoted };
  }
  return null;
}

async function pickPost(groupId, numRaw) {
  const n = parseInt(numRaw, 10);
  if (!n || n < 1) return null;
  const posts = await ReminderPost.find({ groupId }).sort({ createdAt: 1 });
  return posts[n - 1] || null;
}

module.exports = {
  name: 'remindpost',
  aliases: ['reminderpost', 'rpost'],
  category: 'groupcontrol',
  description: '/remindpost add <HH:mm> [days] <text> | list | remove <n> | on/off <n> | test <n> - scheduled text/image/video posts (UTC)',
  adminOnly: true,
  groupOnly: true,
  async execute({ client, chat, args, msg, senderId }) {
    const groupId = chat.id._serialized;
    const sub = (args[0] || '').toLowerCase();

    if (sub === 'list') {
      const posts = await ReminderPost.find({ groupId }).sort({ createdAt: 1 });
      if (!posts.length) return chat.sendMessage('No reminder posts yet. Add one with /remindpost add <HH:mm> <text>');
      const lines = posts.map((p, i) => {
        const preview = (p.text || '').replace(/\s+/g, ' ').slice(0, 50) || '(no text)';
        return `${i + 1}. ${p.enabled ? '✅' : '⏸️'} ${rp.describeSchedule(p)}${p.mediaType ? ` [${p.mediaType}]` : ''}${p.tagAll ? ' [tag all]' : ''}\n   ${preview}`;
      });
      return chat.sendMessage(`⏰ Reminder posts (UTC):\n\n${lines.join('\n')}`);
    }

    if (sub === 'add') {
      const body = msg.body || '';
      // Keep line breaks in the text: take everything after "add <time> [days]" from the raw message.
      const m = /^\S+\s+add\s+(\S+)\s*([\s\S]*)$/i.exec(body.trim());
      if (!m) return msg.reply(USAGE);
      const t = rp.checkTime(m[1]);
      if (t.err) return msg.reply(t.err);

      let rest = m[2];
      let days = [];
      const firstWord = rest.split(/\s+/)[0];
      if (firstWord && rp.isDaysToken(firstWord)) {
        days = rp.parseDays(firstWord);
        rest = rest.slice(firstWord.length);
      }
      const text = rp.cleanText(rest);
      if (text.length > rp.MAX_TEXT) return msg.reply(`Keep the text under ${rp.MAX_TEXT} characters.`);

      const target = getMediaTarget(msg._raw);
      if (!text && !target) return msg.reply('Add some text, or attach/reply to an image or video.\n\n' + USAGE);
      if ((await rp.countForGroup(groupId)) >= rp.MAX_PER_GROUP) return msg.reply(`This group already has ${rp.MAX_PER_GROUP} reminder posts. Remove one first.`);

      let media = {};
      if (target) {
        try {
          const buffer = await downloadMediaMessage(target, 'buffer', {});
          media = await rp.saveMedia(buffer);
        } catch (err) {
          return msg.reply(`❌ Could not use that media: ${err.message}`);
        }
      }

      const fields = { groupId, text, time: t.v, days, createdBy: senderId, ...media };
      const post = await ReminderPost.create({ ...fields, lastPostedDate: rp.initialPostedDate(fields) });
      const total = await rp.countForGroup(groupId);
      return chat.sendMessage(`⏰ Reminder post #${total} saved: ${rp.describeSchedule(post)}${post.mediaType ? ` with ${post.mediaType}` : ''}.\nTest it with /remindpost test ${total}`);
    }

    if (['remove', 'delete', 'on', 'off', 'test', 'tagall'].includes(sub)) {
      const post = await pickPost(groupId, args[1]);
      if (!post) return msg.reply(`Pick a post number from /remindpost list, e.g. /remindpost ${sub} 1`);

      if (sub === 'remove' || sub === 'delete') {
        await rp.deleteMedia(post.mediaFile);
        await post.deleteOne();
        return chat.sendMessage('🗑️ Reminder post removed.');
      }
      if (sub === 'on' || sub === 'off') {
        post.enabled = sub === 'on';
        post.lastPostedDate = post.enabled ? rp.initialPostedDate(post) : post.lastPostedDate;
        await post.save();
        return chat.sendMessage(`Reminder post ${sub === 'on' ? 'enabled ✅' : 'paused ⏸️'}.`);
      }
      if (sub === 'tagall') {
        const v = (args[2] || '').toLowerCase();
        if (v !== 'on' && v !== 'off') return msg.reply('Usage: /remindpost tagall <number> on|off');
        post.tagAll = v === 'on';
        await post.save();
        return chat.sendMessage(`Tag everyone is now ${v.toUpperCase()} for that post.`);
      }
      try {
        await rp.sendPost(client, post);
      } catch (err) {
        return msg.reply(`❌ Could not post it: ${err.message}`);
      }
      return;
    }

    return msg.reply(USAGE);
  },
};
