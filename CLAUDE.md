# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm test                    # Run all Jest tests
npm test -- --testPathPattern=ConfigClient  # Run a single test file
npm run lint                # ESLint
npm run dev                 # Start dev server (coderich-dev)
```

## Architecture

`@coderich/sandman` is a YAML-driven interactive CLI tool for firing HTTP requests. The entry point (`index.js`) exports a factory that takes a `configDir` path and returns a `Sandman` instance.

### Core data flow

1. **Config loading** — `ConfigClient` extends `@coderich/config` and parses a directory of YAML files into a nested config object. File paths become dot-notation keys (e.g. `config/sandman/folder/introspection.yaml` → `sandman.folder.introspection`). `index.yaml` at any level merges into its parent scope.

2. **Merge files (`+.yaml`)** — Files named `+.yaml` are processed as merge/default overlays and are NOT stored as keys. They inject default `request.*` fields into every API entry under their directory. Deeper `+.yaml` files override shallower ones. This is how shared headers, methods, and other defaults propagate without repetition.

3. **Interactive CLI** — `Sandman` wraps Node's `readline` with tab-completion (via `ReadlineService`) and exposes built-in commands:
   - `/` — execute a named request (e.g. `/ sandman.folder.introspection`)
   - `view <key>` — inspect raw and resolved config for a key
   - `curl <key>` — print the curl equivalent of a request
   - `edit <key>` — open the YAML file in the configured IDE
   - `quit` — exit
   - `get/set/del/run/resolve` are also exposed on the CLI object for programmatic use

4. **Request execution** — `FetchService` normalizes a raw request config object into a WHATWG `Request` and calls native `fetch`. Handles JSON, form-urlencoded, and multipart/form-data bodies automatically based on `content-type` header.

5. **File watching** — `ConfigClient.watch()` uses Chokidar to hot-reload YAML changes and re-emit updated config without restart.

### Key design conventions

- **Dot-notation keys** throughout: `configClient.get('sandman.folder.introspection.request.url')` traverses the nested config.
- **`.` prefix** on keys accesses the `dictionary['.']` (resolved variable dictionary), not the raw config tree.
- **`${self:some.key}`** syntax in YAML values is resolved by `@coderich/config` for self-referential interpolation.
- **`+.yaml` merge files** are consumed at parse time and are invisible to watchers — they do not appear as config keys.
- The `Sandman` class emits events: `save`, `api`, `request`, `response`, `error`, plus the command name for each CLI command result.

### Config directory structure

```
config/
  index.yaml          # top-level key/value config (prompt, env, etc.)
  +.yaml              # default request fields applied globally
  <name>.yaml         # defines an API at key <name>
  <name>/
    index.yaml        # defines an API at key <name>
    +.yaml            # defaults for all APIs under <name>/
    <sub>.yaml        # defines an API at key <name>.<sub>
```

### Testing

Tests live in `test/` and use Jest. The `ConfigClient.test.js` suite verifies that the YAML directory parsing, `+.yaml` merge overlays, and `get()` resolution all produce the expected nested objects. When adding new config parsing behavior, update the test expectations to reflect the resolved structure.
