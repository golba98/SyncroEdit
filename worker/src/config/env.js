export function getBackendOrigin(c) {
  const origin = c.env?.BACKEND_ORIGIN;
  return origin ? origin.replace(/\/+$/, '') : null;
}
