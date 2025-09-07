const Sandman = require('./Sandman');

module.exports = (configDir, options) => {
  return new Sandman(configDir, options);
};
