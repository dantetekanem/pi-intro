# pi-intro

A cinematic startup overlay for [Pi](https://github.com/earendil-works/pi).

![pi-intro demo](./demo.gif)

## Install

```bash
pi install git:github.com/dantetekanem/pi-intro
```

Restart Pi. Press any key to skip the intro.

## What it does

- Animates a centered PI reveal for 1.8 seconds, then holds the completed frame for exactly 750 ms.
- Lets Pi continue its remaining post-TUI startup work behind the overlay instead of blocking it for 2.55 seconds.
- Starts at Pi's supported `session_start` hook, so a brief normal Pi frame may appear first; initial extension and skill discovery has already completed.

## Development

```bash
node --experimental-strip-types --test tests/*.test.ts
```
