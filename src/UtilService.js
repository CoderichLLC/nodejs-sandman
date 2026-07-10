exports.parseArgs = (line) => {
  const regex = /"([^"]*)"|'([^']*)'|(\S+)/g;
  const args = [];
  let match;

  // eslint-disable-next-line no-cond-assign
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

const decode = (str) => { try { return decodeURIComponent(str); } catch { return str; } };

// Parse a CLI line into its command, target key, index-driven positional args,
// and a raw query string. Everything from the first `?` to the end of the line is
// the query string, so spaces inside a query value are preserved verbatim (the end
// user does not hand-encode). Everything before the `?` is whitespace-tokenized.
exports.parseLine = (line = '') => {
  const q = line.indexOf('?');
  const head = q === -1 ? line : line.slice(0, q);
  const query = q === -1 ? '' : line.slice(q + 1);
  const [cmd, keyToken, ...positional] = exports.parseArgs(head);
  return { cmd, keyToken, positional, query };
};

// Build the `$args` object: index-driven fields ($args.0, $args.1, ...) from the
// positional tokens, plus user-defined fields ($args.name, ...) from `&`-separated
// query pairs. Query pairs win on collision. Values are URL-decoded if encoded, but
// literal spaces are kept as-is.
exports.buildArgs = (positional = [], query = '') => {
  const args = {};
  positional.forEach((value, i) => { args[i] = value; });
  query.split('&').forEach((pair) => {
    if (!pair) return;
    const idx = pair.indexOf('=');
    const name = (idx === -1 ? pair : pair.slice(0, idx)).trim();
    const value = idx === -1 ? '' : pair.slice(idx + 1).trim();
    if (name) args[decode(name)] = decode(value);
  });
  return args;
};

// Recover the contiguous index-driven values (0, 1, 2, ...) from a `$args` object,
// used to replay prior positional args downstream on a bare `<cmd>` invocation.
exports.toPositional = (args = {}) => {
  const out = [];
  for (let i = 0; (args ?? {})[i] !== undefined; i++) out.push(args[i]);
  return out;
};
