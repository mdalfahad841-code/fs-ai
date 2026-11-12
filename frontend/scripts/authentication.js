/* FS AI — owner auth for the Command Center.
   Real login first: POST https://fs-ai.mdalfahad841.workers.dev/api/auth/login
   with { email, password }; the returned server token is stored in
   sessionStorage and validated with GET /api/auth/me on load. Sign-out
   calls POST /api/auth/logout with the Bearer token, then clears the
   session. No password, hash or token is hard-coded here.
   DEMO FALLBACK ONLY: if the API cannot be reached at all (fetch throws),
   the old session-only demo sign-in (demo@fs-ai.local, this tab only) is
   offered instead — and the UI always labels it DEMO, never a real login.
   A server 401/503 is a real rejection and does NOT fall back to demo. */
(function () {
  'use strict';
  var API_BASE = 'https://fs-ai.mdalfahad841.workers.dev';
  var SESSION_KEY = 'fsai-session';
  var LEGACY_DEMO_KEY = 'fsai-demo-session';
  var DEMO_USER = { email: 'demo@fs-ai.local', name: 'Demo Owner' };

  function getSession() {
    try {
      var raw = sessionStorage.getItem(SESSION_KEY) || sessionStorage.getItem(LEGACY_DEMO_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (!s || typeof s !== 'object' || !s.email) return null;
      if (!s.mode) s.mode = s.token ? 'server' : 'demo';
      return s;
    } catch (e) { return null; }
  }
  function setSession(session) {
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
      sessionStorage.removeItem(LEGACY_DEMO_KEY);
    } catch (e) {}
  }
  function clearSession() {
    try {
      sessionStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(LEGACY_DEMO_KEY);
    } catch (e) {}
  }
  function isSignedIn() { return !!getSession(); }

  /* --- Real server API (Worker + D1) --- */
  function apiLogin(email, password) {
    return fetch(API_BASE + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: password }),
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        return { ok: res.ok, status: res.status, body: body };
      });
    });
  }
  function apiMe(token) {
    return fetch(API_BASE + '/api/auth/me', {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + token },
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        return { ok: res.ok, status: res.status, body: body };
      });
    });
  }
  function apiLogout(token) {
    return fetch(API_BASE + '/api/auth/logout', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
    }).catch(function () { /* logout is best-effort; the local session is cleared anyway */ });
  }

  /* --- Demo fallback (session-only, this tab, nothing leaves the browser) --- */
  function demoSignInLocal(email, password) {
    if (!email || !password) return { ok: false, error: 'Enter an email and a password.' };
    if (String(email).trim().toLowerCase() !== DEMO_USER.email) {
      return { ok: false, error: 'Server unreachable — demo sign-in only works with the demo email shown on the sign-in form.' };
    }
    if (password.length < 8) return { ok: false, error: 'Password must be at least 8 characters.' };
    setSession({ email: DEMO_USER.email, name: DEMO_USER.name, token: null, expiresAt: null, mode: 'demo', at: new Date().toISOString() });
    return { ok: true, user: DEMO_USER, demo: true };
  }

  /* Sign in: real server login first; demo ONLY when the API is unreachable. */
  function signIn(email, password) {
    if (!email || !password) return Promise.resolve({ ok: false, error: 'Enter an email and a password.' });
    return apiLogin(email, password).then(function (r) {
      if (r.ok && r.body && r.body.token) {
        setSession({
          email: String(email).trim().toLowerCase(),
          name: 'Owner',
          token: r.body.token,
          expiresAt: r.body.expiresAt || null,
          mode: 'server',
          at: new Date().toISOString(),
        });
        return { ok: true, user: { email: String(email).trim().toLowerCase(), name: 'Owner' } };
      }
      // A real server answer (wrong password, not configured, bad input)
      // is a rejection — never silently fall back to demo on it.
      return { ok: false, error: (r.body && r.body.error) || 'Sign-in failed (HTTP ' + r.status + ').' };
    }).catch(function () {
      // fetch threw: the API is unreachable. Demo fallback, clearly labelled.
      return demoSignInLocal(email, password);
    });
  }

  /* Validate a stored server session against GET /api/auth/me. */
  function validateSession() {
    var s = getSession();
    if (!s || s.mode !== 'server' || !s.token) return Promise.resolve(s);
    return apiMe(s.token).then(function (r) {
      if (r.ok) return getSession();
      if (r.status === 401) { clearSession(); return null; }
      return getSession();
    }).catch(function () {
      // API unreachable right now: keep the stored session, but mark it
      // unverified so the UI never presents it as a checked server login.
      var kept = getSession();
      if (kept) { kept.unverified = true; setSession(kept); }
      return kept;
    });
  }

  function signOut() {
    var s = getSession();
    var done = function () { clearSession(); };
    if (s && s.mode === 'server' && s.token) {
      return apiLogout(s.token).then(done, done);
    }
    done();
    return Promise.resolve();
  }

  window.FSAI = window.FSAI || {};
  window.FSAI.auth = {
    isSignedIn: isSignedIn,
    getSession: getSession,
    signIn: signIn,
    signOut: signOut,
    demoSignIn: signIn,
    demoSignOut: signOut,
    demoEmail: DEMO_USER.email,
    validateSession: validateSession,
  };

  document.addEventListener('DOMContentLoaded', function () {
    var form = document.getElementById('demoLoginForm');
    var status = document.getElementById('authStatus');
    var signOutBtn = document.getElementById('demoSignOut');
    var submitBtn = form ? form.querySelector('button[type="submit"]') : null;
    // The form now signs in against the real server first; stop calling it a demo button.
    if (submitBtn) submitBtn.textContent = 'Sign in';
    function render() {
      var s = getSession();
      if (status) {
        if (!s) {
          status.textContent = 'Not signed in. Sign in with the owner account (real server login). If the server cannot be reached, a clearly-labelled demo sign-in is offered instead.';
        } else if (s.mode === 'server') {
          status.textContent = s.unverified
            ? 'Signed in as Owner (' + s.email + ') — server session stored, but the server could not be reached to verify it just now.'
            : 'Signed in as Owner (' + s.email + ') via the FS AI server.' + (s.expiresAt ? ' Session expires ' + s.expiresAt + '.' : '');
        } else {
          status.textContent = 'Signed in (DEMO — not a real server login) as ' + s.name + ' (' + s.email + '). Demo only, this tab only; nothing was sent to the server.';
        }
      }
      if (signOutBtn) signOutBtn.disabled = !s;
      if (form) form.style.display = s ? 'none' : '';
    }
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var email = document.getElementById('demoEmail').value;
        var password = document.getElementById('demoPassword').value;
        var err = document.getElementById('authError');
        if (err) err.textContent = 'Signing in…';
        signIn(email, password).then(function (r) {
          if (r.ok) {
            if (err) err.textContent = r.demo ? 'Server unreachable — signed in as DEMO (not a real login).' : '';
            render();
          } else if (err) {
            err.textContent = r.error;
          }
        });
      });
    }
    if (signOutBtn) signOutBtn.addEventListener('click', function () { signOut().then(render); });
    render();
    validateSession().then(render);
  });
})();
