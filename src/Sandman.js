const EventEmitter = require('events');
const ReadlineService = require('./ReadlineService');
const FetchService = require('./FetchService');
const ConfigClient = require('./ConfigClient');

module.exports = class Sandman extends EventEmitter {
  #configClient; #options; #readline; #cli; #cliCounter = 0;

  constructor(configDir, options) {
    super();
    this.#options = options;
    this.#configClient = new ConfigClient(configDir);
    this.#createCLI();
    this.#readline = ReadlineService.createInterface(this.#cli, this.#configClient);

    this.#readline.on('line', async (line) => {
      if (!line) return this.#readline.prompt();
      const [cmd, ...args] = line.trim().split(' ');
      const info = this.#cli[cmd] ? { cmd, args } : { cmd: 'run', args: [cmd, ...args] };
      const value = await Promise.resolve(this.#cli[info.cmd](...info.args)).catch(e => e);
      return this.emit(cmd, value);
    });

    this.#prompt();
  }

  cli() {
    return Object.defineProperties(this.#cli, {
      resolve: {
        value: (...args) => {
          this.#configClient.resolve(...args);
          return this.#cli;
        },
        configurable: true,
      },
    });
  }

  #run(key) {
    const api = this.#configClient.get(key, {});
    if (!api?.request) return this.emit('error', { key, error: `Request "${key}" Not Found` });
    this.emit('api', { api, key });
    const request = FetchService.normalizeRequest(api.request);
    this.emit('request', { request, api, key });

    return FetchService.fetch(request).then(({ response, data }) => {
      this.emit('response', { response, api, key, data });
      return { response, api, key, data };
    }).catch((error) => {
      this.emit('error', { key, api, error });
      return Promise.reject(error);
    }).then((results) => {
      return results.response.ok ? results : Promise.reject(results);
    });
  }

  #prompt() {
    this.#readline.setPrompt(this.#configClient.get('prompt'));
    this.#readline.prompt(true);
    return this;
  }

  #createCLI() {
    const self = this;

    this.#cli = new Proxy({
      run: (...args) => this.#run(...args),
      get: (...args) => this.#configClient.get(...args),
      set: (key = '', value = null) => this.#configClient.set(key, value),
      del: (key = '') => this.#configClient.del(key),
      curl: key => FetchService.toCURL(this.#configClient.get(key, {}).request),
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
              if (--self.#cliCounter === 0) self.#prompt();
            }));
            return result;
          };
        }

        return value;
      },
    });
  }
};
