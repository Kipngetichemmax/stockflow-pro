export const token = {
  get: () => localStorage.getItem('sf_token'),
  set: t => (t ? localStorage.setItem('sf_token', t) : localStorage.removeItem('sf_token'))
};
export async function api(path, { body, method } = {}) {
  const r = await fetch('/api' + path, {
    method: method || (body ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', ...(token.get() && { Authorization: 'Bearer ' + token.get() }) },
    body: body && JSON.stringify(body)
  });
  if (r.status === 401 && path !== '/login') { token.set(null); location.reload(); }
  const json = r.headers.get('content-type')?.includes('json');
  const data = json ? await r.json() : await r.blob();
  if (!r.ok) throw new Error(data.error || 'Request failed');
  return data;
}
export const kes = n => 'KSh ' + Number(n || 0).toLocaleString('en-KE');
