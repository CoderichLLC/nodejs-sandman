exports.parseArgs = (line) => {
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
};
