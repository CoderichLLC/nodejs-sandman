const Readline = require('readline');
const Util = require('@coderich/util');
const UtilService = require('./UtilService');

exports.createInterface = (cli, configClient) => {
  const captureInfo = {
    line: '',
    lastArg: '',
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
      const [cmd, ...args] = UtilService.parseArgs(line);

      // Show available CLI commands
      if (!cmd) return [Object.keys(cli), line];
      if (line.split(' ').length < 2) return [Object.keys(cli).filter(key => key.toLowerCase().startsWith(cmd.toLowerCase())), line];

      const lastArg = args.at(-1) || '';
      const lastPaths = lastArg.split('.');
      const lastPath = lastPaths.at(-1); // current typing
      const previousPath = lastPaths.slice(0, -1).join('.');

      // Specific request.data selector
      if (lastArg.startsWith('.')) {
        const requestAttrPath = `${args.at(-2)}.request${previousPath}`;
        const requestAttrObj = configClient.get(requestAttrPath, {});
        return [Object.keys(requestAttrObj).filter(key => key.toLowerCase().startsWith(lastPath.toLowerCase())), lastPath];
      }

      //
      const flatKeys = Object.keys(Util.flatten(configClient.get()));
      const requestKeys = flatKeys.map(k => k.substring(0, Math.max(k.indexOf('.request'), 0))).filter(Boolean);

      const candidates = Array.from(new Set(requestKeys
        .filter(requestKey => requestKey.toLowerCase().startsWith(previousPath.toLowerCase()))
        .filter(requestKey => requestKey.split('.').slice(lastPaths.length - 1).join('.').toLowerCase().includes(lastPath.toLowerCase()))
        // .concat(Object.keys(cli).filter(key => key.toLowerCase().startsWith(cmd.toLowerCase())))
      ));

      if (captureInfo.captureCandidates && lastArg) { captureInfo.candidates = candidates; captureInfo.line = line; captureInfo.lastArg = lastArg; captureInfo.candidateIndex = -1; }
      if (captureInfo.tabbing || (candidates.length === 1 && candidates[0] === lastArg)) return [[], lastArg];
      return [candidates, lastArg];
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
      captureInfo.tabbing = true;
      const candidate = captureInfo.candidates[captureInfo.candidateIndex = ++captureInfo.candidateIndex % captureInfo.candidates.length];
      const value = captureInfo.line.replace(captureInfo.lastArg, candidate);
      readline.line = value;
      readline.cursor = value.length;
      readline.prompt(true);
    } else {
      captureInfo.tabbing = false;
    }
  });

  return readline;
};
