const Merge = require('lodash.merge');

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
