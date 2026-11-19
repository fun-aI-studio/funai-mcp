// Which credential goes on each request: FUNAI_API_KEY when it is set, otherwise the saved
// OAuth sign-in, refreshed on expiry or on a 401, and a fresh browser sign-in when the
// authorization server refuses the refresh.

import {
  AuthError,
  buildAuthorizeUrl,
  createPkce,
  discoverAuthServer,
  discoverProtectedResource,
  openBrowser,
  randomState,
  registerClient,
  revokeToken,
  startCallbackServer,
  tokenRequest,
} from './oauth.js';
import { parseWwwAuthenticate } from './http.js';
import { VERSION } from './version.js';

const EXPIRY_SKEW_MS = 60_000;

function expiring(tokens) {
  return Boolean(tokens.expires_at) && Date.now() > tokens.expires_at - EXPIRY_SKEW_MS;
}

function signInError(message) {
  const err = new AuthError(message);
  err.signInNeeded = true;
  return err;
}

/**
 * True when only a new browser sign-in can help: the authorization server refused the
 * refresh token or client (4xx), or there is nothing to refresh. False for network errors,
 * timeouts, 429 and 5xx, which are worth retrying later with the same sign-in.
 */
function signInNeeded(err) {
  if (err && err.signInNeeded) return true;
  const status = err && err.status;
  if (!status || status < 400 || status >= 500 || status === 429) return false;
  return !['temporarily_unavailable', 'server_error', 'slow_down'].includes(err.oauthError);
}

function transientError(err) {
  const reason = err && err.message ? err.message : 'unknown error';
  return new AuthError(`Could not refresh the FunAI sign-in (${reason}). The sign-in is kept; try again shortly.`);
}

function mergeScopes(...lists) {
  const all = lists.flatMap((s) => (typeof s === 'string' ? s.split(/\s+/) : [])).filter(Boolean);
  return [...new Set(all)].join(' ') || undefined;
}

export class AuthManager {
  constructor({
    serverUrl,
    apiKey,
    store,
    fetchImpl = fetch,
    openUrl = openBrowser,
    log = () => {},
    callbackTimeoutMs = 5 * 60_000,
  }) {
    this.serverUrl = serverUrl;
    this.apiKey = apiKey || null;
    this.store = store;
    this.fetch = fetchImpl;
    this.openUrl = openUrl;
    this.log = log;
    this.callbackTimeoutMs = callbackTimeoutMs;
    this.state = undefined;
    this.flow = null;
    this.refusedRefreshToken = null;
  }

  /** The Authorization header value for the next request, or null to send none. */
  async authorization() {
    if (this.apiKey) return `Bearer ${this.apiKey}`;
    if (this.flow) await this.flow.catch(() => {});
    const state = await this._load();
    const tokens = state && state.tokens;
    if (!tokens || !tokens.access_token) return null;
    if (expiring(tokens) && tokens.refresh_token) {
      try {
        await this._single(() => this._refresh(`Bearer ${tokens.access_token}`));
      } catch (err) {
        if (!signInNeeded(err)) throw transientError(err);
        // Send nothing; the 401 that follows runs the browser sign-in.
        this.state = { ...this.state, tokens: undefined };
        return null;
      }
    }
    return this.state && this.state.tokens ? `Bearer ${this.state.tokens.access_token}` : null;
  }

  /** The server answered 401 to a request sent with `usedAuth`. */
  async onUnauthorized(wwwAuthenticate, usedAuth) {
    if (this.apiKey) {
      throw new AuthError(
        'FunAI did not accept FUNAI_API_KEY (wrong, revoked or expired). Check it at https://developers.funai.art/keys.',
      );
    }
    const challenge = parseWwwAuthenticate(wwwAuthenticate);
    return this._single(async () => {
      try {
        await this._refresh(usedAuth);
        return;
      } catch (err) {
        // Only a refused refresh token (or none) needs the browser. A network error or an
        // outage at the authorization server fails this request and keeps the sign-in.
        if (!signInNeeded(err)) throw transientError(err);
        if (this.state && this.state.tokens) this.log('The saved FunAI sign-in could not be refreshed; signing in again.');
      }
      await this._login(challenge);
    });
  }

  /** The server answered 403 insufficient_scope: sign in again asking for `scope` as well. */
  async onInsufficientScope(scope) {
    if (this.apiKey) throw new AuthError('FUNAI_API_KEY is not allowed to use this tool.');
    return this._single(async () => {
      const state = await this._load();
      const challenge = { params: { scope: mergeScopes(state && state.tokens && state.tokens.scope, scope) } };
      await this._login(challenge);
    });
  }

  /** Sign in now (the `login` command). */
  async login() {
    if (this.apiKey) return false;
    await this._single(() => this._login(null));
    return true;
  }

  /** Revoke (best effort) and delete the saved sign-in for this server. */
  async logout() {
    const state = await this._load(true);
    if (state && state.tokens && state.client && state.authServer && state.authServer.revocation_endpoint) {
      const token = state.tokens.refresh_token || state.tokens.access_token;
      const hint = state.tokens.refresh_token ? 'refresh_token' : 'access_token';
      try {
        await revokeToken(state.authServer.revocation_endpoint, state.client, token, hint, this.fetch);
      } catch {
        // Deleting the local copy is what matters.
      }
    }
    this.state = null;
    return this.store.clear();
  }

