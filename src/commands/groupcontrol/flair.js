const GroupSettings = require('../../models/GroupSettings');

const FLAIRS = [
  { label: 'Friendly', emoji: '😊', words: ['friendly'] },
  { label: 'SFW', emoji: '🛡️', words: ['sfw'] },
  { label: 'NSFW', emoji: '🔞', words: ['nsfw'] },
  { label: 'Politics', emoji: '🗳️', words: ['politics'] },
  { label: 'Religion', emoji: '🙏', words: ['religion'] },
  { label: 'Vawulence', emoji: '🌶️', words: ['vawulence'] },
  { label: 'Roast', emoji: '🎤', words: ['roast'] },
  { label: 'Active', emoji: '🔥', words: ['active'] },
  { label: 'Giveaway', emoji: '🎁', words: ['giveaway'] },
  { label: 'No underage', emoji: '🚫🧒', words: ['no', 'underage'] },
  { label: 'Bot', emoji: '🤖', words: ['bot'] },
  { label: 'Gamer', emoji: '🎮', words: ['gamer'] },
  { label: 'Technology', emoji: '💻', words: ['technology'], aliases: [['tech']] },
  { label: 'Nigeria', emoji: '🇳🇬', words: ['nigeria'] },
  { label: 'Ghana', emoji: '🇬🇭', words: ['ghana'] },
  { label: 'Kenya', emoji: '🇰🇪', words: ['kenya'] },
  { label: 'South Africa', emoji: '🇿🇦', words: ['south', 'africa'] },
  { label: 'United Kingdom', emoji: '🇬🇧', words: ['united', 'kingdom'] },
  { label: 'United States', emoji: '🇺🇸', words: ['united', 'states'] },
];

function parseFlairs(args) {
  const words = args.join(' ').toLowerCase().split(/[,\s]+/).filter(Boolean);
  const selected = [];
  const choices = FLAIRS.flatMap((flair) =>
    [flair.words, ...(flair.aliases || [])].map((phrase) => ({ flair, phrase }))
  ).sort((a, b) => b.phrase.length - a.phrase.length);
  for (let i = 0; i < words.length;) {
    const match = choices.find(({ phrase }) =>
      phrase.every((word, offset) => words[i + offset] === word)
    );
    if (!match) return { error: words[i] };
    selected.push(match.flair.label);
    i += match.phrase.length;
  }
  return { flairs: [...new Set(selected)] };
}

const flairText = (flairs) => flairs
  .map((label) => {
    const flair = FLAIRS.find((item) => item.label === label);
    return flair ? `${flair.emoji} ${flair.label}` : label;
  })
  .join(', ');

module.exports = {
  name: 'flair',
  category: 'groupcontrol',
  description: '/flair <labels|clear> - set public group-directory flairs',
  adminOnly: true,
  groupOnly: true,
  async execute({ chat, args }) {
    const groupId = chat.id._serialized;
    const input = args.join(' ').trim();
    if (!input) {
      const current = await GroupSettings.findOne({ groupId }).select('directoryFlairs').lean();
      const flairs = current?.directoryFlairs || [];
      return chat.sendMessage(
        `Current group-directory flairs: ${flairs.length ? flairText(flairs) : 'none'}\n` +
        `Available labels: ${FLAIRS.map((flair) => `${flair.emoji} ${flair.label}`).join(' · ')}\n` +
        'Use /flair with one or more labels (for example: /flair gamer technology nigeria).\n' +
        'Use /flair clear to remove them.'
      );
    }

    if (input.toLowerCase() === 'clear') {
      await GroupSettings.findOneAndUpdate({ groupId }, { directoryFlairs: [] }, { upsert: true });
      return chat.sendMessage('✅ Group-directory flairs cleared.');
    }

    const parsed = parseFlairs(args);
    if (parsed.error) {
      return chat.sendMessage(`I don't recognize "${parsed.error}". Choose from: ${FLAIRS.map((flair) => flair.label).join(', ')}. Use /flair clear to remove all flairs.`);
    }
    const flairs = parsed.flairs;
    if (flairs.includes('SFW') && flairs.includes('NSFW')) {
      return chat.sendMessage('Choose either SFW or NSFW, not both.');
    }

    await GroupSettings.findOneAndUpdate({ groupId }, { directoryFlairs: flairs }, { upsert: true });
    await chat.sendMessage(`✅ Public group-directory flairs set: ${flairText(flairs)}.\nThese labels are self-reported by group admins.`);
  },
};
