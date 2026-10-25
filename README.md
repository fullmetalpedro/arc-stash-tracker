# ARC Stash Tracker

A small Windows desktop app for ARC Raiders: it reads your stash through your MetaForge account and
tells you what it's for, what you can craft, what to sell, and where to find what you're missing.
About 1.2 MB installed (0.5 MB download), built on the WebView2 (Edge) runtime that ships with Windows.

> Fan project, not affiliated with or endorsed by Embark Studios. ARC Raiders is a trademark of
> Embark Studios AB.

## Features

- **Stash** synced from MetaForge: tiles with rarity, hover cards with description, prices, what each
  item is needed for, and marks for "needed by your goals" vs "spare".
- **Tracked**: what an item is for (workshop levels, projects, quests, recipes) and how to get more.
- **Find**: search any item for trader offers, recipe and blueprint, items that break down into it,
  harvest spots and ARC drops per map, the wiki's sources and "what to look for" photos, and containers
  that drop it.
- **Crafting**: what you can make now, buy price vs ingredient cost, and crafts that free stash slots.
- **Prices**: sell and buy prices with daily history.
- **Projects**: workshop upgrades, expedition and event projects against your stash.
- **Insights**: what to hand in, sell, recycle, learn or craft (from your own goals), what you're short
  on and the fastest way to get it, which map to raid next, and raid readiness.
- **Traders**: offers that cover your next goals, ammo for your weapons, craft-or-buy.
- **MetaForge sync** with an Embark authorization countdown and re-authorization via MetaForge Bridge.

## Install

1. Download **`ArcStashTracker-Setup-1.0.0.exe`** from the
   [latest release](https://github.com/fullmetalpedro/arc-stash-tracker/releases/latest) (about 0.5 MB).
2. Run it and click **Install**. It installs for your Windows user only (no admin rights) and adds
   Start menu and desktop shortcuts. Running a newer setup later updates in place and keeps your data.
3. Open the app and click **Sign in to sync** (top right) to connect your MetaForge account.

**"Windows protected your PC"**: the setup isn't code-signed, so SmartScreen warns the first time.
Click **More info → Run anyway**. You can check the download against the SHA-256 listed in the release.

Needs Windows 10 or 11 with the Microsoft Edge **WebView2 Runtime** (built into Windows 11 and most
up-to-date Windows 10 PCs; the setup tells you if it's missing and links to Microsoft's installer).

Prefer no installer? Use **`ArcStashTracker-1.0.0-portable.zip`**: unzip anywhere and run
`ArcStash.exe`.

**Uninstall** from Settings → Apps → Installed apps (or run `ArcStash.exe --uninstall`). Your data stays
in `%APPDATA%\ARC Stash Tracker` (item cache, price history) and `%LOCALAPPDATA%\ARC Stash Tracker`
(browser profile with your MetaForge sign-in); delete those folders to remove everything.

## Build from source

No SDKs to install: the build uses the C# compiler that ships with Windows (.NET Framework 4.8) and
downloads the pinned WebView2 SDK from nuget.org (SHA-256 verified).

```powershell
powershell -ExecutionPolicy Bypass -File shell\build.ps1     # -> dist\ (app folder, setup exe, portable zip)
powershell -ExecutionPolicy Bypass -File shell\install.ps1   # installs the build on this PC (runs the setup silently)
```

The version comes from `shell\version.txt`. `ArcStashTracker-Setup-<version>.exe /S` installs silently.

## Tests

```powershell
powershell -ExecutionPolicy Bypass -File tests\chaos.ps1
```

Runs the built exe in self-test mode (throwaway profiles; your install and data are never touched):
bridge fuzzing, hostile MetaForge payloads, garbage saved state, an XSS pass over a poisoned item
cache, offline starts, corrupt and unwritable caches, a second instance, and a stress run with every
item in the game. Logs and screenshots land in `%TEMP%\arc-chaos-<timestamp>`.

## How it works

```
app/            the UI (plain HTML/CSS/JS modules, no build step)
  app.js        views, insights, sync logic
  bridge.js     window.api: data cache, MetaForge requests, links, via the host
  databuild.js  downloads and normalizes MetaForge + wiki data into one cache file
shell/          the native host
  ArcStash.cs   WinForms + WebView2 window; exposes a few narrow commands to the page
  Setup.cs      the one-file installer (embeds the app as a zip; per user, no admin)
  build.ps1     compiles with csc.exe (.NET Framework 4.8), fetches the WebView2 SDK, packages releases
  install.ps1   installs the local build
tests/          chaos tests (see above)
```

Reference data (items, recipes, hideout, quests, traders, map markers) comes from the public MetaForge
API and the ARC Raiders Wiki, refreshed about once a day and cached locally, as MetaForge asks.

**MetaForge account sync** uses MetaForge's own website endpoints (the ones behind its "Sync all"
button), called from a hidden page on metaforge.app so your sign-in cookies are handled by the browser.
These endpoints are not a documented API and may change. The app never sees your password.

## Security notes

- The page can only call a handful of host commands. File access is limited to a few `*.json` files in
  the app's data folder; HTTP GETs are limited to the MetaForge API and the wiki API.
- Signed-in MetaForge requests are limited to an allowlist (account-sync, Embark authorization status
  and start, and the five per-resource syncs). Nothing else on your account can be called.
- Only https links and MetaForge Bridge links open externally; navigation inside the app window is
  locked to the app itself. Content-Security-Policy blocks inline scripts; all data is HTML-escaped.
- Data from MetaForge, the wiki, saved state and imported files is validated (types, ids, ranges)
  before use.

## License

The code is under the [MIT License](LICENSE). That covers this repository only: the bundled fonts are
under the SIL Open Font License, the WebView2 SDK under Microsoft's license, and the data the app shows
belongs to its sources (see below and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)).

## Credits

- Data: [MetaForge](https://metaforge.app/arc-raiders) (community-maintained; attribution required for
  public projects, commercial use needs MetaForge's permission) and the
  [ARC Raiders Wiki](https://arcraiders.wiki) (text and images under
  [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)).
- Third-party components and fonts: see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
