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
