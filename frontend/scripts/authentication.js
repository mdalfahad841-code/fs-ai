/* FS AI — session-only demo auth for the static build.
   There is NO real server login here. Credentials never leave this browser,
   nothing is sent anywhere, and the demo account exists only in this tab's
   sessionStorage. The owner login for the real platform is a separate,
   server-backed system — this static demo must never be presented as it. */
(function () {
  'use strict';
  var SESSION_KEY = 'fsai-demo-session';
  var DEMO_USER = { email: 'demo@fs-ai.local', name: 'Demo Owner' };

  /* PBKDF2-style note: a real implementation must hash with PBKDF2 (or
     bcrypt/argon2) with a per-user salt, server-side, over HTTPS. This demo
     uses SHA-256 via SubtleCrypto only to avoid storing a plain password
     in sessionStorage — it is NOT a substitute for server-side auth. */
  function hashPassword(password, salt) {
    if (window.crypto && crypto.subtle) {
      var data = new TextEncoder().encode(salt + ':' + password);
      return crypto.subtle.digest('SHA-256', data).then(function (buf) {
        return Array.prototype.map.call(new Uint8Array(buf), function (b) {
          return ('0' + b.toString(16)).slice(-2);
        }).join('');
      });
    }
    return Promise.resolve('unhashed-demo:' + password.length);
  }
  function getSession() {
    try {
      var raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function setSession(user) {
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ email: user.email, name: user.name, at: new Date().toISOString() })); } catch (e) {}
  }
  function clearSession() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
  }
  function isSignedIn() { return !!getSession(); }

  /* Demo sign-in: only the demo account works, only in this browser session. */
  function demoSignIn(email, password) {
    return new Promise(function (resolve) {
      if (!email || !password) { resolve({ ok: false, error: 'Enter an email and a password.' }); return; }
      if (String(email).trim().toLowerCase() !== DEMO_USER.email) {
        resolve({ ok: false, error: 'Demo account not found. Use the demo email shown on the sign-in form.' });
        return;
      }
      if (password.length < 8) { resolve({ ok: false, error: 'Password must be at least 8 characters.' }); return; }
      hashPassword(password, 'fsai-demo-salt').then(function () {
        setSession(DEMO_USER);
        resolve({ ok: true, user: DEMO_USER });
      });
    });
  }
  function demoSignOut() { clearSession(); }

  window.FSAI = window.FSAI || {};
  window.FSAI.auth = { isSignedIn: isSignedIn, getSession: getSession, demoSignIn: demoSignIn, demoSignOut: demoSignOut, demoEmail: DEMO_USER.email };

  document.addEventListener('DOMContentLoaded', function () {
    var form = document.getElementById('demoLoginForm');
    var status = document.getElementById('authStatus');
    var signOutBtn = document.getElementById('demoSignOut');
    function render() {
      var s = getSession();
      if (status) {
        status.textContent = s
          ? 'Signed in (demo, this tab only) as ' + s.name + ' (' + s.email + '). This is not a real server login.'
          : 'Not signed in. Demo sign-in is session-only and never leaves this browser.';
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
        demoSignIn(email, password).then(function (r) {
          if (r.ok) { if (err) err.textContent = ''; render(); }
          else if (err) { err.textContent = r.error; }
        });
      });
    }
    if (signOutBtn) signOutBtn.addEventListener('click', function () { demoSignOut(); render(); });
    render();
  });
})();
