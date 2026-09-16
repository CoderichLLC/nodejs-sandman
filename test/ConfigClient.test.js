const Path = require('node:path');
const ConfigClient = require('../src/ConfigClient');

const configClient = new ConfigClient(Path.resolve(__dirname, 'config'));

describe('ConfigClient', () => {
  let targetData;

  test('get()', () => {
    targetData = configClient.get();

    expect(targetData).toEqual({
      env: 'dev',
      prompt: 'hello: ',
      request: {
        request: {
          url: 'basic',
          method: 'get',
          headers: {
            'content-type': 'application/json',
          },
        },
      },
      gql: {
        update: {
          request: {
            method: 'get',
            headers: {
              'content-type': 'application/json',
            },
            data: {
              query: 'mutation',
              variables: {
                id: 'abc',
                input: {
                  ehrConfig: {
                    vendor: 'epic',
                    scopes: ['a', 'b'],
                  },
                },
                where: undefined,
              },
            },
          },
        },
      },
      sandman: {
        folder: {
          createImage: {
            request: {
              method: 'post',
              headers: {
                'content-type': 'text/plain',
              },
            },
          },
          introspection: {
            request: {
              method: 'post',
              headers: {
                'content-type': 'multipart/form-data',
              },
            },
          },
        },
      },
    });

    expect(configClient.get()).toEqual(targetData);
  });

  test('get introspection', () => {
    expect(configClient.get('sandman.folder.introspection')).toEqual({
      request: {
        method: 'post',
        url: undefined,
        headers: {
          'content-type': 'multipart/form-data',
        },
      },
    });

    expect(configClient.get()).toEqual(targetData);
  });

  test('+.yaml defaults do not clobber explicit object values', () => {
    const { request } = configClient.get('gql.update');

    // Scalar override keeps working
    expect(request.data.variables.id).toBe('abc');

    // Object override must survive the merge (was previously replaced by the default string)
    expect(request.data.variables.input).toEqual({
      ehrConfig: {
        vendor: 'epic',
        scopes: ['a', 'b'],
      },
    });

    // Defaults still fill in where the API says nothing
    expect(request.data.variables).toHaveProperty('where', undefined);
    expect(request.method).toBe('get');
  });
});

describe('ConfigClient caching', () => {
  let client;

  beforeEach(() => {
    client = new ConfigClient(Path.resolve(__dirname, 'config'));
  });

  test('get() is memoized', () => {
    expect(client.get()).toBe(client.get());
    expect(client.get('sandman.folder.introspection')).toBe(client.get('sandman.folder.introspection'));
  });

  test('get(key, defaultValue) is not memoized (callers mutate what they get back)', () => {
    expect(client.get('sandman.folder.introspection', {})).not.toBe(client.get('sandman.folder.introspection', {}));
  });

  test('set() invalidates', () => {
    expect(client.get().env).toBe('dev');
    client.set('env', 'qa');
    expect(client.get().env).toBe('qa');
    expect(client.get('env')).toBe('qa');
  });

  test('del() invalidates', () => {
    expect(client.get()).toHaveProperty('env');
    client.del('env');
    expect(client.get().env).toBeUndefined();
  });

  test('merge() invalidates', () => {
    client.get();
    client.merge({ sandman: { folder: { fresh: { request: { url: 'new' } } } } });
    expect(client.get().sandman.folder.fresh.request).toMatchObject({ url: 'new', method: 'post' });
  });

  test('mergeDir() invalidates (watch/reload of the api folder)', () => {
    const before = client.get();
    client.set('env', 'qa');
    client.mergeDir();
    expect(client.get()).not.toBe(before);
    expect(client.get('sandman.folder.introspection').request.method).toBe('post');
  });

  test('resolve() invalidates (dictionary substitutions change)', () => {
    client.merge({ sub: { request: { url: ['$', '{dict:name}'].join('') } } });
    client.resolve({ dict: { name: 'first' } });
    expect(client.get('sub').request.url).toBe('first');
    client.resolve({ dict: { name: 'second' } });
    expect(client.get('sub').request.url).toBe('second');
  });

  test('get() stays linear as the config grows (O(n^2) merge regression)', () => {
    const apis = {};
    for (let i = 0; i < 400; i++) apis[`api${i}`] = { request: { url: `u${i}`, headers: { a: '1', b: '2' }, params: { c: '3', d: '4' } } };
    client.merge({ sandman: { folder: apis } });

    const start = process.hrtime.bigint();
    client.get();
    const ms = Number(process.hrtime.bigint() - start) / 1e6;

    // The quadratic version took ~1.8s on a config this size.
    expect(ms).toBeLessThan(500);
  });
});
