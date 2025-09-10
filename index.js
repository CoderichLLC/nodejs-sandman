const Sandman = require('./src/Sandman');

module.exports = (configDir) => {
  return new Sandman(configDir);
};
