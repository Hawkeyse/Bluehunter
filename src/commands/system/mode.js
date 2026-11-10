const BotConfig = require('../../models/BotConfig');

module.exports = {
  name: 'mode',
  category: 'system',
  description: '/mode public|private - who can use the bot globally. In private mode: /mode approve | /mode unapprove (run inside a group) | /mode list',
  ownerOnly: true,
  async execute({ msg, args, chat }) {
    const sub = (args[0] || '').toLowerCase();
    if (!['public', 'private', 'approve', 'unapprove', 'list'].includes(sub)) {
      return msg.reply('Usage: /mode public|private\nIn private mode: /mode approve (inside a group to allow it), /mode unapprove, /mode list');
    }

    const botConfig = await BotConfig.getOrCreate();

    if (sub === 'list') {
      const groups = botConfig.approvedGroups;
      return msg.reply(`Mode: *${botConfig.mode}*\nApproved groups (${groups.length}):\n${groups.length ? groups.join('\n') : '(none)'}`);
    }

    if (sub === 'approve' || sub === 'unapprove') {
      if (!chat || !chat.isGroup) return msg.reply(`Run /mode ${sub} inside the group you want to ${sub}.`);
      const groupId = chat.id._serialized;
      const has = botConfig.approvedGroups.includes(groupId);
      if (sub === 'approve') {
        if (has) return msg.reply('✅ This group is already approved.');
        botConfig.approvedGroups.push(groupId);
      } else {
        if (!has) return msg.reply('This group is not on the approved list.');
        botConfig.approvedGroups = botConfig.approvedGroups.filter((g) => g !== groupId);
      }
      await botConfig.save();
      return msg.reply(sub === 'approve' ? '✅ This group is now approved (works while the bot is in private mode).' : '🚫 This group was removed from the approved list.');
    }

    botConfig.mode = sub;

    // if switching to private from inside a group, auto-approve the current group
    if (sub === 'private' && chat && chat.isGroup && !botConfig.approvedGroups.includes(chat.id._serialized)) {
      botConfig.approvedGroups.push(chat.id._serialized);
    }

    await botConfig.save();
    await msg.reply(`✅ Bot mode set to *${sub}*.${sub === 'private' ? '\nRun /mode approve inside each other group you want to allow.' : ''}`);
  },
};
