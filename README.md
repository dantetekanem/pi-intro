# pi-intro

A cinematic startup overlay for [Pi](https://github.com/earendil-works/pi).

![pi-intro demo](./demo.gif)

## Requirements

- Pi 0.80.7 or newer

## Install

```bash
pi install npm:pi-intro
```

Restart Pi. The intro completes automatically, or press any key to skip it.

## What it does

- Lets Pi continue its remaining post-TUI startup work behind the overlay instead of blocking startup on the animation.
- Starts at Pi's supported `session_start` hook, so a brief normal Pi frame may appear first; initial extension and skill discovery has already completed.

## Customization

### Interactive: `/pi-intro`

Run `/pi-intro` inside Pi to pick a preset (or a custom word), then edit the bottom message in a prefilled editor — empty hides it. **Enter persists immediately** to `~/.pi/agent/pi-intro.json` (no save key needed) and the intro replays as a live preview. The choice greets you on every startup; env vars below override the saved file when set.

### Environment variables

Pick a preset with `PI_INTRO_STYLE`, or override the pieces with `PI_INTRO_WORD`, `PI_INTRO_COLOR`, and `PI_INTRO_TAGLINE`. Env vars override the saved `~/.pi/agent/pi-intro.json`. Restart Pi after changing them.

### Presets

| `PI_INTRO_STYLE` | Big word | Color |
| --- | --- | --- |
| _(unset)_ / `pi` | PI | your theme's accent (default) |
| `shopify` | SHOPIFY | Shopify green `#95BF47` |
| `hacker` | HACKER MODE | phosphor green `#00DC41` |
| `coffee` | COFFEE TIME | espresso `#C08051` |
| `beast` | BEAST MODE | rage red `#E74C3C` |
| `prof` | PROFESSOR | golden chalk `#F1C40F` |
| `winter` | WINTER IS COMING | ice blue `#7FD4FF` |

Custom presets also show **WELCOME BACK** under the big word, in your theme's muted color.

```bash
PI_INTRO_STYLE=shopify pi
```

### Custom overrides

Overrides win over the preset. The word uses a built-in block font (A–Z, space, apostrophe); long words shrink to fit narrow terminals.

```bash
PI_INTRO_WORD=LEO PI_INTRO_COLOR=#0ea5e9 PI_INTRO_TAGLINE="BOM DIA" pi
PI_INTRO_STYLE=hacker PI_INTRO_WORD=ROOTED pi
```

Invalid hex colors fall back to your theme's accent.

## Development

```bash
node --experimental-strip-types --test tests/*.test.ts
```
