const FS = require('node:fs');
const Path = require('node:path');
const Chokidar = require('chokidar');
const Config = require('@coderich/config');
const Util = require('@coderich/util');

const dataSymbol = Symbol('dataSymbol');

module.exports = class ConfigClient extends Config {
  #configDir; #mergeData = {};

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

    const data = super.get(key, ...args);
    const mergedData = this.#mergeMergeData(key, data);
    this.set(dataSymbol, mergedData);
    const resolvedData = super.get(dataSymbol);
    this.del(dataSymbol);
    return resolvedData;
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
    const isDefined = path => flatData[path] != null || Object.keys(flatData).some(k => k.startsWith(`${path}.`));

    const applyDefaults = (apiKey, defaults) => {
      Object.entries(defaults).forEach(([k, v]) => {
        const path = `${apiKey}.${k}`;
        if (!isDefined(path)) flatData[path] = v;
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
      if (path) this.#mergeData[path] = { [dataSymbol]: request };
      else this.#mergeData[dataSymbol] = request;
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
