# Alice vs Kimberly — Receipts Rumble

A **playable original 1v1 pixel-art arcade fighter parody**, written in HTML, CSS and JavaScript Canvas. No external game libraries, existing fighting-game assets, or sound samples.

## Play

- **Single-file build:** [alice_vs_kimberly/index.html](./index.html) — works offline after downloading.
- **Editable files:** [source/index.html](./source/index.html), [source/style.css](./source/style.css), [source/game.js](./source/game.js), [source/favicon.svg](./source/favicon.svg).
- Choose **Alice** or **Kimberly Powell**. Play against the CPU. First to win **two rounds** wins the match.
- Three selectable stages: **The Reputation Exchange**, **The Podcast Court**, **The Gala of Receipts**.

## Controls

| Key | Action |
|---|---|
| A / D | Left / right |
| W | Jump |
| S | Crouch |
| J | Quick attack |
| K | Heavy attack |
| L | Alice: Ring Toss / Kimberly: Statement projectile |
| U | Dash attack |
| I | Guard, or finisher when opponent is weak and nearby |
| P or Escape | Pause |

Mobile on-screen controls and a sound toggle are provided.

## Features

Both fighters have original programmatically drawn pixel sprites with movement, attack poses, blocks, jumps, hit effects and KO animations. CPU attacks and guards; specials use projectiles, cooldowns, health, knockback, and hitboxes. 85-second rounds, best-of-three, victory quotes, rematch, three animated stages, and periodic meme events.

**Drama events:** LEAKED TEXTS, GROUP CHAT ACTIVATED, LAWYER MODE, VIRAL CLIP, PUBLIC STATEMENT.

**Future extras:** an Algorithm fighter, a Podcast Host, the PR Agent, Legal Counsel; more character-specific finishers, combo trees, local two-player mode, controller support.

## Safety and publication

This folder is committed **only on branch `game/alice-vs-kimberly-mvp`** of the existing GitHub repository. It is NOT on `main`, and therefore doesn't affect Jensen vs Alice, its GitHub Pages site, domain, leaderboard, or Supabase data.

To launch independently, create a new repository `alice_vs_kimberly`, copy the four files from `source/` to its root and enable GitHub Pages (Settings → Pages → Deploy from branch → main / root). GitHub repository creation and Pages administration are not available through the currently connected GitHub tool, so these steps are not claimed as completed.

## Test coverage

Chromium tests passed for character selection, fight start, movement, quick/special attacks, pause/resume, two KOs, victory, and rematch. No JavaScript page errors in those tests.

Fighter art is an MVP interpretation, not a frame-by-frame copy of the supplied concept illustration.
