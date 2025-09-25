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
