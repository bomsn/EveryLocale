/** Project credentials may cross a network only over HTTPS. Local development stays usable. */
export function serviceUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Use a complete EveryLocale service URL, such as http://localhost:4310');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('The service URL cannot contain credentials, a query, or a fragment');
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    throw new Error('Use HTTPS for a remote EveryLocale service; HTTP is allowed only on loopback');
  return url.href.replace(/\/$/, '');
}
