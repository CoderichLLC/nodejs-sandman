// const FS = require('fs');
// const Path = require('path');
const cloneDeep = require('lodash.clonedeep');
const Config = require('@coderich/config');

module.exports = class ConfigClient extends Config {
  get(...args) {
    return cloneDeep(super.get(...args));
  }

  // mergeConfigDir(dir) {
  //   const ignored = (parsed) => {
  //     if (parsed.name.startsWith('.')) return true;
  //     const stat = FS.statSync(Path.join(parsed.dir, `${parsed.name}${parsed.ext}`));
  //     if (stat?.isDirectory()) return false;
  //     return !['.yml', '.yaml'].includes(parsed.ext.toLowerCase());
  //   };

  //   const arr = Config.dirPaths(dir, ignored);

  //   const yaml = arr.reduce((prev, { paths, data }) => {
  //     const path = paths.join('.');
  //     if (!path.length) return prev.concat(data);
  //     const indented = data.split('\n').map(line => (line.trim() ? `  ${line}` : line)).join('\n');
  //     return prev.concat(`${path}:\n${indented}`);
  //   }, '');

  //   return this.merge(Config.parseYaml(yaml));
  // }
};
