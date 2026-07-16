# pi-intro

A cinematic startup overlay and true fixed-bottom editor cluster for [Pi](https://github.com/earendil-works/pi).

## Install

```bash
pi install git:github.com/dantetekanem/pi-intro
```

Restart Pi. Press any key to skip the intro or run `/intro` to replay it.

## What it does

- Animates a centered PI reveal for 1.8 seconds, then holds the completed frame for exactly 750 ms.
- Lets Pi continue its remaining post-TUI startup work behind the overlay instead of blocking it for 2.55 seconds.
- Starts at Pi's supported `session_start` hook, so a brief normal Pi frame may appear first; initial extension and skill discovery has already completed.
- Keeps status, `pi-emote`, the real editor, below-editor widgets, and the existing footer anchored at the terminal bottom.
- Preserves component ownership: it never replaces Pi's editor or footer.
- Suspends fixed-bottom rendering while overlays are open and restores terminal modes on shutdown.
- Keeps Kitty image IDs stable and cleans up removed images.
- Has no dependency on `pi-powerline-footer`.

## Compatibility

The fixed-bottom compositor validates the live Pi/TUI runtime shape before installation. On an incompatible shape, it fails closed and leaves Pi's normal interface untouched.

Transcript keys: `PageUp`/`PageDown`, `Ctrl+Up`/`Ctrl+Down`, and `Ctrl+Home`/`Ctrl+End`.

## Development

```bash
node --experimental-strip-types --test tests/*.test.ts
```

See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for attribution.
