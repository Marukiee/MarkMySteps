import { assertImmichUrlAllowed, isPublicAddress } from './immich-url-policy';

describe('isPublicAddress', () => {
  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '93.184.216.34',
    '2606:4700:4700::1111',
    '::ffff:8.8.8.8',
  ])('lets %s through', (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it.each([
    '127.0.0.1',
    '127.1.2.3',
    '0.0.0.0',
    '10.0.0.5',
    '172.16.0.1',
    '172.20.0.1', // a Docker network
    '172.31.255.255',
    '192.168.1.157', // the server itself
    '169.254.169.254', // cloud metadata
    '100.86.14.39', // Tailscale
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    'fe80::1',
    'fd12:3456::1',
    '::ffff:10.0.0.1',
    '::ffff:7f00:1', // 127.0.0.1, written in hex
    '64:ff9b::a00:1', // NAT64 of 10.0.0.1
    'not-an-ip',
  ])('refuses %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it('does not mistake the neighbours of a private range for private', () => {
    expect(isPublicAddress('172.15.255.255')).toBe(true);
    expect(isPublicAddress('172.32.0.1')).toBe(true);
    expect(isPublicAddress('100.63.255.255')).toBe(true);
    expect(isPublicAddress('100.128.0.1')).toBe(true);
  });
});

describe('assertImmichUrlAllowed', () => {
  const original = process.env.IMMICH_ALLOWED_HOSTS;
  afterEach(() => {
    if (original === undefined) delete process.env.IMMICH_ALLOWED_HOSTS;
    else process.env.IMMICH_ALLOWED_HOSTS = original;
  });

  it('accepts a public address', async () => {
    await expect(assertImmichUrlAllowed('https://8.8.8.8/')).resolves.toBeInstanceOf(URL);
  });

  it.each([
    'http://127.0.0.1:2283',
    'http://192.168.1.157:2283',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]:2283',
    'http://[::ffff:10.0.0.1]/',
    'http://0x7f000001/', // the URL parser turns this into 127.0.0.1
    'http://2130706433/', // and this
    'http://localhost:3000',
    'http://localhost.:3000', // trailing dot
  ])('refuses %s', async (url) => {
    await expect(assertImmichUrlAllowed(url)).rejects.toThrow(/not allowed/);
  });

  it('refuses other schemes and URLs that carry a login', async () => {
    await expect(assertImmichUrlAllowed('ftp://8.8.8.8/')).rejects.toThrow(/not allowed/);
    await expect(assertImmichUrlAllowed('file:///etc/passwd')).rejects.toThrow(/not allowed/);
    await expect(assertImmichUrlAllowed('http://user:pw@8.8.8.8/')).rejects.toThrow(
      /not allowed/,
    );
  });

  it('lets the operator allow a private host by name', async () => {
    process.env.IMMICH_ALLOWED_HOSTS = ' 192.168.1.157 , Immich.lan ,[::1]';
    await expect(assertImmichUrlAllowed('http://192.168.1.157:2283')).resolves.toBeInstanceOf(URL);
    await expect(assertImmichUrlAllowed('http://[::1]:2283')).resolves.toBeInstanceOf(URL);
    // …but only that one: its neighbour is still refused.
    await expect(assertImmichUrlAllowed('http://192.168.1.158:2283')).rejects.toThrow(
      /not allowed/,
    );
    await expect(assertImmichUrlAllowed('http://127.0.0.1')).rejects.toThrow(/not allowed/);
  });
});
