/**
 * Console bridge behaviour: URL mapping, live-vs-device routing, token
 * capture, cookie-refresh translation, logout and upload policy.
 *
 * The native-backed modules (`connectivity`, `dispatch`, `server`) are mocked
 * so the spec runs in plain node; everything here exercises the injected
 * `BridgeDeps` — the same seams the production wiring uses.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/offline/connectivity', () => ({
  isLocal: () => false,
  markOffline: vi.fn(),
}));
vi.mock('@/offline/dispatch', () => ({
  dispatchLocal: vi.fn(),
  rememberRemoteIdentity: vi.fn(),
}));
vi.mock('@/lib/server', () => ({
  getApiBase: () => 'http://pc:4100',
}));

import {
  consoleFileForPath,
  consolePath,
  createConsoleHandler,
  isBridgeablePath,
  respondScript,
  type BridgeDeps,
  type ConsoleApiRequest,
} from './console-bridge';

interface FakeWorld {
  local: boolean;
  offlineMarks: number;
  saved: Array<{ accessToken: string; refreshToken: string }>;
  cleared: number;
  remembered: unknown[];
  dispatched: unknown[];
  fetched: Array<{ url: string; init: RequestInit }>;
}

function makeDeps(overrides: Partial<BridgeDeps> = {}): { deps: BridgeDeps; world: FakeWorld } {
  const world: FakeWorld = {
    local: false,
    offlineMarks: 0,
    saved: [],
    cleared: 0,
    remembered: [],
    dispatched: [],
    fetched: [],
  };
  const deps: BridgeDeps = {
    isLocal: () => world.local,
    markOffline: () => {
      world.offlineMarks += 1;
    },
    apiBase: () => 'http://pc:4100',
    fetchRemote: async (url, init) => {
      world.fetched.push({ url, init });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
    dispatch: (call) => {
      world.dispatched.push(call);
      return { status: 200, body: { engine: true } };
    },
    getAccessToken: async () => 'at-123',
    getRefreshToken: async () => 'rt-456',
    saveSession: async (s) => {
      world.saved.push(s);
    },
    clearSession: async () => {
      world.cleared += 1;
    },
    rememberIdentity: (user, session) => {
      world.remembered.push({ user, session });
    },
    ...overrides,
  };
  return { deps, world };
}

function req(partial: Partial<ConsoleApiRequest> = {}): ConsoleApiRequest {
  return {
    id: 1,
    method: 'GET',
    url: '/api/v1/meta',
    headers: {},
    body: null,
    form: null,
    ...partial,
  };
}

describe('consolePath', () => {
  it('keeps a bare path', () => {
    expect(consolePath('/api/v1/meta')).toBe('/api/v1/meta');
  });
  it('strips an accidental origin', () => {
    expect(consolePath('http://pc:4100/api/v1/meta')).toBe('/api/v1/meta');
  });
});

describe('isBridgeablePath', () => {
  it('accepts api and health probes', () => {
    expect(isBridgeablePath('/api/v1/meta')).toBe(true);
    expect(isBridgeablePath('/healthz')).toBe(true);
    expect(isBridgeablePath('/readyz')).toBe(true);
  });
  it('rejects everything else', () => {
    expect(isBridgeablePath('/photos/hero.jpg')).toBe(false);
    expect(isBridgeablePath('/')).toBe(false);
  });
});

describe('consoleFileForPath', () => {
  it('maps the root to index.html', () => {
    expect(consoleFileForPath('file:///')).toBe('file:///android_asset/console/index.html');
    expect(consoleFileForPath('file:///android_asset/console')).toBe(
      'file:///android_asset/console/index.html',
    );
  });
  it('maps known pages with and without .html', () => {
    expect(consoleFileForPath('file:///login')).toBe('file:///android_asset/console/login.html');
    expect(consoleFileForPath('file:///android_asset/console/admin.html')).toBe(
      'file:///android_asset/console/admin.html',
    );
  });
  it('preserves the query string', () => {
    expect(consoleFileForPath('file:///login?next=%2Fadmin')).toBe(
      'file:///android_asset/console/login.html?next=%2Fadmin',
    );
  });
  it('drops the hash', () => {
    expect(consoleFileForPath('file:///ops#top')).toBe('file:///android_asset/console/ops.html');
  });
  it('sends unknown routes to the 404 page', () => {
    expect(consoleFileForPath('file:///nope')).toBe('file:///android_asset/console/404.html');
  });
  it('ignores non-file URLs', () => {
    expect(consoleFileForPath('http://example.com/x')).toBeNull();
    expect(consoleFileForPath('about:blank')).toBeNull();
  });
});

describe('createConsoleHandler — routing', () => {
  beforeEach(() => vi.clearAllMocks());

  it('routes to the engine when local, with bearer and parsed query', async () => {
    const { deps, world } = makeDeps({ isLocal: () => true });
    const handle = createConsoleHandler(deps);
    const res = await handle(req({ url: '/api/v1/admin/flights?page=2' }));
    expect(res.status).toBe(200);
    expect(world.dispatched).toHaveLength(1);
    const call = world.dispatched[0] as {
      method: string;
      path: string;
      query: Record<string, string>;
      authorization: string;
    };
    expect(call.method).toBe('GET');
    expect(call.path).toBe('/api/v1/admin/flights');
    expect(call.query).toEqual({ page: '2' });
    expect(call.authorization).toBe('Bearer at-123');
    expect(world.fetched).toHaveLength(0);
  });

  it('routes to the PC API when online, attaching X-Client and bearer', async () => {
    const { deps, world } = makeDeps();
    const handle = createConsoleHandler(deps);
    await handle(req({ method: 'POST', url: '/api/v1/meta', body: '{"x":1}' }));
    expect(world.fetched).toHaveLength(1);
    const { url, init } = world.fetched[0];
    expect(url).toBe('http://pc:4100/api/v1/meta');
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Client']).toBe('mobile');
    expect(headers.Authorization).toBe('Bearer at-123');
    expect(headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe('{"x":1}');
  });

  it('fails over to the engine on a network error and marks offline', async () => {
    const { deps, world } = makeDeps({
      fetchRemote: async () => {
        throw new TypeError('Network request failed');
      },
    });
    const handle = createConsoleHandler(deps);
    const res = await handle(req({ url: '/api/v1/meta' }));
    expect(world.offlineMarks).toBe(1);
    expect(world.dispatched).toHaveLength(1);
    expect(res.status).toBe(200);
  });

  it('passes 4xx engine answers through unchanged', async () => {
    const { deps } = makeDeps({
      isLocal: () => true,
      dispatch: () => ({
        status: 404,
        body: { error: { code: 'NOT_FOUND', message: 'No local route' } },
      }),
    });
    const handle = createConsoleHandler(deps);
    const res = await handle(req({ url: '/api/v1/admin/users' }));
    expect(res.status).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe('NOT_FOUND');
  });
});

describe('createConsoleHandler — auth', () => {
  it('captures the session from a remote login and remembers the identity', async () => {
    const { deps, world } = makeDeps({
      fetchRemote: async () =>
        new Response(
          JSON.stringify({
            user: { id: 'usr_1', email: 'a@b.c' },
            session: { accessToken: 'new-at', refreshToken: 'new-rt' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    });
    const handle = createConsoleHandler(deps);
    await handle(
      req({
        method: 'POST',
        url: '/api/v1/auth/login',
        body: JSON.stringify({ identifier: 'admin@kenyaairways.example', password: 'x' }),
      }),
    );
    expect(world.saved).toEqual([{ accessToken: 'new-at', refreshToken: 'new-rt' }]);
    expect(world.remembered).toHaveLength(1);
  });

  it('captures a local engine login WITHOUT remembering remote identity', async () => {
    const { deps, world } = makeDeps({
      isLocal: () => true,
      dispatch: () => ({
        status: 200,
        body: {
          user: { id: 'usr_1' },
          session: { accessToken: 'loc.at', refreshToken: 'loc.rt' },
        },
      }),
    });
    const handle = createConsoleHandler(deps);
    await handle(
      req({ method: 'POST', url: '/api/v1/auth/login', body: '{"identifier":"x","password":"y"}' }),
    );
    expect(world.saved).toEqual([{ accessToken: 'loc.at', refreshToken: 'loc.rt' }]);
    expect(world.remembered).toHaveLength(0);
  });

  it("translates the console's empty-body silent refresh into a token body", async () => {
    const { deps, world } = makeDeps();
    const handle = createConsoleHandler(deps);
    await handle(req({ method: 'POST', url: '/api/v1/auth/refresh', body: null }));
    const { init } = world.fetched[0];
    expect(init.body).toBe(JSON.stringify({ refreshToken: 'rt-456' }));
  });

  it('leaves an explicit refresh body alone', async () => {
    const { deps, world } = makeDeps();
    const handle = createConsoleHandler(deps);
    await handle(
      req({ method: 'POST', url: '/api/v1/auth/refresh', body: '{"refreshToken":"mine"}' }),
    );
    expect(world.fetched[0].init.body).toBe('{"refreshToken":"mine"}');
  });

  it('remembers the profile from /auth/me', async () => {
    const { deps, world } = makeDeps({
      fetchRemote: async () =>
        new Response(JSON.stringify({ user: { id: 'usr_9' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    });
    const handle = createConsoleHandler(deps);
    await handle(req({ url: '/api/v1/auth/me' }));
    expect(world.remembered).toEqual([{ user: { id: 'usr_9' }, session: null }]);
  });

  it('answers logout with 204, clears the pair, and never dead-ends offline', async () => {
    const { deps, world } = makeDeps({ isLocal: () => true });
    const handle = createConsoleHandler(deps);
    const res = await handle(req({ method: 'POST', url: '/api/v1/auth/logout' }));
    expect(res.status).toBe(204);
    expect(world.cleared).toBe(1);
    expect(world.fetched).toHaveLength(0); // offline: no server call attempted
  });

  it('best-effort calls the server on logout when online', async () => {
    const { deps, world } = makeDeps();
    const handle = createConsoleHandler(deps);
    await handle(req({ method: 'POST', url: '/api/v1/auth/logout' }));
    expect(world.fetched[0].url).toBe('http://pc:4100/api/v1/auth/logout');
    expect(world.cleared).toBe(1);
  });
});

describe('createConsoleHandler — uploads', () => {
  const form = [{ name: 'file', value: 'data:image/jpeg;base64,AAAA' }];

  it('refuses uploads offline with an API-shaped envelope', async () => {
    const { deps } = makeDeps({ isLocal: () => true });
    const handle = createConsoleHandler(deps);
    const res = await handle(req({ method: 'POST', url: '/api/v1/admin/media', form }));
    expect(res.status).toBe(503);
    const parsed = JSON.parse(res.body);
    expect(parsed.error.code).toBe('SERVICE_UNAVAILABLE');
  });

  it('fails over to the same refusal when the PC drops mid-upload', async () => {
    const { deps, world } = makeDeps({
      fetchRemote: async () => {
        throw new TypeError('boom');
      },
    });
    const handle = createConsoleHandler(deps);
    const res = await handle(req({ method: 'POST', url: '/api/v1/admin/media', form }));
    expect(res.status).toBe(503);
    expect(world.offlineMarks).toBe(1);
  });
});

describe('respondScript', () => {
  it('builds a safe injection call', () => {
    const script = respondScript({
      id: 7,
      status: 401,
      contentType: 'application/json',
      body: '{"error":{"code":"UNAUTHENTICATED"}}',
    });
    expect(script).toContain('window.__f13bridge');
    expect(script).toContain('7, 401');
    expect(script).toContain('UNAUTHENTICATED');
  });
});
