const FS = require('node:fs');
const Path = require('node:path');
const Chokidar = require('chokidar');
const Config = require('@coderich/config');
const Util = require('@coderich/util');

const dataSymbol = Symbol('dataSymbol');
const cacheSymbol = Symbol('cacheSymbol');
const internalSymbol = Symbol('internalSymbol');

// Symbol-keyed properties and a module-scope function rather than private fields/methods:
// `Config`'s constructor calls `merge()` -> `resolve()`, which lands in our override *before*
// any class field or private method exists on the instance (a `this.#x` there would throw).
const invalidate = (self) => {
  if (!self[internalSymbol]) self[cacheSymbol]?.clear();
  return self;
};

module.exports = class ConfigClient extends Config {
  #configDir; #mergeData = {}; [cacheSymbol] = new Map();

  constructor(configDir) {
    super({}, {
      file: (name) => {
        if (name == null || `${name}` === 'undefined') return name;
        const path = Path.resolve(process.cwd(), name);
        try {
          const buffer = FS.readFileSync(path);
          return new File([buffer], name);
        } catch {
          process.stdout.write(`Unable to load file: "${name}"\n`);
          return undefined;
        }
      },
    });
    this.#configDir = configDir;
    this.mergeDir();
  }

  get(key, ...args) {
    if (key?.startsWith?.('.')) {
      const { dictionary } = this.toObject();
      const k = key.substring(1);
      return k.length ? Util.get(dictionary['.'], k) : dictionary['.'];
    }

    // Memoized only when no defaultValue was passed: the cache is keyed by `key` alone, and
    // `Sandman.#run` (the one caller that mutates what it gets back, via
    // `FetchService.normalizeRequest`) always passes a default. Every mutation funnels through
    // `resolve()`/`flush()`/`#ignore()`, which drop the cache — see `invalidate`.
    const cacheable = args.length === 0;
    if (cacheable && this[cacheSymbol].has(key)) return this[cacheSymbol].get(key);

    const data = super.get(key, ...args);
    const mergedData = this.#mergeMergeData(key, data);

    // `set`/`del` of `dataSymbol` is a scratch write that resolves substitutions and is undone
    // immediately; it must not drop the cache we are in the middle of populating.
    this[internalSymbol] = true;
    let resolvedData;
    try {
      this.set(dataSymbol, mergedData);
      resolvedData = super.get(dataSymbol);
      this.del(dataSymbol);
    } finally {
      this[internalSymbol] = false;
    }

    if (cacheable) this[cacheSymbol].set(key, resolvedData);
    return resolvedData;
  }

  // Every `Config` mutation (`set`, `del`, `merge`) ends in `resolve()`, so overriding it here
  // covers them all. `flush()` is the one that bypasses it.
  resolve(...args) {
    return invalidate(super.resolve(...args));
  }

  flush(...args) {
    return invalidate(super.flush(...args));
  }

  raw(key = '') {
    const data = Util.get(this.toObject().config, key);
    return this.#mergeMergeData(key, data);
  }

  set(key = '', value) {
    if (key.startsWith?.('.')) return this.resolve({ '.': { [key.substring(1)]: value } });
    return super.set(key, value);
  }

  del(key = '') {
    if (key.startsWith?.('.')) return Util.set(this.toObject().dictionary['.'], [key.substring(1)], undefined);
    return super.del(key);
  }

  mergeDir(dir = this.#configDir) {
    return this.merge(Config.parseDir(dir, (...args) => this.#ignore(...args)));
  }

  watch(dir = this.#configDir, onSave) {
    const watcher = Chokidar.watch(dir, {
      awaitWriteFinish: true,
      ignoreInitial: true,
      ignored: filepath => this.#ignore(this.#normalizeWatcherPath(filepath)),
    });

    watcher.on('all', (event, path) => {
      const { key } = this.#normalizeWatcherPath(path);

      if (['add', 'change'].includes(event)) {
        const api = Config.parseFile(path);
        if (key) this.set(key, api);
        else this.merge(api); // index.yaml
        if (api.request) onSave({ key, api });
      } else if (['unlink', 'unlinkDir'].includes(event)) {
        this.del(key);
      }
    });

    return watcher;
  }

  #mergeMergeData(key, data) {
    const flatData = key === undefined ? Util.flatten(data) : Util.flatten({ [key]: data });
    const apiKeys = Array.from(new Set(Object.keys(flatData).map(k => k.substring(0, Math.max(k.indexOf('.request'), 0))).filter(Boolean)));

    const mergeKeys = Object.keys(this.#mergeData).reverse();

    // A `+.yaml` default only fills a path the API leaves undefined. Because `flatData` holds
    // leaf keys, an API value that is an object (or array) lives under child keys, so the exact
    // path is absent from `flatData` — check for descendants too or the default clobbers it.
    // `ancestors` holds every dotted prefix of every key, so `ancestors.has(path)` answers
    // "does some key start with `path.`?" in O(1). Scanning `Object.keys(flatData)` per default
    // instead made this O(apiKeys * defaults * keys) — ~1.8s per tab-complete on a 400-api config.
    const ancestors = new Set();
    const addAncestors = (flatKey) => {
      for (let i = flatKey.indexOf('.'); i !== -1; i = flatKey.indexOf('.', i + 1)) ancestors.add(flatKey.substring(0, i));
    };
    Object.keys(flatData).forEach(addAncestors);

    const isDefined = path => flatData[path] != null || ancestors.has(path);

    const applyDefaults = (apiKey, defaults) => {
      Object.entries(defaults).forEach(([k, v]) => {
        const path = `${apiKey}.${k}`;
        // Defaults land in `flatData` as we go, so a later default must see the earlier one.
        if (!isDefined(path)) { flatData[path] = v; addAncestors(path); }
      });
    };

    apiKeys.forEach((apiKey) => {
      mergeKeys.forEach((mergeKey) => {
        if (apiKey.startsWith(mergeKey)) applyDefaults(apiKey, this.#mergeData[mergeKey][dataSymbol]);
      });
      if (this.#mergeData[dataSymbol]) applyDefaults(apiKey, this.#mergeData[dataSymbol]);
    });

    const unflatData = Util.unflatten(flatData);
    return key === undefined ? unflatData : Util.get(unflatData, key);
  }

  #ignore({ name, filepath, paths }) {
    if (name.startsWith('.')) return true;

    if (name.startsWith('+')) {
      const path = paths.slice(0, -1).join('.');
      const request = Util.flatten(Config.parseFile(filepath));

      // Chokidar re-runs `ignored` for paths it has already seen, so only drop the cache when
      // the defaults actually changed — `#mergeData` feeds `#mergeMergeData` and bypasses
      // `Config`, so nothing else would invalidate it.
      const previous = path ? this.#mergeData[path]?.[dataSymbol] : this.#mergeData[dataSymbol];

      if (!Util.isEqual(previous, request)) {
        if (path) this.#mergeData[path] = { [dataSymbol]: request };
        else this.#mergeData[dataSymbol] = request;
        invalidate(this);
      }

      return true;
    }

    return false;
  }

  #normalizeWatcherPath = (filepath) => {
    const parsed = Path.parse(filepath);
    const folder = filepath.substring(this.#configDir.length + 1, filepath.length - parsed.ext.length);
    const paths = folder.split('/').filter(el => el && el !== 'index');
    const key = paths.join('.');
    return { ...parsed, filepath, paths, key };
  };

  // mergeConfigDir(dir) {
  //   const ignored = (parsed) => {
  //     if (parsed.name.startsWith('.')) return true;
  //     const stat = FS.statSync(Path.join(parsed.dir, `${parsed.name}${parsed.ext}`));
  //     if (stat?.isDirectory()) return false;
  //     return !['.yml', '.yaml'].includes(parsed.ext.toLowerCase());
  //   };

  //   const arr = Config.dirPaths(dir, ignored);

  //   const yaml = arr.reduce((prev, { paths, data }) => {
  //     const path = paths.join('.');
  //     if (!path.length) return prev.concat(data);
  //     const indented = data.split('\n').map(line => (line.trim() ? `  ${line}` : line)).join('\n');
  //     return prev.concat(`${path}:\n${indented}`);
  //   }, '');

  //   return this.merge(Config.parseYaml(yaml));
  // }
};
