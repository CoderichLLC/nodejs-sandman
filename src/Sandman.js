const Path = require('path');
const Merge = require('lodash.merge');
const Readline = require('readline');
const Chokidar = require('chokidar');
const EventEmitter = require('events');
const { get, flatten } = require('@coderich/util');
const FetchService = require('./FetchService');
const ConfigClient = require('./ConfigClient');

const resolveSymbol = Symbol('resolve');

module.exports = class Sandman extends EventEmitter {
  #configClient; #configDir; #options; #watcher; #readline; #mergeData = {}; #cli;
  #captureCandidates = false; #candidates = []; #tabCounter = 0; #candidateIndex = 0; #line; #lastToken;

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
    return Object.defineProperties(this.#cli, {
      resolve: {
        value: (...args) => {
          this.#configClient.resolve(...args);
          this.#prompt();
          return this.#cli;
        },
        configurable: true,
      },
    });
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
      const $request = FetchService.decorateRequest(this.#mergeData, key, value.request);
      const request = this.#configClient.set(resolveSymbol, $request).get(resolveSymbol);
      this.#configClient.del(resolveSymbol);
      return Merge({}, value, { request });
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
        // Show available CLI commands
        if (!line) return [Object.keys(this.#cli), line];

        const tokens = line.split(' ');
        const lastToken = tokens.at(-1);
        const paths = lastToken.split('.');
        const path = paths.at(-1);

        // Specific request.data selector
        if (lastToken.startsWith('.')) {
          const api = this.#get(tokens.at(-2));
          if (!api?.request) return [[], path];
          const dataPath = ['request'].concat(paths.slice(1, -1)).join('.');
          const data = get(api, dataPath, {});
          return [Object.keys(data).filter(k => k.toLowerCase().startsWith(path.toLowerCase())), path];
        }

        //
        const flatKeys = Object.keys(flatten(this.#configClient.get()));

        // These keys follow the typing of the user
        const startsWithCandidates = Array.from(new Set(flatKeys.map((flatKey) => {
          return flatKey.split('.').slice(0, paths.length).join('.');
        }))).filter((c) => {
          return c.toLowerCase().startsWith(lastToken.toLowerCase());
        }); // .map(p => p.split('.').at(-1)); // Here!

        // These are shortcut keys to requests
        const requestKeyCandidates = Array.from(new Set(flatKeys.map((flatKey) => {
          const keys = flatKey.split('.');
          const index = keys.indexOf('request');
          return index && flatKey.split('.').slice(0, index).join('.');
          // const typedPath = keys.slice(0, paths.length - 1).join('.');
          // const autocompletePath = keys.slice(paths.length - 1, index).join('.');
          // return index > 0 && lastToken.toLowerCase().startsWith(typedPath.toLowerCase()) && autocompletePath;
        }).filter(Boolean))).filter((c) => {
          return c.toLowerCase().includes(lastToken.toLowerCase());
          // return c.toLowerCase().includes(path.toLowerCase());
        });

        const candidates = Array.from(new Set(startsWithCandidates.concat(requestKeyCandidates)));
        if (this.#captureCandidates) { this.#candidates = candidates; this.#line = line; this.#lastToken = lastToken; }
        return [candidates, lastToken];
      },
    });

    process.stdin.on('keypress', (ch, key) => {
      if (key && key.name === 'tab') this.#tabCounter++; else this.#tabCounter = 0;
      this.#captureCandidates = this.#tabCounter === 2;

      if (key && key.name === 'escape') {
        this.#readline.line = '';
        Readline.cursorTo(process.stdout, 0);
        Readline.clearLine(process.stdout, 0);
        this.#readline.prompt();
      } else if (this.#tabCounter > 2 && this.#candidates.length) {
        let value = this.#candidates.at(this.#candidateIndex++);

        if (!value) {
          this.#candidateIndex = 0;
          value = this.#candidates.at(this.#candidateIndex++);
        }

        value = this.#line.replace(this.#lastToken, value);
        this.#readline.line = value;
        this.#readline.cursor = value.length;
        this.#readline.prompt(true);
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
        this.#prompt();
      } else if (['unlink', 'unlinkDir'].includes(event)) {
        this.#configClient.del(key);
        this.#prompt();
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
