const { fetchFunnyGif } = require('../../utils/funGif');
const { resolveFunTarget } = require('../../utils/funTarget');

module.exports = {
  name: 'kiss',
  aliases: ['kisss'],
  category: 'fun',
  description: '/kiss [@user] - send a funny anime kiss reaction gif',
  async execute({ client, msg, chat, args }) {
    const { targetJid, targetText } = await resolveFunTarget(client, msg, chat, args);
    const caption = targetText ? `💋 ${targetText}, you just got a kiss!` : '💋 A tiny dramatic kiss moment!';
    const mentions = targetJid ? [targetJid] : [];

    const gif = await fetchFunnyGif([
      'anime kiss cute couple',
      'anime couple kiss',
      'cute anime kiss',
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
