const { fetchFunnyGif } = require('../../utils/funGif');
const { resolveFunTarget } = require('../../utils/funTarget');

module.exports = {
  name: 'hug',
  aliases: ['hugs'],
  category: 'fun',
  description: '/hug [@user] - send a funny anime hug reaction gif',
  async execute({ client, msg, chat, args }) {
    const { targetJid, targetText } = await resolveFunTarget(client, msg, chat, args);
    const caption = targetText ? `🤗 ${targetText}, you just got hugged!` : '🤗 Big hug incoming!';
    const mentions = targetJid ? [targetJid] : [];

    const gif = await fetchFunnyGif([
      'anime hug cute',
      'anime couple hug',
      'wholesome anime hug',
    ]);

    if (gif) {
      // One message: the gif WITH the reaction text as its caption, not a
      // separate follow-up reply.
      await client.sendMessage(chat.id._serialized, { video: gif, gifPlayback: true, caption, mentions });
      return;
    }

    // No gif could be fetched - text-only fallback, never leave the command silent.
    await msg.reply(caption, undefined, mentions.length ? { mentions } : {});
  },
};
