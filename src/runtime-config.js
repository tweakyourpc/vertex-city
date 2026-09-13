import deployment from '../vertex-city.config.js';

/** Where a runtime Worker choice is remembered, per browser. */
const OVERRIDE_KEY = 'vertex-city:worker-url:1';

/** Normalize an optional HTTP(S) service base without accepting other schemes. */
export function serviceBase(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  let url;
  try { url = new URL(value.trim()); } catch { return ''; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
  if (url.username || url.password) return '';
  return url.href.replace(/\/$/, '');
}

/**
 * A Worker chosen at runtime rather than baked into source.
 *
 * `?worker=<url>` selects one and remembers it for this browser; `?worker=`
 * with an empty value forgets it. This is how local development and a fork
 * that has not edited `vertex-city.config.js` reach live aircraft and camera
 * data. Nothing is inherited by a clone: the value lives only in the browser
 * that set it, never in the repository.
 */
export function workerOverride(location = '', storage = null) {
  let requested = null;
  // This app keeps its view state in the hash and its entry parameters in the
  // query, so accept either rather than making the user know which.
  for (const part of [].concat(location)) {
    try {
      const found = new URLSearchParams(String(part).replace(/^[#?]/, '')).get('worker');
      if (found !== null) { requested = found; break; }
    } catch { /* an unparseable fragment simply carries no override */ }
  }
  if (requested !== null) {
    const chosen = serviceBase(requested);
    try {
      if (chosen) storage?.setItem(OVERRIDE_KEY, chosen);
      else storage?.removeItem(OVERRIDE_KEY);
    } catch { /* remembering the choice is optional */ }
    return chosen;
  }
  try { return serviceBase(storage?.getItem(OVERRIDE_KEY)); } catch { return ''; }
}

/**
 * Choose a Worker at runtime, from the application itself.
 *
 * The only ways to set this were editing a source file or hand-writing a query
 * parameter, neither of which is configuration a person can be expected to
 * find. The storage key and validation are the same ones `?worker=` uses, so a
 * URL set here and one set in the address bar are the same setting.
 *
 * @returns {string} the accepted base, or '' if it was cleared or rejected
 */
export function setWorkerOverride(value, storage = globalThis.localStorage) {
  const chosen = serviceBase(value);
  try {
    if (chosen) storage?.setItem(OVERRIDE_KEY, chosen);
    else storage?.removeItem(OVERRIDE_KEY);
  } catch { /* a browser that refuses storage still gets this session */ }
  return chosen;
}

/** What is configured right now, for showing in the interface. */
export function currentWorkerOverride(storage = globalThis.localStorage) {
  try { return serviceBase(storage?.getItem(OVERRIDE_KEY)); } catch { return ''; }
}

/** Optional Worker owned by the person deploying this fork. */
export const WORKER_URL = workerOverride(
  [globalThis.location?.search, globalThis.location?.hash], globalThis.localStorage,
) || serviceBase(deployment?.workerUrl);
