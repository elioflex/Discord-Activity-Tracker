# Activity Tracker

Track Discord user activities.

## Usage

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

## Dashboard Buttons
- 📥 Export JSON
- 📄 Export TXT
- 🗑️ Clear All
- Green badges = tracked users

## Settings
Enable "auto-track all users" in plugin settings.

## Installation

1. Copy to `Vencord/src/userplugins/`
2. Run `pnpm build`
3. Enable in settings
