const Readline = require('readline');
const Util = require('@coderich/util');

exports.createInterface = (cli, configClient) => {
  const captureInfo = {
    line: '',
    lastToken: '',
    candidates: [],
    tabCounter: 0,
    candidateIndex: -1,
    captureCandidates: false,
  };

  const readline = Readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
    completer: (line) => {
      // Show available CLI commands
      if (!line) return [Object.keys(cli), line];

      const tokens = line.split(' ');
      const lastToken = tokens.at(-1);
      const paths = lastToken.split('.');
      const path = paths.at(-1);

      // Specific request.data selector
      if (lastToken.startsWith('.')) {
        const api = configClient.get(tokens.at(-2));
        if (!api?.request) return [[], path];
        const { config } = configClient.toObject();
        const conf = Util.get(config, tokens.at(-2), {});
        return [Object.keys(conf), path];
        // const dataPath = ['request'].concat(paths.slice(1, -1)).join('.');
        // const data = get(api, dataPath, {});
        // return [Object.keys(data).filter(k => k.toLowerCase().startsWith(path.toLowerCase())), path];
      }

      //
      const flatKeys = Object.keys(Util.flatten(configClient.get()));

      // These keys follow the typing of the user
      const startsWithCandidates = Array.from(new Set(flatKeys.map((flatKey) => {
        return flatKey.split('.').slice(0, paths.length).join('.');
      }))).filter((c) => {
        return c.toLowerCase().startsWith(lastToken.toLowerCase());
      }); // .map(p => p.split('.').at(-1)); // Here!

      // These are shortcut keys to requests
      const requestKeyCandidates = Array.from(new Set(flatKeys.map((flatKey) => {
        const keys = flatKey.split('.');
        const index = keys.indexOf('request');
        return index && flatKey.split('.').slice(0, index).join('.');
        // const typedPath = keys.slice(0, paths.length - 1).join('.');
        // const autocompletePath = keys.slice(paths.length - 1, index).join('.');
        // return index > 0 && lastToken.toLowerCase().startsWith(typedPath.toLowerCase()) && autocompletePath;
      }).filter(Boolean))).filter((c) => {
        return c.toLowerCase().includes(lastToken.toLowerCase());
        // return c.toLowerCase().includes(path.toLowerCase());
      });

      const candidates = Array.from(new Set(startsWithCandidates.concat(requestKeyCandidates)));
      if (captureInfo.captureCandidates) { captureInfo.candidates = candidates; captureInfo.line = line; captureInfo.lastToken = lastToken; captureInfo.candidateIndex = -1; }
      if (candidates.length === 1 && candidates[0] === lastToken) return [[], lastToken];
      return [candidates, lastToken];
    },
  });

  process.stdin.on('keypress', (ch, key) => {
    if (key && key.name === 'tab') captureInfo.tabCounter++; else captureInfo.tabCounter = 0;
    captureInfo.captureCandidates = captureInfo.tabCounter === 2;

    if (key && key.name === 'escape') {
      readline.line = '';
      Readline.cursorTo(process.stdout, 0);
      Readline.clearLine(process.stdout, 0);
      readline.prompt();
    } else if (captureInfo.tabCounter > 2 && captureInfo.candidates.length) {
      const candidate = captureInfo.candidates[captureInfo.candidateIndex = ++captureInfo.candidateIndex % captureInfo.candidates.length];
      const value = captureInfo.line.replace(captureInfo.lastToken, candidate);
      readline.line = value;
      readline.cursor = value.length;
      readline.prompt(true);
    }
  });

  return readline;
};