  _single(fn) {
    if (!this.flow) {
      this.flow = (async () => {
        try {
          await fn();
        } finally {
          this.flow = null;
        }
      })();
      return this.flow;
    }
    return this.flow;
  }

  async _load(reload = false) {
    if (this.state === undefined || reload) this.state = await this.store.load();
    return this.state;
  }

  /**
   * Replace the access token `staleAuth` (an Authorization value, or null when none was
   * sent). Runs under the token file's lock and reads the file first: another funai-mcp
   * process may already have refreshed, and sending a refresh token it rotated would count
   * as reuse, which revokes the whole sign-in.
   */
  async _refresh(staleAuth) {
    await this.store.withLock(async () => {
      const state = await this._load(true);
      const tokens = state && state.tokens;
      if (!tokens || !tokens.access_token) throw signInError('No saved sign-in');
      if (`Bearer ${tokens.access_token}` !== staleAuth && !expiring(tokens)) return; // refreshed elsewhere
      if (!tokens.refresh_token || !state.authServer || !state.client) throw signInError('No saved sign-in to refresh');
      const used = tokens.refresh_token;
      if (used === this.refusedRefreshToken) throw signInError('The saved sign-in was refused');
      let fresh;
      try {
        fresh = await tokenRequest(
          state.authServer.token_endpoint,
          state.client,
          { grant_type: 'refresh_token', refresh_token: used, resource: state.resource },
          this.fetch,
        );
      } catch (err) {
        if (signInNeeded(err)) this.refusedRefreshToken = used;
        throw err;
      }
      if (!fresh.refresh_token) fresh.refresh_token = used;
      if (!fresh.scope) fresh.scope = tokens.scope;
      this.state = { ...state, tokens: fresh };
      await this.store.save(this.state);
      this.log('Refreshed the FunAI sign-in.');
    });
  }

  async _login(challenge) {
    const params = (challenge && challenge.params) || {};
    const prm = await discoverProtectedResource(this.serverUrl, params.resource_metadata, this.fetch);
    const issuer = prm.authorization_servers[0];
    const meta = await discoverAuthServer(issuer, this.fetch);
    const scope = params.scope || mergeScopes((prm.scopes_supported || []).join(' '));
    const saved = await this._load(true);

    const preferredPort = saved && saved.client && saved.client.issuer === meta.issuer ? saved.client.port : undefined;
    const callback = await startCallbackServer({ preferredPort, timeoutMs: this.callbackTimeoutMs });
    try {
      let client = saved && saved.client;
      if (!client || client.issuer !== meta.issuer || client.port !== callback.port) {
        const registered = await registerClient(
          meta,
          { redirectUri: callback.redirectUri, scope, clientName: 'FunAI MCP bridge (funai-mcp)', version: VERSION },
          this.fetch,
        );
        client = { ...registered, issuer: meta.issuer, port: callback.port };
      }
      const pkce = createPkce();
      const state = randomState();
      const authorizeUrl = buildAuthorizeUrl(meta, {
        clientId: client.client_id,
        redirectUri: callback.redirectUri,
        challenge: pkce.challenge,
        state,
        scope,
        resource: prm.resource,
      });
      const code = callback.wait({
        state,
        issuer: meta.issuer,
        issRequired: meta.authorization_response_iss_parameter_supported === true,
      });
      const opened = await this.openUrl(authorizeUrl);
      this.log(
        opened
          ? `Opened your browser to sign in to FunAI. If nothing appeared, open this link: ${authorizeUrl}`
          : `Open this link in your browser to sign in to FunAI: ${authorizeUrl}`,
      );
      const authCode = await code;
      const tokens = await tokenRequest(
        meta.token_endpoint,
        client,
        {
          grant_type: 'authorization_code',
          code: authCode,
          redirect_uri: callback.redirectUri,
          code_verifier: pkce.verifier,
          resource: prm.resource,
        },
        this.fetch,
      );
      if (!tokens.scope) tokens.scope = scope;
      this.state = {
        resource: prm.resource,
        authServer: {
          issuer: meta.issuer,
          token_endpoint: meta.token_endpoint,
          revocation_endpoint: meta.revocation_endpoint,
        },
        client,
        tokens,
      };
      await this.store.save(this.state);
      this.refusedRefreshToken = null;
      this.log('Signed in to FunAI.');
      await this._revokeReplaced(saved, tokens);
    } finally {
      callback.close();
    }
  }

  /** A new sign-in replaced `saved`: revoke its refresh token so no orphaned grant stays live. */
  async _revokeReplaced(saved, tokens) {
    const old = saved && saved.tokens && saved.tokens.refresh_token;
    if (!old || old === tokens.refresh_token || !saved.client || !saved.authServer || !saved.authServer.revocation_endpoint) {
      return;
    }
    try {
      await revokeToken(saved.authServer.revocation_endpoint, saved.client, old, 'refresh_token', this.fetch);
    } catch {
      // Best effort: the old grant still expires on its own.
    }
  }
}
