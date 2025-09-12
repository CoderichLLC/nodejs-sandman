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
      if (!line) return this.#prompt();
      const [cmd, ...args] = Sandman.parseArgs(line.trim());
      const info = this.#cli[cmd] ? { cmd, args } : { cmd: 'run', args: [cmd, ...args] };
      const value = await Promise.resolve(this.#cli[info.cmd](...info.args)).catch(e => e);
      return this.emit(cmd, value);
    });

    this.#configClient.watch();
    this.#prompt();
  }

  cli() {
    return this.#cli;
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

  set(key, value) {
    if (key.startsWith?.('.')) this.resolve({ '.': { [key.substring(1)]: value } });
    return super.set(key, value);
  }

  #createCLI() {
    const self = this;

    this.#cli = Object.defineProperties(new Proxy({
      raw: key => this.#configClient.raw(key),
      get: (...args) => this.#configClient.get(...args),
      set: (...args) => this.#configClient.set(...args),
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
    }), {
      run: {
        configurable: true,
        value: (...args) => this.#run(...args),
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

  static parseArgs(line) {
    const regex = /"([^"]*)"|'([^']*)'|(\S+)/g;
    const args = [];
    let match;

    while ((match = regex.exec(line)) !== null) {
      if (match[1] !== undefined) {
        args.push(match[1]); // double-quoted
      } else if (match[2] !== undefined) {
        args.push(match[2]); // single-quoted
      } else if (match[3] !== undefined) {
        args.push(match[3]); // bare word
      }
    }

    return args;
  }
};
