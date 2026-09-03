# Access and trust

`pi-intro` reads and writes `~/.pi/agent/pi-intro.json`; it has no subprocesses and no direct network access.

The package's configured image URL is metadata consumed by Pi; `pi-intro` itself does not fetch that URL.
