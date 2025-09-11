exports.fetch = (request) => {
  return fetch(request).then(async (response) => {
    const ct = response.headers.get('content-type') || '';
    const data = await (ct.includes('application/json') ? response.json() : response.text());
    return { response, data };
  });
};

exports.normalizeRequest = (req) => {
  req.path ??= ''; req.method ??= 'get'; req.headers ??= {}; req.params ??= {};
  req.url = Object.entries(req.params).reduce((url, [key, value]) => { url.searchParams.append(key, value); return url; }, new URL(`${req.url}${req.path}`)).toString();
  req.headers = Object.entries(req.headers).reduce((prev, [key, value]) => Object.assign(prev, { [key.toLowerCase()]: value }), {});
  const [contentType] = req.headers['content-type']?.split(';') || [];

  if (req.data) {
    switch (contentType) {
      case 'application/json': {
        req.body = JSON.stringify(req.data);
        break;
      }
      case 'application/x-www-form-urlencoded': {
        req.body = new URLSearchParams(req.data).toString();
        break;
      }
      case 'multipart/form-data': {
        delete req.headers['content-type'];
        req.body = new FormData();
        Object.entries(req.data).forEach(([key, value]) => req.body.append(key, value));
        break;
      }
      default: {
        req.body = req.data;
        break;
      }
    }
  }

  delete req.data; delete req.params;
  const { url, ...params } = req;
  return new Request(url, params);
};

exports.shq = s => `'${String(s).replace(/'/g, "'\\''")}'`;

exports.toCURL = (request, { pretty = true, redactAuth = false } = {}) => {
  if (!request) return '<no request>';

  const { url, path, method, headers, params, data } = request;

  const base = new URL(url);
  const full = new URL(path || '', base);

  // append query params
  for (const [k, v] of Object.entries(params || {})) {
    if (v == null) continue;
    Array.isArray(v) ? v.forEach(x => full.searchParams.append(k, String(x))) : full.searchParams.append(k, String(v));
  }

  const parts = ['curl', '-sS'];
  if (method) parts.push('-X', method.toUpperCase());

  // headers
  const hdrs = { ...headers };
  for (const k of Object.keys(hdrs)) {
    if (redactAuth && /^authorization$/i.test(k)) {
      hdrs[k] = hdrs[k].replace(/(?<=^.{6}).+/, '***REDACTED***');
    }
    parts.push('-H', shq(`${k}: ${hdrs[k]}`));
  }

  // body (skip for GET)
  if (data != null && !/^GET$/i.test(method)) {
    if (typeof data === 'string') {
      parts.push('--data-raw', exports.shq(data));
    } else if (data instanceof URLSearchParams) {
      parts.push('-H', exports.shq('Content-Type: application/x-www-form-urlencoded'));
      parts.push('--data', exports.shq(data.toString()));
    } else if (typeof data === 'object') {
      const hasCT = Object.keys(hdrs).some(h => /^content-type$/i.test(h));
      if (!hasCT) parts.push('-H', exports.shq('Content-Type: application/json'));
      parts.push('--data-raw', exports.shq(JSON.stringify(data)));
    }
  }

  parts.push(exports.shq(full.toString()));
  return pretty ? parts.join(' \\\n  ') : parts.join(' ');
};
