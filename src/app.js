const Sandman = require('./Sandman');

module.exports = (configDir) => {
  return new Sandman(configDir);
};
