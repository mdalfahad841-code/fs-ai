/* FS AI — newsletter subscribe / unsubscribe via the real Worker API.
   POST /api/newsletter/subscribe { email, name?, consent: true } stores the
   address as "pending" — no confirmation email can be sent yet, because no
   free email sender is connected. That is stated honestly in the UI; this
   is NOT double opt-in and is never claimed to be.
   POST /api/newsletter/unsubscribe { email } always answers 200.

   Close-out A1.3 (2026-11-23): the forms are behind ONE feature flag,
   NEWSLETTER_ENABLED, default OFF. When it is off the forms render
   nothing — they are not in the static HTML at all and this script does
   not create them. Flip the flag to true to show them again. The API
   functions and the stored subscribers are untouched; no email service
   is connected here. */
(function () {
  'use strict';
  var NEWSLETTER_ENABLED = false;
  var API_BASE = 'https://fs-ai.mdalfahad841.workers.dev';
  var PENDING_NOTE = 'Subscribed — status: pending confirmation. Confirmation emails cannot be sent yet: no free email sender is connected.';

  function validEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '');
  }

  function post(path, body) {
    return fetch(API_BASE + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        return { ok: res.ok, status: res.status, data: data };
      });
    });
  }

  function subscribe(email, name) {
    if (!validEmail(email)) return Promise.resolve({ ok: false, error: 'Enter a valid email address.' });
    return post('/api/newsletter/subscribe', { email: email, name: name || undefined, consent: true })
      .then(function (r) {
        if (r.status === 201) return { ok: true, message: PENDING_NOTE };
        if (r.status === 200) return { ok: true, message: (r.data && r.data.message) || 'This email is already subscribed.' };
        return { ok: false, error: (r.data && r.data.error) || 'Subscribe failed (HTTP ' + r.status + ').' };
      })
      .catch(function () {
        return { ok: false, error: 'Could not reach the FS AI server. Check your connection and try again — nothing was stored.' };
      });
  }

  function unsubscribe(email) {
    if (!validEmail(email)) return Promise.resolve({ ok: false, error: 'Enter a valid email address.' });
    return post('/api/newsletter/unsubscribe', { email: email })
      .then(function (r) {
        if (r.ok) return { ok: true, message: 'Unsubscribed. This address will no longer receive the newsletter.' };
        return { ok: false, error: (r.data && r.data.error) || 'Unsubscribe failed (HTTP ' + r.status + ').' };
      })
      .catch(function () {
        return { ok: false, error: 'Could not reach the FS AI server. Check your connection and try again.' };
      });
  }

  /* Build the subscribe + unsubscribe forms into #newsletterForms and
     wire them. Only ever called when NEWSLETTER_ENABLED is true. */
  function renderNewsletterForms() {
    var slot = document.getElementById('newsletterForms');
    if (!slot) return false;
    slot.innerHTML =
      '<form id="newsletterForm">' +
        '<label for="newsletterName" class="skip-link">Your name (optional)</label>' +
        '<input id="newsletterName" type="text" placeholder="Your name (optional)" autocomplete="name">' +
        '<label for="newsletterEmail" class="skip-link">Your email address</label>' +
        '<input id="newsletterEmail" type="email" required placeholder="you@example.com" autocomplete="email">' +
        '<label class="consent"><input id="newsletterConsent" type="checkbox" required> I agree to receive the FS AI newsletter at this address.</label>' +
        '<button class="btn btn-primary" type="submit">Subscribe</button>' +
      '</form>' +
      '<p id="newsletterNote" class="muted" aria-live="polite"></p>' +
      '<form id="unsubscribeForm" class="unsubscribe-form">' +
        '<label for="unsubscribeEmail" class="skip-link">Email address to unsubscribe</label>' +
        '<input id="unsubscribeEmail" type="email" required placeholder="you@example.com to unsubscribe">' +
        '<button class="btn btn-outline" type="submit">Unsubscribe</button>' +
      '</form>' +
      '<p id="unsubscribeNote" class="muted" aria-live="polite"></p>';
    var form = document.getElementById('newsletterForm');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var emailEl = document.getElementById('newsletterEmail');
        var nameEl = document.getElementById('newsletterName');
        var consentEl = document.getElementById('newsletterConsent');
        var note = document.getElementById('newsletterNote');
        var email = emailEl ? emailEl.value.trim() : '';
        if (consentEl && !consentEl.checked) {
          if (note) note.textContent = 'Please tick the consent box to subscribe.';
          return;
        }
        if (note) note.textContent = 'Subscribing…';
        subscribe(email, nameEl ? nameEl.value.trim() : '').then(function (r) {
          if (note) note.textContent = r.ok ? r.message : r.error;
          if (r.ok && form) form.reset();
        });
      });
    }
    var unForm = document.getElementById('unsubscribeForm');
    if (unForm) {
      unForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var emailEl = document.getElementById('unsubscribeEmail');
        var note = document.getElementById('unsubscribeNote');
        var email = emailEl ? emailEl.value.trim() : '';
        if (note) note.textContent = 'Unsubscribing…';
        unsubscribe(email).then(function (r) {
          if (note) note.textContent = r.ok ? r.message : r.error;
          if (r.ok && unForm) unForm.reset();
        });
      });
    }
    return true;
  }

  window.FSAI = window.FSAI || {};
  window.FSAI.newsletter = { subscribe: subscribe, unsubscribe: unsubscribe, validEmail: validEmail };
  window.FSAI.newsletterEnabled = NEWSLETTER_ENABLED;
  window.FSAI.renderNewsletterForms = renderNewsletterForms;

  document.addEventListener('DOMContentLoaded', function () {
    if (!NEWSLETTER_ENABLED) return;
    renderNewsletterForms();
  });
})();
