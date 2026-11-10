const XWatch = require('../../models/XWatch');
const { fetchLatestTweets, normalizeUsername } = require('../../utils/xTimeline');

module.exports = {
  name: 'xalert',
  aliases: ['twitteralert'],
  category: 'xalert',
  description: '/xalert add|remove|list <@user> - post here whenever an X account posts',
  adminOnly: true,
  groupOnly: true,
  async execute({ msg, chat, args, senderId }) {
    const sub = (args[0] || '').toLowerCase();
    const groupId = chat.id._serialized;

    if (sub === 'list') {
      const watches = await XWatch.find({ groupId });
      if (!watches.length) return msg.reply('No X accounts watched here yet. Add one: /xalert add @user');
      return msg.reply(`🐦 Watched X accounts:\n${watches.map((w, i) => `${i + 1}. @${w.username}`).join('\n')}`);
    }

    if (sub === 'remove') {
      const target = args.slice(1).join(' ').trim();
      if (!target) return msg.reply('Usage: /xalert remove <@user or number from /xalert list>');
      const watches = await XWatch.find({ groupId });
      const uname = normalizeUsername(target);
      const match = /^\d+$/.test(target) ? watches[parseInt(target, 10) - 1] : watches.find((w) => w.username === uname);
      if (!match) return msg.reply(`Couldn't find "${target}". Check /xalert list.`);
      await XWatch.deleteOne({ _id: match._id });
      return msg.reply(`✅ Stopped watching @${match.username}.`);
    }

    if (sub === 'add') {
      const username = normalizeUsername(args[1]);
      if (!username) return msg.reply('Usage: /xalert add <@user or x.com link>\nExample: /xalert add @elonmusk');

      if (await XWatch.findOne({ groupId, username })) return msg.reply(`Already watching @${username} here.`);

      let tweets;
      try {
        tweets = await fetchLatestTweets(username);
      } catch (err) {
        return msg.reply("⚠️ Couldn't reach X right now - try again shortly.");
      }
      if (!tweets.length) return msg.reply(`⚠️ Couldn't find posts for @${username}. Check the spelling (private accounts don't work).`);

      try {
        await XWatch.create({
          groupId,
          username,
          displayName: tweets[0].name || '',
          lastTweetId: tweets[0].id, // baseline now - only NEW posts alert
          addedBy: senderId,
        });
      } catch (err) {
        if (err.code === 11000) return msg.reply(`Already watching @${username} here.`);
        throw err;
      }
      return msg.reply(`✅ Now watching *@${username}*.\nI'll check about every 30 seconds and post here when they publish. The feed provider can affect delivery speed.`);
    }

    return msg.reply('Usage:\n/xalert add <@user or link>\n/xalert remove <@user or number>\n/xalert list');
  },
};
