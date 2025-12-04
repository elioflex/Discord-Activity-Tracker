# Discord Activity Tracker

A Vencord plugin that tracks Discord user activities including voice channel joins/leaves, messages, status changes, and gaming activities.

## Features

- 🎮 **Activity Tracking** - Monitor gaming, Spotify, streaming, and custom activities
- 🔊 **Voice Tracking** - Log voice channel joins, leaves, and moves with channel & server names
- 💬 **Message Logging** - Track all messages from monitored users
- 🟢 **Status Changes** - Monitor online/offline/idle/dnd status updates
- 📊 **Dashboard** - Visual interface to view and manage tracked data
- 📥 **Export** - Export logs in JSON or TXT format
- 🎯 **User Filtering** - Track specific users or enable auto-track for all

## Installation

This is a **Vencord plugin**. You need to have [Vencord](https://vencord.dev/) installed.

1. Clone or download this repository
2. Copy the entire `ActivityTracker` folder to `Vencord/src/userplugins/`
3. Run `pnpm build` in your Vencord directory
4. Restart Discord
5. Enable "ActivityTracker" in Vencord settings

## Usage

### Right-Click Menu
Right-click any user to access:
- **Activity Tracker** - Opens the dashboard
- **Start/Stop Tracking User** - Toggle tracking for that user

### Console Commands

**Console commands:**
```js
// Open dashboard
Vencord.Plugins.plugins.ActivityTracker.openDashboard()

// Track user
Vencord.Plugins.plugins.ActivityTracker.trackUser("USER_ID")

// Stop tracking
Vencord.Plugins.plugins.ActivityTracker.untrackUser("USER_ID")

// View logs
Vencord.Plugins.plugins.ActivityTracker.getActivityLogs()
```

## Dashboard Features

- **Filter by User** - Click user badges to filter logs
- **Search** - Search by username or user ID
- **Export Options**
  - 📥 Export JSON - Full structured data
  - 📄 Export TXT - Human-readable format
- **Clear All** - 🗑️ Remove all logs and tracked users
- **Green badges** = Currently tracked users
- **Activity Types** - Shows activity/voice/message/status with details

## Settings

Go to Vencord Settings → Plugins → ActivityTracker:
- **Auto-track all users** - Enable to track everyone in the server (high volume)

## Tracked Data

- **Activities**: Gaming, Spotify, Streaming, Custom Status, Rich Presence
- **Voice**: Join/Leave/Move with channel name and server name
- **Messages**: Full message content from tracked users
- **Status**: Online, Offline, Idle, Do Not Disturb changes

## Credits

Developed by [Elioflex](https://github.com/elioflex)

## License

MIT
