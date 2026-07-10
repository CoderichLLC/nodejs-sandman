const Path = require('node:path');
const EventEmitter = require('node:events');
const { spawn } = require('node:child_process');
const Util = require('@coderich/util');
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
      if (!line?.trim()) return this.prompt();
      const { cmd, keyToken, positional, query } = UtilService.parseLine(line.trim());
      const $cmd = Object.keys(this.#cli).includes(cmd) ? cmd : cmdNotFound;
      let key; let args;

      // A bare `<cmd>` (no key, no query) replays the prior `$key`/`$args`, forwarding
      // the prior positional args downstream. Otherwise capture `$args` fresh from the
      // line (index-driven positional + user-defined query pairs) and forward the
      // positional args to the cli method for programmatic use.
      if (keyToken === undefined && !query) {
        key = this.#configClient.get('$key');
        args = UtilService.toPositional(this.#configClient.get('$args'));
      } else {
        key = keyToken ?? this.#configClient.get('$key');
        args = positional;
        this.#configClient.set('$args', UtilService.buildArgs(positional, query));
      }

      // Default ops capture $key
      if (['/', 'edit', 'view', 'curl'].includes($cmd)) this.#configClient.set('$key', key);

      return Promise.resolve(this.#cli[$cmd](key, ...args))
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
    this.#readline.setPrompt(this.#configClient.get('$prompt'));
    this.#readline.prompt(true);
    return this;
  }

  async #run(key, opts) {
    // Forwarded positional args (strings) must not be mistaken for the programmatic opts.
    opts = opts?.constructor === Object ? opts : { emit: true };
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

      // Assign feature
      Object.entries(api.assign || {}).forEach(([k, path]) => {
        this.#configClient.set(k, path ? Util.get(data, path) : data);
      });

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
      edit: (key) => {
        const path = this.#configClient.get('$ide', 'open');
        const filePath = Path.join(this.#configDir, ...key.split('.')).concat('.yaml');
        const child = spawn(path, [filePath], { detached: true, stdio: 'ignore' });
        child.unref();
      },
      view: key => ({
        $: this.#configClient.raw(key),
        [key]: this.#configClient.get(key),
      }),
      curl: async (key) => {
        const { path, params, ...raw } = this.#configClient.get(key, {}).request ?? {};
        const { url } = FetchService.normalizeRequest({ ...raw, path, params });
        return CURLService.toCURL({ ...raw, url });
      },
      quit: () => process.exit(),
    }, {
      get(obj, prop, receiver) {
        const value = Reflect.get(obj, prop, receiver);

        if (typeof value === 'function') {
          return (...args) => {
            self.#cliCounter++;
            self.#readline.pause();
            const result = value.apply(this, args);
            Promise.resolve(result).catch(() => null).finally(() => setImmediate(() => {
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
