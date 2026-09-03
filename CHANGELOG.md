# Changelog

## Unreleased

### Changed

- Skip the startup intro when Pi resumes a session through `--session`, `--continue`, or `--resume`.

## 0.2.5 - 2026-08-24

### Fixed

- Use Escape as the dedicated skip key and capture it through Pi's TUI input path so it remains reliable when overlay focus moves.

## 0.2.4 - 2026-08-23

### Changed

- Use Pi's public CLI parser for startup input detection instead of maintaining a duplicate flag list.
- Require Pi 0.80.7 or newer.
- Add package-gallery preview metadata and document npm installation.

### Fixed

- Include the intro command and persisted configuration modules in the npm package.

## 0.2.3 - 2026-08-07

### Changed

- Skip the startup intro when Pi launches with an initial command-line prompt or file.

## 0.2.2 - 2026-08-06

### Changed

- Refined the Shopify preset so the surrounding letters dissolve in place while PI stays fixed and transitions from Shopify green to the active theme accent.

### Fixed

- Prevented startup crashes with dynamic TUI render references by skipping the bottom-spacer patch before it mutates the host renderer.

## 0.2.1 - 2026-07-28

### Changed

- Allowed any key to skip the startup intro by making the full-screen overlay capture input.

## 0.2.0 - 2026-07-17

### Added

- Added block-font hero words and the `pi`, `shopify`, `hacker`, `coffee`, `beast`, `prof`, and `winter` presets.
- Added the `/pi-intro` picker with live previews and persisted configuration.
- Added environment overrides for the preset, hero word, color, and tagline.

## 0.1.3 - 2026-07-17

### Fixed

- Prevented bottom-spacer padding from expanding content beyond the terminal height during overlays and resize transitions.

### Added

- Added real-TUI regression coverage for message visibility, content growth, cleanup, and intro teardown.

## 0.1.2 - 2026-07-17

### Changed

- Made the startup overlay non-capturing so typing could continue while the intro played.

## 0.1.1 - 2026-07-16

### Removed

- Removed the `/intro` replay command.

## 0.1.0 - 2026-07-16

### Added

- Added the cinematic PI startup overlay and bottom spacer.
- Added the README animation demo.

### Changed

- Let post-TUI initialization continue behind the startup animation.
- Simplified editor pinning to preserve native terminal selection and tmux mouse scrolling while failing closed on incompatible host shapes.
