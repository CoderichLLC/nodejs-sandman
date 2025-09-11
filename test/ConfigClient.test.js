const Path = require('path');
const ConfigClient = require('../src/ConfigClient');

const appRootDir = Path.resolve(__dirname, '..');
const configClient = new ConfigClient(Path.join(appRootDir, 'config'));

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
      sandman: {
        folder: {
          introspection: {
            request: {
              method: 'post',
              url: undefined,
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
});
