# Changelog

## 1.0.0 (2026-10-25)
First public release.

- **Stash sync** through your MetaForge account (stash, workshop levels, quests, stats), with an Embark
  authorization countdown and re-authorization via MetaForge Bridge.
- **Stash panel**: item tiles with rarity, hover cards (description, prices, what it's needed for),
  "needed" / "spare" marks, sorting and filtering.
- **Tracked, Find, Crafting, Prices, Projects, Insights and Traders** tabs: what items are for, every way
  to get an item (traders, recipes, recycling, harvest spots and ARC drops per map, wiki sources and
  photos, containers), craftable-now with buy-vs-craft costs, price history, workshop and expedition
  projects, personalized sell/recycle/craft suggestions, "where to raid next", and trader offers.
- **Small**: about 1.2 MB, built on the WebView2 runtime that ships with Windows.
- **One-file installer** (per user, no admin rights) with Start menu and desktop shortcuts and an
  Apps & features entry.
- **Hardened**: allowlisted MetaForge requests, sandboxed host commands, validated data, and a chaos
  test suite (`tests\chaos.ps1`).
