const Path = require('path');
const Readline = require('readline');
const Chokidar = require('chokidar');
const EventEmitter = require('events');
const { get, flatten } = require('@coderich/util');
const FetchService = require('./FetchService');
const ConfigClient = require('./ConfigClient');

module.exports = class Sandman extends EventEmitter {
  #configClient; #configDir; #options; #watcher; #readline; #mergeData = {}; #cli;

  constructor(configDir, options) {
    super();
    this.#configDir = configDir;
    this.#options = options;
    this.#configClient = new ConfigClient().merge(ConfigClient.parseDir(configDir, arg => this.#ignore(arg)));
    this.#createInterface();
    this.#createWatcher();
    this.#createCLI();
    this.#prompt();

    this.#readline.on('line', async (line) => {
      if (!line) return this.#readline.prompt();
      const [cmd, ...args] = line.trim().split(' ');
      const info = this.#cli[cmd] ? { cmd, args } : { cmd: 'run', args: [cmd, ...args] };
      const value = await Promise.resolve(this.#cli[info.cmd](...info.args)).catch(e => e);
      return this.emit(cmd, value);
    });
  }

  cli() {
    return this.#cli;
  }

  #run(key) {
    const api = this.#get(key, {});
    if (!api?.request) return this.emit('error', { key, error: `Request "${key}" Not Found` });
    this.emit('request', { key, api });

    return FetchService.fetch(api.request).then(({ res, data }) => {
      this.emit('response', { key, api, res, data });
      return { key, api, res, data };
    }).catch((error) => {
      this.emit('error', { key, api, error });
      return Promise.reject(error);
    }).then((results) => {
      return results.res.ok ? results : Promise.reject(results);
    });
  }

  #prompt() {
    this.#readline.setPrompt(this.#configClient.get('prompt'));
    this.#readline.prompt();
    return this;
  }

  #get(key, ...rest) {
    const { config } = this.#configClient.toObject();
    const value = get(config, key);

    if (value?.request) {
      const request = FetchService.decorateRequest(this.#mergeData, key, value.request);
      this.#configClient.merge({ [key]: { request } });
    }

    return this.#configClient.get(key, ...rest);
  }

  #createCLI() {
    const self = this;

    this.#cli = new Proxy({
      run: (...args) => this.#run(...args),
      get: (...args) => this.#get(...args),
      set: (key = '', value = null) => this.#configClient.set(key, value),
      del: (key = '') => this.#configClient.del(key),
      quit: () => process.exit(),
    }, {
      get(obj, prop, receiver) {
        const value = Reflect.get(obj, prop, receiver);

        if (typeof value === 'function') {
          return (...args) => {
            const result = value(...args);
            setImmediate(() => self.#prompt());
            return result;
          };
        }

        return value;
      },
    });
  }

  #createInterface() {
    this.#readline = Readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
      completer: (line) => {
        const tokens = line.split(' ');
        const path = tokens.at(-1);
        const pathParts = path.split('.');

        if (!line) {
          const cmds = Object.keys(this.#cli);
          return [cmds.filter(c => c.startsWith(line)), line];
        }

        const flatKeys = Object.keys(flatten(this.#configClient.get()));

        // These keys follow the typing of the user
        const startsWithCandidates = Array.from(new Set(flatKeys.map((flatKey) => {
          return flatKey.split('.').slice(0, pathParts.length).join('.');
        }))).filter((c) => {
          return c.toLowerCase().startsWith(path.toLowerCase());
        });

        // These are shortcut keys to requests
        const requestKeyCandidates = Array.from(new Set(flatKeys.map((flatKey) => {
          const keys = flatKey.split('.');
          const index = keys.indexOf('request');
          return index > 0 && keys.slice(0, index).join('.');
        }).filter(Boolean))).filter((c) => {
          return c.toLowerCase().includes(path.toLowerCase());
        });

        const candidates = Array.from(new Set(startsWithCandidates.concat(requestKeyCandidates)));

        return [candidates, path];
      },
    });

    process.stdin.on('keypress', (ch, key) => {
      if (key && key.name === 'escape') {
        this.#readline.line = '';
        Readline.cursorTo(process.stdout, 0);
        Readline.clearLine(process.stdout, 0);
        this.#readline.prompt();
      }
    });
  }

  #createWatcher() {
    this.#watcher = Chokidar.watch(this.#configDir, {
      awaitWriteFinish: true,
      ignoreInitial: true,
      ignored: filepath => this.#ignore(this.#normalizeWatcherPath(filepath)),
    });

    this.#watcher.on('all', (event, path) => {
      const { key } = this.#normalizeWatcherPath(path);

      if (['add', 'change'].includes(event)) {
        const api = ConfigClient.parseFile(path);
        if (key) this.#configClient.set(key, api);
        else this.#configClient.merge(api);
        if (api.request) this.emit('save', { key, api });
      } else if (['unlink', 'unlinkDir'].includes(event)) {
        this.#configClient.del(key);
      }
    });
  }

  #ignore({ name, filepath, paths }) {
    if (name.startsWith('.')) return true;

    if (name.startsWith('+')) {
      const request = ConfigClient.parseFile(filepath);
      const key = paths.slice(0, -1).join('.');
      if (key) this.#mergeData[key] = { request };
      else this.#mergeData.request = request;
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
};
