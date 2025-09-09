const Merge = require('lodash.merge');

function shq(s) { return `'${String(s).replace(/'/g, `'"'"'`)}'`; }

exports.fetch = (req) => {
  return new Promise((resolve, reject) => {
    const { url, ...params } = exports.normalizeRequest({ ...req });

    fetch(url, params).then(async (res) => {
      const ct = res.headers.get('content-type') || '';
      const data = await (ct.includes('application/json') ? res.json() : res.text());
      return { res, data };
    }).then(resolve).catch(reject);
  });
};

exports.normalizeRequest = (req) => {
  req.path ??= '';
  req.method ??= 'get'; req.headers ??= {}; req.params ??= {};
  req.url += req.path;
  req.url = Object.entries(req.params).reduce((url, [key, value]) => { url.searchParams.append(key, value); return url; }, new URL(req.url)).toString();
  req.headers = Object.entries(req.headers).reduce((prev, [key, value]) => Object.assign(prev, { [key.toLowerCase()]: value }), {});
  const [contentType] = req.headers['content-type']?.split(';') || [];
  const { data } = req; delete req.data;
  if (data == null) return req;

  switch (contentType) {
    case 'application/json': {
      req.body = JSON.stringify(data);
      break;
    }
    case 'application/x-www-form-urlencoded': {
      req.body = new URLSearchParams(data).toString();
      break;
    }
    case 'multipart/form-data': {
      delete req.headers['content-type'];
      // req.duplex = 'half';
      req.body = Object.entries(data).reduce((form, [key, value]) => {
        form.append(key, value);
        return form;
      }, new FormData());
      break;
    }
    default: {
      req.body = data;
      break;
    }
  }

  return req;
};

exports.decorateRequest = (mergeData, key, request) => {
  const toMerge = key.split('.').reduce((prev, k, i, arr) => {
    const $key = arr.slice(0, i).join('.');
    return Merge({}, prev, mergeData[$key]?.request);
  }, Merge({}, mergeData.request));

  return Merge({}, toMerge, request);
};

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
      parts.push('--data-raw', shq(data));
    } else if (data instanceof URLSearchParams) {
      parts.push('-H', shq('Content-Type: application/x-www-form-urlencoded'));
      parts.push('--data', shq(data.toString()));
    } else if (typeof data === 'object') {
      // JSON by default
      const hasCT = Object.keys(hdrs).some(h => /^content-type$/i.test(h));
      if (!hasCT) parts.push('-H', shq('Content-Type: application/json'));
      parts.push('--data-raw', shq(JSON.stringify(data)));
    }
  }

  parts.push(shq(full.toString()));
  return pretty ? parts.join(' \\\n  ') : parts.join(' ');
};
