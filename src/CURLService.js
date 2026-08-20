exports.shq = s => `'${String(s).replace(/'/g, "'\\''")}'`;

exports.toCURL = function toCURL(request, { pretty = true, redactAuth = false } = {}) {
  if (!request) return '<no request>';

  const {
    url,
    path = '',
    method: rawMethod = 'GET',
    headers = undefined,
    params = undefined,
    data = undefined,
  } = request;

  // Build URL (require a base url; mirror original behavior)
  const base = new URL(url);
  const full = new URL(path || '', base);

  // Append query params (supports object, Map, URLSearchParams, string)
  if (params) {
    const append = (k, v) => {
      if (v == null || v === 'undefined') return;
      if (Array.isArray(v) || v instanceof Set) {
        for (const x of v) { if (x != null && x !== 'undefined') full.searchParams.append(k, String(x)); }
      } else {
        full.searchParams.append(k, String(v));
      }
    };

    if (typeof params === 'string') {
      for (const [k, v] of new URLSearchParams(params)) append(k, v);
    } else if (params instanceof URLSearchParams) {
      for (const [k, v] of params.entries()) append(k, v);
    } else if (params instanceof Map) {
      for (const [k, v] of params.entries()) append(k, v);
    } else if (typeof params === 'object') {
      for (const [k, v] of Object.entries(params)) append(k, v);
    }
  }

  const method = String(rawMethod || 'GET').toUpperCase();
  const parts = ['curl', '-sS'];

  // Only add -X when not GET for cleaner output
  if (method !== 'GET') parts.push('-X', method);

  // Normalize headers input into flat [name, value] pairs
  const collectHeaders = (hdrs) => {
    const out = [];
    if (!hdrs) return out;

    const push = (k, v) => {
      if (v == null) return;
      if (Array.isArray(v)) {
        for (const vv of v) if (vv != null) out.push([k, String(vv)]);
      } else {
        out.push([k, String(v)]);
      }
    };

    if (typeof Headers !== 'undefined' && hdrs instanceof Headers) {
      hdrs.forEach((v, k) => push(k, v));
      return out;
    }

    if (hdrs instanceof Map) {
      for (const [k, v] of hdrs.entries()) push(k, v);
      return out;
    }

    if (Array.isArray(hdrs)) {
      for (const item of hdrs) {
        if (!item) continue; // eslint-disable-line no-continue
        if (Array.isArray(item) && item.length >= 2) push(item[0], item[1]);
        else if (typeof item === 'object') {
          for (const [k, v] of Object.entries(item)) push(k, v);
        }
      }
      return out;
    }

    if (typeof hdrs === 'object') {
      for (const [k, v] of Object.entries(hdrs)) push(k, v);
    }

    return out;
  };

  const hdrPairs = collectHeaders(headers);
  const seenHeaderNames = new Set(hdrPairs.map(([k]) => k.toLowerCase()));

  const redactAuthValue = (val) => {
    if (!redactAuth) return val;
    const s = String(val);
    // Preserve scheme if present (e.g., "Bearer") but redact the token
    const m = s.match(/^(\S+)\s+(.+)$/);
    return m ? `${m[1]} ***REDACTED***` : '***REDACTED***';
  };

  for (const [k, v] of hdrPairs) {
    const isAuth = /^authorization$/i.test(k);
    const value = isAuth ? redactAuthValue(v) : v;
    parts.push('-H', exports.shq(`${k}: ${value}`));
  }

  // Body (skip for GET/HEAD)
  const canHaveBody = method !== 'GET' && method !== 'HEAD';

  const ensureHeader = (name, value) => {
    const n = name.toLowerCase();
    if (seenHeaderNames.has(n)) return;
    seenHeaderNames.add(n);
    parts.push('-H', exports.shq(`${name}: ${value}`));
  };

  if (canHaveBody && data != null) {
    // FormData (Node 18+/WHATWG)
    const hasGlobalFD = typeof FormData !== 'undefined';
    const hasGlobalFile = typeof File !== 'undefined';
    const isFormData = hasGlobalFD && (data instanceof FormData || (data && data[Symbol.toStringTag] === 'FormData'));

    if (isFormData) {
      // Use -F for each entry; if File, use @filename (best-effort)
      // Note: this assumes filename points to a local file if provided.
      for (const [name, val] of data.entries()) {
        if (hasGlobalFile && val instanceof File) {
          const fileName = val.name || 'file';
          parts.push('--form', exports.shq(`${name}=@${fileName}`));
        } else {
          parts.push('--form', exports.shq(`${name}=${String(val)}`));
        }
      }
    } else if (data instanceof URLSearchParams) {
      ensureHeader('Content-Type', 'application/x-www-form-urlencoded');
      parts.push('--data', exports.shq(data.toString()));
    } else if (typeof data === 'string') {
      parts.push('--data-raw', exports.shq(data));
    } else if (typeof Blob !== 'undefined' && data instanceof Blob) {
      // Best-effort for binary blobs
      ensureHeader('Content-Type', data.type || 'application/octet-stream');
      parts.push('--data-binary', exports.shq('[binary blob]'));
    } else if (typeof ArrayBuffer !== 'undefined' && (data instanceof ArrayBuffer || ArrayBuffer.isView?.(data))) {
      ensureHeader('Content-Type', 'application/octet-stream');
      const len = data.byteLength ?? (data.buffer && data.buffer.byteLength) ?? 0;
      parts.push('--data-binary', exports.shq(`[binary ${len} bytes]`));
    } else if (typeof data === 'object') {
      ensureHeader('Content-Type', 'application/json');
      parts.push('--data-raw', exports.shq(JSON.stringify(data)));
    }
  }

  parts.push(exports.shq(full.toString()));

  return pretty ? parts.join(' \\\n  ') : parts.join(' ');
};
