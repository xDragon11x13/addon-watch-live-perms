# Watch Live Permissions

fxPanel addon that adds granular **Watch Live** permissions with team-member protection and full **Action Log** entries.

## Features

- **Watch Live** (`addon.addon-watch-live-perms.watch_live`) — observe normal players
- **Watch Live (Team)** (`addon.addon-watch-live-perms.watch_live_team`) — also observe players with the **staff** tag
- All sessions are logged in the Action Log (start, team start, stop with duration)
- When this addon is **running**, the built-in Watch Live API is disabled so permissions are enforced through the addon

## Installation

1. Copy `addon-watch-live-perms` into your fxPanel `addons/` folder
2. Replace `core/index.js` with the patched version from this repo (required for addon ↔ live spectate bridge)
3. Restart fxPanel
4. Open **Addons** → approve **Watch Live Permissions**
5. Assign the new permissions under **Admin Manager → Permissions** (category: Addons)

## Usage

Open a connected player in the panel → **Watch Live** tab → **Start Watch Live**.

Staff-tagged players require **Watch Live (Team)**.

## Requirements

- fxPanel **v0.3.0-Beta** or newer
- Patched `core/index.js` (ships with this monitor build)

## Action Log IDs

| Event | Action ID |
|-------|-----------|
| Watch Live started | `addon.addon-watch-live-perms.live_spectate.start` |
| Team member watched | `addon.addon-watch-live-perms.live_spectate.start.team` |
| Watch Live stopped | `addon.addon-watch-live-perms.live_spectate.stop` |

## Notes

- The default **More → Watch Live** menu entry remains visible if admins have `players.spectate`, but returns an error while this addon is active. Use the **Watch Live** tab instead.
- `players.spectate` is still used for in-game spectate and screenshots.
