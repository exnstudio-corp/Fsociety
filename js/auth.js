/**
 * auth.js — F-Society Authentication Module
 * EXN STUDIO
 * Handles registration, login, session persistence, rate limiting.
 * Uses Supabase Auth. Secrets loaded from Netlify env → window.__ENV__.
 */

(function () {
  'use strict';

  /* ── CONFIG ──────────────────────────────────────────────── */
  const RATE_LIMIT = {
    MAX_ATTEMPTS: 2,
    WINDOW_MS:    24 * 60 * 60 * 1000, // 24 hours
    COOLDOWN_MS:  9  * 60 * 60 * 1000, // 9 hours
    STORAGE_KEY:  'fsoc_reg_rl',
  };

  const USERNAME_RE   = /^[a-zA-Z0-9_]{4,24}$/;
  const URL_RE        = /https?:\/\/|www\./i;

  /* ── SUPABASE CLIENT (lazy) ──────────────────────────────── */
  // We use a lazy getter so the client is only created after
  // window.__ENV__ has been populated by /.netlify/functions/env.
  let _sb = null;

  function getSupabase() {
    if (_sb) return _sb;
    const env = window.__ENV__ || {};
    if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
      console.error('[F-Society] Supabase env vars missing. Ensure /.netlify/functions/env loaded first.');
      return null;
    }
    _sb = supabase.createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
    return _sb;
  }

  // Proxy getter so callers can use Auth.sb and always get current client
  Object.defineProperty(window, '_fsocSb', {
    get: getSupabase,
    configurable: true,
  });

  /* ── RATE LIMIT HELPERS ──────────────────────────────────── */
  function getRLData() {
    try {
      const raw = localStorage.getItem(RATE_LIMIT.STORAGE_KEY);
      return raw ? JSON.parse(raw) : { attempts: 0, lastAttempt: 0, cooldownUntil: 0 };
    } catch { return { attempts: 0, lastAttempt: 0, cooldownUntil: 0 }; }
  }

  function saveRLData(data) {
    localStorage.setItem(RATE_LIMIT.STORAGE_KEY, JSON.stringify(data));
  }

  function isRateLimited() {
    const d = getRLData();
    const now = Date.now();

    // Cooldown active?
    if (d.cooldownUntil && now < d.cooldownUntil) {
      return { limited: true, cooldownUntil: d.cooldownUntil };
    }

    // Reset window if 24h has passed
    if (now - d.lastAttempt > RATE_LIMIT.WINDOW_MS) {
      saveRLData({ attempts: 0, lastAttempt: 0, cooldownUntil: 0 });
      return { limited: false };
    }

    if (d.attempts >= RATE_LIMIT.MAX_ATTEMPTS) {
      const cooldownUntil = d.lastAttempt + RATE_LIMIT.COOLDOWN_MS;
      saveRLData({ ...d, cooldownUntil });
      return { limited: true, cooldownUntil };
    }

    return { limited: false };
  }

  function recordAttempt() {
    const d = getRLData();
    const now = Date.now();
    const attempts = (now - d.lastAttempt > RATE_LIMIT.WINDOW_MS) ? 1 : d.attempts + 1;
    saveRLData({ attempts, lastAttempt: now, cooldownUntil: attempts >= RATE_LIMIT.MAX_ATTEMPTS ? now + RATE_LIMIT.COOLDOWN_MS : 0 });
  }

  /* ── PASSWORD VALIDATION ─────────────────────────────────── */
  function validatePassword(pw) {
    return {
      length:    pw.length >= 13,
      uppercase: /[A-Z]/.test(pw),
      lowercase: /[a-z]/.test(pw),
      number:    /[0-9]/.test(pw),
      symbol:    /[^a-zA-Z0-9]/.test(pw),
    };
  }

  function passwordScore(rules) {
    return Object.values(rules).filter(Boolean).length;
  }

  /* ── PASSWORD STRENGTH UI ────────────────────────────────── */
  function initPasswordStrength(inputEl, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const rules = [
      { key: 'length',    label: 'At least 13 characters' },
      { key: 'uppercase', label: 'Uppercase letter (A-Z)' },
      { key: 'lowercase', label: 'Lowercase letter (a-z)' },
      { key: 'number',    label: 'Number (0-9)' },
      { key: 'symbol',    label: 'Special character (!@#$...)' },
    ];

    container.innerHTML = `
      <div class="pw-bar" aria-hidden="true">
        <div class="pw-bar-fill" id="${containerId}-fill"></div>
      </div>
      <div class="pw-rules" role="list" aria-label="Password requirements">
        ${rules.map(r => `
          <span class="pw-rule" id="${containerId}-${r.key}" role="listitem" aria-live="polite">
            ${_escHtml(r.label)}
          </span>`).join('')}
      </div>
    `;

    inputEl.addEventListener('input', () => {
      const val   = inputEl.value;
      const res   = validatePassword(val);
      const score = passwordScore(res);
      const fill  = document.getElementById(`${containerId}-fill`);

      const colors = ['', '#ff3333', '#ff7700', '#ffaa00', '#99cc00', '#00ff41'];
      if (fill) {
        fill.style.width      = `${(score / 5) * 100}%`;
        fill.style.background = colors[score] || colors[0];
      }

      rules.forEach(r => {
        const el = document.getElementById(`${containerId}-${r.key}`);
        if (el) {
          el.classList.toggle('ok', res[r.key]);
          el.setAttribute('aria-label', `${r.label}: ${res[r.key] ? 'met' : 'not met'}`);
        }
      });
    });
  }

  /* ── SIGNUP PAGE ─────────────────────────────────────────── */
  function initSignup() {
    const form       = document.getElementById('signup-form');
    if (!form) return;

    const usernameEl  = document.getElementById('username');
    const passwordEl  = document.getElementById('password');
    const confirmEl   = document.getElementById('confirm-password');
    const termsEl     = document.getElementById('terms-check');
    const submitBtn   = document.getElementById('signup-btn');
    const rateLimitEl = document.getElementById('rate-limit-box');

    // Expose password strength
    initPasswordStrength(passwordEl, 'pw-strength');

    // Rate limit check on load
    const rl = isRateLimited();
    if (rl.limited) {
      showRateLimit(rl.cooldownUntil);
    }

    // Live username validation
    usernameEl && usernameEl.addEventListener('input', () => {
      const val = usernameEl.value.trim();
      const errEl = document.getElementById('username-error');
      if (!errEl) return;
      if (!val) { errEl.textContent = ''; return; }
      if (!USERNAME_RE.test(val)) {
        errEl.textContent = '4–24 characters. Letters, numbers, underscores only.';
      } else {
        errEl.textContent = '';
      }
    });

    // Live confirm password
    confirmEl && confirmEl.addEventListener('input', () => {
      const errEl = document.getElementById('confirm-error');
      if (!errEl) return;
      if (confirmEl.value && confirmEl.value !== passwordEl.value) {
        errEl.textContent = 'Passwords do not match.';
      } else {
        errEl.textContent = '';
      }
    });

    // Submit
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const rlCheck = isRateLimited();
      if (rlCheck.limited) {
        showRateLimit(rlCheck.cooldownUntil);
        return;
      }

      const username = usernameEl.value.trim();
      const password = passwordEl.value;
      const confirm  = confirmEl.value;
      const terms    = termsEl ? termsEl.checked : false;

      // Validations
      if (!USERNAME_RE.test(username)) {
        Toast.error('Invalid username format.');
        return;
      }

      const pwRules = validatePassword(password);
      if (!Object.values(pwRules).every(Boolean)) {
        Toast.error('Password does not meet all requirements.');
        return;
      }

      if (password !== confirm) {
        Toast.error('Passwords do not match.');
        return;
      }

      if (!terms) {
        Toast.warning('You must accept the Terms and Conditions.');
        return;
      }

      const sb = getSupabase();
      if (!sb) {
        Toast.error('Configuration error. Contact administrator.');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Registering...';

      recordAttempt();

      try {
        // Use email format: username@fsociety.local (Supabase requires email)
        const email = `${username.toLowerCase()}@fsociety.internal`;

        const { data, error } = await sb.auth.signUp({
          email,
          password,
          options: {
            data: {
              username,
              joined: new Date().toISOString(),
            }
          }
        });

        if (error) throw error;

        // Store username mapping locally and in profile table
        localStorage.setItem('fsoc_username', username);

        Toast.success('Account created. Redirecting...');
        setTimeout(() => { window.location.href = 'index.html'; }, 1500);

      } catch (err) {
        console.error('[Signup]', err);
        Toast.error(err.message || 'Registration failed. Try again later.');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create Account';

        const rlNow = isRateLimited();
        if (rlNow.limited) showRateLimit(rlNow.cooldownUntil);
      }
    });

    function showRateLimit(cooldownUntil) {
      if (!rateLimitEl) return;
      rateLimitEl.classList.add('visible');
      if (submitBtn) submitBtn.disabled = true;

      const update = () => {
        const remaining = Math.max(0, cooldownUntil - Date.now());
        const hrs  = Math.floor(remaining / 3600000);
        const mins = Math.floor((remaining % 3600000) / 60000);
        const secs = Math.floor((remaining % 60000) / 1000);
        const countdown = document.getElementById('rl-countdown');
        if (countdown) {
          countdown.textContent = `${String(hrs).padStart(2,'0')}:${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
        }
        if (remaining <= 0) {
          clearInterval(iv);
          rateLimitEl.classList.remove('visible');
          if (submitBtn) submitBtn.disabled = false;
          saveRLData({ attempts: 0, lastAttempt: 0, cooldownUntil: 0 });
        }
      };
      update();
      const iv = setInterval(update, 1000);
    }
  }

  /* ── LOGIN PAGE ──────────────────────────────────────────── */
  function initLogin() {
    const form = document.getElementById('login-form');
    if (!form) return;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const sb = getSupabase();
      if (!sb) {
        Toast.error('Configuration error. Contact administrator.');
        return;
      }

      const username    = document.getElementById('l-username').value.trim();
      const password    = document.getElementById('l-password').value;
      const rememberMe  = document.getElementById('remember-me')?.checked;
      const submitBtn   = document.getElementById('login-btn');

      if (!username || !password) {
        Toast.warning('Enter username and password.');
        return;
      }

      submitBtn.disabled    = true;
      submitBtn.textContent = 'Authenticating...';

      try {
        const email = `${username.toLowerCase()}@fsociety.internal`;
        const { data, error } = await sb.auth.signInWithPassword({ email, password });

        if (error) throw error;

        // Cancel pending deletion if user logs back in
        await cancelPendingDeletion(data.user.id);

        localStorage.setItem('fsoc_username', username);

        if (!rememberMe) {
          // Session will expire when browser closes (handled by Supabase default)
        }

        Toast.success('Authentication successful.');
        setTimeout(() => { window.location.href = 'index.html'; }, 1000);

      } catch (err) {
        console.error('[Login]', err);
        Toast.error('Invalid credentials. Check username and password.');
        submitBtn.disabled    = false;
        submitBtn.textContent = 'Access System';
      }
    });

    // Toggle password visibility
    const toggleBtns = document.querySelectorAll('.toggle-pass');
    toggleBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetId = btn.dataset.target;
        const input = document.getElementById(targetId);
        if (!input) return;
        const isPass = input.type === 'password';
        input.type = isPass ? 'text' : 'password';
        const icon = btn.querySelector('ion-icon');
        if (icon) icon.name = isPass ? 'eye-off-outline' : 'eye-outline';
        btn.setAttribute('aria-label', isPass ? 'Hide password' : 'Show password');
      });
    });
  }

  /* ── SESSION CHECK ───────────────────────────────────────── */
  async function checkSession() {
    const sb = getSupabase();
    if (!sb) return null;
    try {
      const { data } = await sb.auth.getSession();
      return data?.session?.user || null;
    } catch { return null; }
  }

  /* ── LOGOUT ──────────────────────────────────────────────── */
  async function logout() {
    const sb = getSupabase();
    if (!sb) { window.location.href = 'login.html'; return; }
    try {
      await sb.auth.signOut();
    } catch (e) {
      console.warn('[Logout]', e);
    }
    localStorage.removeItem('fsoc_username');
    window.location.href = 'login.html';
  }

  /* ── CANCEL PENDING DELETION ─────────────────────────────── */
  async function cancelPendingDeletion(userId) {
    const sb = getSupabase();
    if (!sb || !userId) return;
    try {
      await sb.from('pending_deletions').delete().eq('user_id', userId);
    } catch (e) {
      console.warn('[CancelDeletion]', e);
    }
  }

  /* ── HELPER ──────────────────────────────────────────────── */
  function _escHtml(str) {
    return String(str)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* ── EXPORTS ─────────────────────────────────────────────── */
  window.Auth = {
    get sb() { return getSupabase(); },
    initSignup,
    initLogin,
    checkSession,
    logout,
    validatePassword,
    cancelPendingDeletion,
    USERNAME_RE,
    URL_RE,
  };

})();
