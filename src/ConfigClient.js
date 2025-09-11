const Path = require('path');
const Chokidar = require('chokidar');
const Config = require('@coderich/config');
const Util = require('@coderich/util');

const dataSymbol = Symbol('dataSymbol');

module.exports = class ConfigClient extends Config {
  #configDir; #mergeData = {};

  constructor(configDir) {
    super();
    this.#configDir = configDir;
    this.mergeDir();
  }

  get(key, ...args) {
    const data = super.get(key, ...args);
    const flatData = key === undefined ? Util.flatten(data) : Util.flatten({ [key]: data });
    const apiKeys = Array.from(new Set(Object.keys(flatData).map(k => k.substring(0, Math.max(k.indexOf('.request'), 0))).filter(Boolean)));

    apiKeys.forEach((apiKey) => {
      Reflect.ownKeys(this.#mergeData).forEach((mergeKey) => {
        if (mergeKey === dataSymbol) flatData[apiKey] = { ...this.#mergeData[dataSymbol], ...flatData[apiKey] };
        else if (apiKey.startsWith(mergeKey)) flatData[apiKey] = { ...this.#mergeData[mergeKey][dataSymbol], ...flatData[apiKey] };
      });
    });

    const unflatData = Util.unflatten(flatData);
    const rawData = key === undefined ? unflatData : Util.get(unflatData, key);
    super.set(dataSymbol, rawData);
    return super.get(dataSymbol);
  }

  mergeDir(dir = this.#configDir) {
    return this.merge(Config.parseDir(dir, (...args) => this.#ignore(...args)));
  }

  watch(dir = this.#configDir) {
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
        // if (api.request) this.emit('save', { key, api });
      } else if (['unlink', 'unlinkDir'].includes(event)) {
        this.del(key);
      }
    });
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

  // exports.decorateRequest = (mergeData, key, request) => {
  //   const toMerge = key.split('.').reduce((prev, k, i, arr) => {
  //     const $key = arr.slice(0, i).join('.');
  //     return Merge({}, prev, mergeData[$key]?.request);
  //   }, Merge({}, mergeData.request));

  //   return Merge({}, toMerge, request);
  // };

  // #get(key, ...rest) {
  //   const { config } = this.#configClient.toObject();
  //   const value = get(config, key);

  //   if (value?.request) {
  //     const $request = FetchService.decorateRequest(this.#mergeData, key, value.request);
  //     const request = this.#configClient.resolve({ vars: value.request.vars }).set(resolveSymbol, $request).get(resolveSymbol);
  //     this.#configClient.del(resolveSymbol);
  //     return Merge({}, value, { request });
  //   }

  //   return this.#configClient.get(key, ...rest);
  // }

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
