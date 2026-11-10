# BlueHunter website update

New files
- src/models/AuditLog.js, src/utils/auditLog.js  (moderation actions + settings history)
- src/utils/liveActivity.js                      (per-minute counts for the live graph)

Changed files
- src/web/join.html        new homepage
- src/web/index.html       dashboard: big live graph, Moderation log, Deleted messages, Settings history, better inactive list
- src/web/server.js        new endpoints (live, deleted-logs, audit, evidence), readable member names
- src/events/message.js    runs admin commands inside the audit context and records settings changes
- src/utils/waCompat.js, warnStore.js, muteStore.js, banStore.js, moderationAction.js, aiModeration.js
- src/commands/moderation/warn.js

Not included (so unzipping over your live bot cannot overwrite them): node_modules, .npm, .env, .baileys_auth, logs.
After unzipping: npm install (if needed), then restart the bot.

Update 2
- Members who joined in the last 24 hours no longer appear in the dashboard's low-activity list and can't be removed from it (server-side check too).
- /removeinactive now matches join records by normalized id, so recent joiners are skipped even when their id is stored in a different form.
- /activity now sends a 7-day line graph (src/utils/activityChart.js, uses sharp) before the active-users list.
- Owner contact: Timtech, +233 50 491 9423 (homepage footer and /owner). Override with OWNER_CONTACT_NUMBER.

Update 3 (deleted messages on the website)
- Deleted photos, videos, GIFs, stickers and voice notes can now be opened from the Deleted messages tab (click Show; nothing loads until then). Served only to admins of that group, only as image/video/audio, never SVG or documents.
- Sender names resolve across phone jid / hidden @lid forms; unknown senders show a number instead of "Member".
- New endpoint: GET /api/groups/<id>/deleted-media/<messageId>.

Update 4 (owner panel)
- Owner-only page on the website (#/owner): every group the bot is in, search/sort, bot-admin flag, today/week message counts, and buttons: Open dashboard, Send message (goes out as "Message from the owner"), Leave group (with confirmation).
- Owner is detected from OWNER_NUMBER / OWNER_LID, same as the bot's other owner commands; the owner can also open any group's dashboard even if not admin there.
- New endpoints: GET /api/owner/groups, POST /api/owner/groups/<id>/leave, POST /api/owner/groups/<id>/message. /api/me now includes "owner".
- Files: src/web/server.js, src/web/index.html

Update 5 (maintenance message + changelog)
- Owner panel has a "Maintenance message" card: post a notice (300 characters max) that shows as a banner on the home page and the dashboard; clear it any time. Stored in the database so it survives restarts.
- New model src/models/SiteNotice.js; /api/status now includes "maintenance"; new endpoint GET/POST /api/owner/maintenance (owner only).
- Changelog: new 2026-10-06 entry in src/data/changelog.js covering everything in this release (shows on the website's Changelog page and in /changelog).

Update 6 (status hero)
- Home page status is now a big animated hero (src/web/index.html): glowing orbiting logo, constellation background that reacts to the mouse, live heartbeat line, ticking uptime, count-up tiles for groups/commands/lag with a lag sparkline, headline that decodes when status changes. Colors follow health (green / amber / red / purple). Respects "reduce motion".
- Removed the "message BlueHunter yourself on WhatsApp" link.
- Changelog entry updated (src/data/changelog.js).

Update 7 (changelog page)
- The website's Changelog page (src/web/index.html) is now a glowing timeline: animated title, update/improvement counters, category filter chips (Website, Moderation, Activity, AI, Owner, Commands), colour-coded tags on each note, LATEST badge, "today / 7 days ago" labels, fade-in on scroll, and a "Show older updates" button. Categories are worked out automatically from the note text, so src/data/changelog.js keeps its current format.

Update 3 (join + verify polish)
- src/web/join.html   staged join messages (Receiving link, About to join <group>, joined / request sent / declined), animated loading bar, strong "Verifying" state, "Code verified, please wait" lock so double clicks do nothing.
- src/web/server.js   new POST /api/bot-join-info (group name preview), /api/bot-join now reports requested (approval groups) and declined.

Update 4 (premium dashboard animation)
- src/web/index.html   new additive "PREMIUM FX LAYER" (one CSS block at the end of <style>, one <script id="fx-js"> before </body>). Delete those two blocks to remove it. Nothing else in the file was changed.
  Includes: particle network + aurora + cursor glow, scroll progress bar, glass sticky header, page transitions, scroll-reveal with stagger, count-up numbers (+ glow on live changes), pointer spotlight + glowing borders, 3D card tilt, line-chart draw-in, growing leaderboard bars, sliding tab indicator, button shine + ripple, springy toggles, animated toast.
  Also fixes the leaderboard bar fill, which was being overridden by the sticky save-bar's .bar style.
- Automatically calmer on phones / low-power devices, and fully off for "reduce motion".

Update 5 (owner + admins)
- src/web/server.js   new GET /api/groups/:id/admins (JSON) and ?format=csv / ?format=txt downloads. Admin-only like the rest. Owner = WhatsApp's group creator ("superadmin"). CSV is UTF-8 with BOM for Excel and is protected against formula injection from member names. The bot shows as "BlueHunter (bot)".
- src/web/index.html  new "Owner & admins" tab: owner card (gold), admin cards with number, message count and last active, plus Download CSV and Download list (.txt) buttons.

Update 5 (auto-kick + reminder posts)
- Auto-kick inactive members: /autokick on <maxMessages> [graceHours]|off|preview, and an "Inactive members" section in dashboard Settings. Admins, new joiners inside the grace time (default 24h) and members with no tracked join record are never removed.
- Reminder posts: /remindpost add|list|remove|on|off|test|tagall, and a "Reminder posts" dashboard tab. Text or image/video, daily (or chosen days) at a UTC time. Media is stored in reminder-media/.
- New: models/ReminderPost.js, utils/reminderPosts.js, utils/reminderPostScheduler.js, utils/autoKick.js, utils/autoKickScheduler.js, commands/groupcontrol/autokick.js, commands/groupcontrol/remindpost.js
- Changed: models/GroupSettings.js, config.js, bot.js, web/server.js, web/index.html
