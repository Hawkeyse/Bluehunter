// Single source for the /changelog command AND the website. Newest entry first.
// Add a new block here whenever you ship something, then restart the bot.
const CHANGELOG = [
  {
    date: '2026-11-10',
    notes: [
      'YouTube alerts can attach a video as MP4 for a watched channel you own or have permission to repost: use /ytalert media on <channel>. Other channels keep link-only alerts; clips over 15 minutes or 90 MB stay link-only',
      'YouTube MP4 alerts now use the YT-API /dl endpoint on RapidAPI',
    ],
  },
  {
    date: '2026-11-10',
    notes: [
      'After BlueHunter moderates a member, a short "sorry" or "my bad" gets a calm, direct acknowledgment even when AI chat is enabled',
      'Saying "Destro" gets a 💥 reaction and mentioning Timtech gets a 🐐 reaction, with no unsolicited text reply',
      'AI chat keeps more recent group context for game conversations, especially Clash of Clans, and stays quiet unless someone addresses it',
    ],
  },
  {
    date: '2026-11-10',
    notes: [
      'X alerts now check for posts every 30 seconds by default and send the post text before fetching media, so slow video or image downloads no longer delay the notification',
      'Antigroupstatus now detects WhatsApp group-status shares posted directly to a group, removes the share immediately and warns the member; enable it with /antigroupstatus on',
      'Admins can reply to a message with /del to remove it, or use /clear @user 10 to remove up to 50 recent messages from that one member',
    ],
  },
  {
    date: '2026-11-03',
    notes: [
      'New /antibot on|off: catches other bots people bring into the group so their commands are not used here. Bots that are group admins are left alone, and what happens to a caught bot follows /antilinkaction',
      'Talk to BlueHunter like a person: admins can write “BlueHunter lock this group for 10 mins”, “BlueHunter kick this person” (reply to them or to their shared contact), “BlueHunter add” a shared contact or number, “BlueHunter approve all”, “BlueHunter who is requesting to join”, “BlueHunter turn on view once” and more - it reacts ✅ and runs the matching command. Bulk-destructive commands stay slash-only',
      'Dark jokes: BlueHunter waits for the group to react (“wtf”, “not funny”, a disgusted emoji) and then quietly removes the message if it really is offensive',
      'AI moderation is calmer: it reads the group description for the group’s tone, lets members vent or argue (including with admins) without reacting, and only steps in when a fight has clearly gone far. It no longer posts a message for every removal',
      'Voice notes: BlueHunter now shows “recording…” while it prepares a voice note and “typing…” for text, and the Nonso voice lookup is more reliable',
    ],
  },
  {
    date: '2026-11-02',
    notes: [
      'Bible references in group chat now display automatically by default across books and chapters; a book and chapter like “Psalm 121” returns verse 1. The default translation is NLT and admins can still turn detection off',
      'AI chat is calmer and more selective: it can ignore messages that do not need a reply, while keeping occasional context-aware jokes, Naija slang, and helpful corrections without mocking intentional language choices',
      'Groups can choose a Nigerian Pidgin Bible with /bibleversion PIDGIN when that translation is available to their API.Bible key; /bibleversion list now shows available Pidgin editions',
      'Auto-greetings can now be sent in Nigerian Pidgin as well as English. Choose funny, thoughtful, prayerful, or encouraging styles naturally; set it with /autogreetings nigeria pidgin or the dashboard',
    ],
  },
  {
    date: '2026-11-02',
    notes: [
      'The group banter now reacts 💀 to WTF-style messages and gives short, context-aware replies to WTF, “who?”, “what happened?” and “is this a bot?” using OpenAI when configured',
      'Banter follows the chat’s tone, supports natural Nigerian Pidgin, and is rate-limited so it does not flood the group',
    ],
  },
  {
    date: '2026-10-07',
    notes: [
      'New auto-remove for inactive members: set a message limit (0 = never wrote anything, 1 = wrote once or not at all) and BlueHunter removes members at or under it. Turn it on from the dashboard Settings or with /autokick on <messages> [hours]',
      'New members get time to settle in first: nobody is removed until they have been in the group for the grace time you set (24 hours by default). Admins and anyone BlueHunter has no join record for are never removed',
      '/autokick preview shows exactly who would be removed right now before you switch it on',
      'New \"Reminder posts\" tab: schedule a post to go out in your group every day (or only on chosen days) at a set UTC time, e.g. 16:00. Use text only, or add an image or video',
      'Reminder posts also work from the group: /remindpost add 16:00 your text, plus list, remove, on, off and test. Send an image or video with the command as the caption, or reply to one',
      'Each reminder post can silently tag everyone, be paused without deleting it, or be posted instantly with \"Post now\"',
    ],
  },
  {
    date: '2026-10-06',
    notes: [
      'New home page: a clear welcome, what BlueHunter does for your group, and two big buttons \u2013 add BlueHunter to your group with an invite link, or sign in to set up your group',
      'The status at the top of the home page is now big and alive: a glowing animated logo, a live heartbeat line, an uptime clock that ticks every second, and counters for groups, commands and lag. It turns amber, red or purple when BlueHunter is slow, offline or down. The "message BlueHunter yourself" link is gone, since you can now add the bot with an invite link',
      'The activity graph on each group\u2019s dashboard is now big and live: it moves in real time, shows messages per minute for the last hour, and a 14-day view that also draws how many members have gone quiet',
      'New "Deleted messages" tab: admins can see what was deleted, who sent it and who deleted it, and open deleted photos, videos and voice notes with one click',
      'New "Moderation log" tab: warnings, AI moderation cases (with the flagged text or image), mutes, kicks and bans, each with who did it and why',
      'New "Settings history" tab: see which admin changed which setting, and whether it was from the website or a command in the group',
      'The low-activity members list now shows real names or numbers instead of "Member", has a search box, and never lists (or removes) anyone who joined in the last 24 hours',
      '/activity now sends a 7-day line graph of the group\u2019s messages before the list of most active members',
      'Owner panel (owner only): see every group BlueHunter is in, open any group\u2019s dashboard, send a message to a group, make the bot leave, and post a maintenance message on the website',
      'Want to speak with the owner? Contact Timtech on WhatsApp: +233 50 491 9423',
    ],
  },
  {
    date: '2026-09-29',
    notes: [
      'Group activity now has a real graph: a 14-day bar chart of the group\u2019s daily message volume, tracked fresh from today',
      'Added a "Low-activity members" tool on each group\u2019s dashboard: set a message-count threshold, see who\u2019s under it (admins excluded), and remove them from the group in bulk right from the site',
    ],
  },
  {
    date: '2026-09-28',
    notes: [
      'Every group\u2019s dashboard now shows real data, not settings alone: the group\u2019s WhatsApp photo, a message-activity summary, and a top-members leaderboard - all built from the message activity BlueHunter was already tracking',
      'New look for the home page: a welcome section explaining what BlueHunter does (moderation, general, AI chat & voice, AI moderation, fun games), a live status beacon, and a way to message BlueHunter directly on WhatsApp to check it yourself',
      'Added a "temporarily banned" status for when WhatsApp logs the account out, so the site says so plainly instead of just looking offline',
      'Signing in to the website is now number-based: run /verify once in any group BlueHunter is in, and the dashboard shows every group where you\u2019re actually an admin - not just the one you typed it in',
      'Losing admin in WhatsApp now removes dashboard control for that group immediately - it\u2019s checked live on every visit, the same way /kick or /antilink access is',
      'The dashboard now covers the daily schedulers too: good morning/afternoon/evening/night greetings, auto close/open times, the daily Bible verse and verse detector, the daily joke, and this group\u2019s extra blocked words on top of the built-in filter',
    ],
  },
  {
    date: '2026-09-21',
    notes: [
      'AI chat is more savage and more Nigerian in tone: sharper roast energy, more ragebait flavor, and stronger direct clap-backs when someone insults the bot or starts clowning in chat',
      'AI chat can now react with GIF-based stickers when the model asks for one, using the built-in sticker pipeline and Giphy lookup instead of dropping the reaction entirely',
      'General NSFW posts no longer force the bot to auto-leave the group by default; the bot still keeps the zero-tolerance sexual/minors safety check active for real harmful content',
    ],
  },
];

module.exports = { CHANGELOG };
