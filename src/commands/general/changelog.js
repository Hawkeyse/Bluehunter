const { BOT_NAME } = require('../../config');

const { CHANGELOG } = require('../../data/changelog');

module.exports = {
  name: 'changelog',
  aliases: ['updates'],
  category: 'general',
  ownerOnly: true,
  description: '/changelog [all] - see recent Bluehunter updates (owner only)',
  async execute({ client, msg, chat, args }) {
    const recent = CHANGELOG.slice(0, 5);
    const text = recent
      .map((entry) => `📅 *${entry.date}*\n${entry.notes.map((n) => `  ◈ ${n}`).join('\n')}`)
      .join('\n\n');

    const summary = `🔷 *${BOT_NAME} Changelog*\n\n${text}`;

    const shouldBroadcastAll = !chat || !chat.isGroup || args.includes('all');

    if (!shouldBroadcastAll) {
      const adminIds = (chat.participants || [])
        .filter((p) => p.isAdmin || p.isSuperAdmin)
        .map((p) => p.id?._serialized)
        .filter(Boolean);

      await chat.sendMessage(summary, { mentions: adminIds });
      return;
    }

    if (!client || typeof client.groupFetchAllParticipating !== 'function') {
      await msg.reply(summary);
      return;
    }

    try {
      const result = await client.groupFetchAllParticipating();
      const groups = Object.keys(result || {}).filter((key) => key && key.endsWith('@g.us'));

      if (!groups.length) {
        await msg.reply(summary);
        return;
      }

      for (let i = 0; i < groups.length; i++) {
        const groupId = groups[i];
        try {
          const metadata = await client.groupMetadata(groupId);
          const adminIds = (metadata?.participants || [])
            .filter((p) => p.admin === 'admin' || p.admin === 'superadmin')
            .map((p) => p.id)
            .filter(Boolean);

          await client.sendMessage(groupId, { text: summary, mentions: adminIds });
        } catch (err) {
          // skip one failed group, keep moving to the next one rather than
          // stopping the whole announcement because of one flaky group.
        }

        if (i < groups.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 60_000));
        }
      }
    } catch (err) {
      await msg.reply(summary);
    }
  },
};