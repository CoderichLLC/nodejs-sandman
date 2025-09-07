const Path = require('path');
const Readline = require('readline');
const Chokidar = require('chokidar');
const EventEmitter = require('events');
const { flatten } = require('@coderich/util');
const FetchService = require('./FetchService');
const ConfigClient = require('./ConfigClient');

module.exports = class Sandman extends EventEmitter {
  #configClient; #configDir; #options; #watcher; #readline; #mergeData = {};

  constructor(configDir, options) {
    super();
    this.#configDir = configDir;
    this.#options = options;
    this.#configClient = new ConfigClient().merge(ConfigClient.parseDir(configDir, arg => this.#ignore(arg)));
    this.#createInterface();
    this.#createWatcher();
    this.#prompt();

    this.on('get', () => setImmediate(() => this.#prompt()));
    this.on('set', () => setImmediate(() => this.#prompt()));
    this.on('del', () => setImmediate(() => this.#prompt()));
    this.on('save', () => setImmediate(() => this.#prompt()));
    this.on('response', () => setImmediate(() => this.#prompt()));
    this.#readline.on('line', async (line) => {
      const [cmd, ...args] = line.trim().split(' ');
      const value = await Promise.resolve(this[cmd]?.(...args));
      this.emit(cmd, value);
      this.#readline.prompt();
    });
  }

  get(...args) {
    return this.#get(...args);
  }

  set(key, value = null) {
    return this.#configClient.set(key, this.#configClient.get(value, value));
  }

  del(key = '') {
    return this.#configClient.del(key);
  }

  run(key) {
    const api = this.#get(key, {});
    if (!api?.request) return this.emit('error', new Error(`Request "${key}" Not Found`));
    const { assignTo, ...req } = api.request;
    this.emit('request', { key, api, req });

    return FetchService.fetch(req).then((res) => {
      if (assignTo) this.#configClient.set(assignTo, res);
      this.emit('response', { key, api, req, res });
      return res;
    }).catch((e) => {
      this.emit('error', e);
    });
  }

  quit() {
    process.exit();
    return this;
  }

  #prompt() {
    this.#readline.setPrompt(this.#configClient.get('prompt'));
    this.#readline.prompt();
    return this;
  }

  #get(key, ...rest) {
    const value = this.#configClient.get(key, ...rest);

    if (value?.request) {
      const tmpKey = '$$RESOLVE$$';
      value.request = this.#configClient.set(tmpKey, FetchService.decorateRequest(this.#mergeData, key, value.request)).get(tmpKey);
      this.#configClient.del(tmpKey);
    }

    return value;
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

        if (tokens.length < 2) {
          const cmds = Sandman.#getOwnMethods(Sandman, EventEmitter);
          return [cmds.filter(c => c.startsWith(line)), line];
        }

        const keys = Object.keys(flatten(this.#configClient.get()));
        const cmds = Array.from(new Set(keys.map(k => k.split('.').slice(0, pathParts.length).join('.'))));
        return [cmds.filter(c => c.toLowerCase().startsWith(path.toLowerCase())), path];

        // const paths = key.split('.');
        // const last = paths.pop();
        // const path = paths.join('.') || undefined;
        // const cmds = Object.keys(this.#configClient.get(path, {}));
        // return [cmds.filter(c => c.toLowerCase().startsWith(last.toLowerCase())), last];

        // if (tokens.length === 2) {
        //   const paths = base.split('.');
        //   const last = paths.pop();
        //   const path = paths.join('.') || undefined;
        //   const cmds = Object.keys(this.#configClient.get(path));
        //   return [cmds.filter(c => c.toLowerCase().startsWith(last)), last];
        // }

        // const tuples = rest.at(-1).split('=');
        // const [key, value] = tuples;

        // if (tuples.length < 2) {
        //   const paths = key.split('.');
        //   const last = paths.pop();
        //   const path = root.split('.').concat(paths).join('.');
        //   const cmds = Object.keys(this.#configClient.get(path));
        //   return [cmds.filter(c => c.startsWith(last)), last];
        // }

        // const paths = value.split('.');
        // const last = paths.pop();
        // const path = paths.join('.') || undefined;
        // const cmds = Object.keys(this.#configClient.get(path));
        // return [cmds.filter(c => c.startsWith(last)), last];
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

  static #getOwnMethods(cls, base = Object) {
    const own = Object.getOwnPropertyNames(cls.prototype).filter(m => m !== 'constructor' && typeof cls.prototype[m] === 'function');
    const inherited = Object.getOwnPropertyNames(base.prototype || {});
    return own.filter(m => !inherited.includes(m));
  }
};
