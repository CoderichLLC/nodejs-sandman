const Path = require('node:path');
const EventEmitter = require('node:events');
const { spawn } = require('node:child_process');
const ReadlineService = require('./ReadlineService');
const UtilService = require('./UtilService');
const CURLService = require('./CURLService');
const FetchService = require('./FetchService');
const ConfigClient = require('./ConfigClient');

const cmdNotFound = Symbol('cmdNotFound');

module.exports = class Sandman extends EventEmitter {
  #configClient; #options; #readline; #cli; #cliCounter = 0; #configDir;

  constructor(configDir, options) {
    super();
    this.#options = options;
    this.#configDir = configDir;
    this.#configClient = new ConfigClient(this.#configDir);
    this.#createCLI();
    this.#readline = ReadlineService.createInterface(this.#cli, this.#configClient);
    this.#configClient.watch(this.#configDir, event => this.emit('save', event));

    this.#readline.on('line', (line) => {
      if (!line) return this.prompt();
      const [cmd, key, ...args] = UtilService.parseArgs(line.trim());
      const $cmd = Object.keys(this.#cli).includes(cmd) ? cmd : cmdNotFound;
      return this.#cli[$cmd](key, ...args)
        .then(value => this.emit($cmd, value))
        .catch(error => this.emit('error', { key: $cmd, error }));
    });
  }

  emit(event, ...args) {
    if (event === 'error' && !this.listenerCount('error')) return false;
    return super.emit(event, ...args);
  }

  cli() {
    return this.#cli;
  }

  prompt() {
    this.#readline.setPrompt(this.#configClient.get('prompt'));
    this.#readline.prompt(true);
    return this;
  }

  #run(key, opts = { emit: true }) {
    const api = this.#configClient.get(key, {});

    if (!api?.request) {
      if (opts.emit) this.emit('error', { key, error: `Request "${key}" Not Found` });
      return Promise.reject(new Error(`Request "${key}" Not Found`));
    }

    if (opts.emit) this.emit('api', { api, key });
    const request = FetchService.normalizeRequest(api.request);
    if (opts.emit) this.emit('request', { request, api, key });

    return FetchService.fetch(request).then(({ response, data }) => {
      if (opts.emit) this.emit('response', { response, api, key, data });
      return { response, api, key, data };
    }).catch((error) => {
      if (opts.emit) this.emit('error', { key, api, error });
      return Promise.reject(error);
    }).then((results) => {
      return results.response.ok ? results : Promise.reject(results);
    });
  }

  #createCLI() {
    const self = this;

    this.#cli = Object.defineProperties(new Proxy({
      '/': (...args) => this.#run(...args),
      edit: (key, ext = '.yaml') => {
        const path = this.#configClient.get('ide', 'open');
        const filePath = Path.join(this.#configDir, ...key.split('.')).concat('.yaml');
        const child = spawn(path, [filePath], { detached: true, stdio: 'ignore' });
        child.unref();
      },
      view: key => ({
        $: this.#configClient.raw(key),
        [key]: this.#configClient.get(key),
      }),
      curl: key => CURLService.toCURL(this.#configClient.get(key, {}).request),
      quit: () => process.exit(),
    }, {
      get(obj, prop, receiver) {
        const value = Reflect.get(obj, prop, receiver);

        if (typeof value === 'function') {
          return (...args) => {
            const result = new Promise((resolve) => { resolve(value.apply(this, args)); });

            if (self.#cliCounter > 0) return result;

            self.#cliCounter++;
            self.#readline.pause();
            result.catch(() => null).finally(() => setImmediate(() => {
              if (--self.#cliCounter === 0) self.prompt();
            }));
            return result;
          };
        }

        return value;
      },
    }), {
      get: {
        configurable: true,
        value: (...args) => this.#configClient.get(...args),
      },
      set: {
        configurable: true,
        value: (...args) => this.#configClient.set(...args),
      },
      del: {
        configurable: true,
        value: (...args) => this.#configClient.del(...args),
      },
      run: {
        configurable: true,
        value: (...args) => this.#run(...args),
      },
      [cmdNotFound]: {
        configurable: true,
        value: key => this.emit('error', { key, error: 'Command Not Found' }),
      },
      resolve: {
        configurable: true,
        value: (...args) => {
          this.#configClient.resolve(...args);
          return this.#cli;
        },
      },
    });
  }
};
