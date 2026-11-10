const YoutubeWatch = require('../../models/YoutubeWatch');
const { resolveChannelId, fetchLatestVideos, describePostingFrequency, fetchChannelStats } = require('../../utils/youtubeRss');

module.exports = {
  name: 'ytalert',
  aliases: ['youtubealert'],
  category: 'youtube',
  description: '/ytalert add|remove|list <channel> - post an alert here whenever a YouTube channel uploads',
  adminOnly: true,
  groupOnly: true,
  async execute({ msg, chat, args, senderId }) {
    const sub = (args[0] || '').toLowerCase();
    const groupId = chat.id._serialized;

    if (sub === 'list') {
      const watches = await YoutubeWatch.find({ groupId });
      if (!watches.length) return msg.reply('No YouTube channels are being watched in this group yet. Add one: /ytalert add <channel>');
      const list = watches.map((w, i) => `${i + 1}. ${w.channelTitle || w.channelId}`).join('\n');
      return msg.reply(`📺 Watched channels in this group:\n${list}`);
    }

    if (sub === 'remove') {
      const target = args.slice(1).join(' ').trim();
      if (!target) return msg.reply('Usage: /ytalert remove <channel name, or its number from /ytalert list>');

      const watches = await YoutubeWatch.find({ groupId });
      // Accept either the list number (from /ytalert list) or a name/id match,
      // so people don't have to paste the exact channel URL again just to remove it.
      const byIndex = /^\d+$/.test(target) ? watches[parseInt(target, 10) - 1] : null;
      const byName = watches.find(
        (w) => w.channelId === target || (w.channelTitle || '').toLowerCase() === target.toLowerCase()
      );
      const match = byIndex || byName;

      if (!match) return msg.reply(`Couldn't find a watched channel matching "${target}". Check /ytalert list.`);
      await YoutubeWatch.deleteOne({ _id: match._id });
      return msg.reply(`✅ Stopped watching ${match.channelTitle || match.channelId}.`);
    }

    if (sub === 'add') {
      const input = args.slice(1).join(' ').trim();
      if (!input) return msg.reply('Usage: /ytalert add <channel URL, @handle, or channel ID>\nExample: /ytalert add @MrBeast');

      const resolved = await resolveChannelId(input);
      if (!resolved) {
        return msg.reply(
          "⚠️ Couldn't find that YouTube channel. Try pasting the full channel URL " +
            '(e.g. https://www.youtube.com/@MrBeast) instead of just the name.'
        );
      }

      const existing = await YoutubeWatch.findOne({ groupId, channelId: resolved.channelId });
      if (existing) return msg.reply(`Already watching ${resolved.channelTitle} in this group.`);

      // Posting frequency comes free from the RSS feed we already need to
      // fetch to set the baseline below - no extra request. Subscriber
      // count and total views: official numbers via fetchChannelStats when
      // YOUTUBE_API_KEY is set (also the ONLY way to get total views at
      // all - see youtubeRss.js), falling back to the page-scrape result
      // for subscriber count when it isn't. Every one of these is
      // best-effort - shown when available, silently left out of the
      // confirmation otherwise, never blocking adding the channel.
      const [recentVideos, officialStats] = await Promise.all([fetchLatestVideos(resolved.channelId), fetchChannelStats(resolved.channelId)]);
      const frequency = describePostingFrequency(recentVideos);
      const subscriberCount = officialStats?.subscriberCount || resolved.subscriberCount;
      const viewCount = officialStats?.viewCount || null;

      // lastVideoId starts null on purpose - the scheduler's first check
      // just records the current newest video as the baseline rather than
      // alerting for it, so adding a channel doesn't immediately post
      // whatever they uploaded last week.
      try {
        await YoutubeWatch.create({ groupId, channelId: resolved.channelId, channelTitle: resolved.channelTitle, addedBy: senderId });
      } catch (err) {
        // Duplicate-key race: two people ran /ytalert add for the same
        // channel close enough together that both passed the findOne check
        // above before either insert landed. Same friendly outcome as the
        // normal "already watching" case above, not a real failure.
        if (err.code === 11000) return msg.reply(`Already watching ${resolved.channelTitle} in this group.`);
        throw err;
      }
      return msg.reply(
        `✅ Now watching *${resolved.channelTitle}*.\n` +
          `${subscriberCount ? `👥 ${subscriberCount}\n` : ''}` +
          `${viewCount ? `👁️ ${viewCount} total\n` : ''}` +
          `${frequency ? `📅 Posts ${frequency}\n` : ''}` +
          `\nI'll post here whenever they upload - starting from their NEXT new video, not their existing ones.`
      );
    }

    return msg.reply(
      'Usage:\n/ytalert add <channel URL, @handle, or channel ID>\n/ytalert remove <name or number>\n/ytalert list'
    );
  },
};
