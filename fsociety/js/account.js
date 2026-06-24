/**
 * account.js — F-Society Account Module
 * EXN STUDIO
 * Profile display, account deletion with 14-day grace period,
 * pending deletion detection on login.
 */

(function () {
  'use strict';

  const DELETE_CONFIRM_PHRASE = 'DELETE ACCOUNT';
  let sb          = null;
  let currentUser = null;

  /* ── INIT ────────────────────────────────────────────────── */
  async function init(supabaseClient, user) {
    sb          = supabaseClient;
    currentUser = user;

    renderProfile(user);
    await checkPendingDeletion(user);
    bindDeletion();
  }

  /* ── RENDER PROFILE ──────────────────────────────────────── */
  function renderProfile(user) {
    if (!user) return;

    const meta     = user.user_metadata || {};
    const username = localStorage.getItem('fsoc_username') || meta.username || 'user';
    const joined   = meta.joined || user.created_at || '';
    const memberId = _deriveMemberId(user.id);

    // Avatar initials
    const initials = username.substring(0, 2).toUpperCase();

    const avatarEl   = document.getElementById('profile-avatar');
    const userEl     = document.getElementById('profile-username');
    const joinedEl   = document.getElementById('profile-joined');
    const memberIdEl = document.getElementById('profile-member-id');
    const emailEl    = document.getElementById('profile-email');

    if (avatarEl)   avatarEl.textContent   = initials;
    if (userEl)     userEl.textContent     = username;
    if (joinedEl)   joinedEl.textContent   = _formatDate(joined);
    if (memberIdEl) memberIdEl.textContent = memberId;
    if (emailEl)    emailEl.textContent    = username;

    // Also fill the detail row
    const joinedDetailEl = document.getElementById('profile-joined-detail');
    if (joinedDetailEl) joinedDetailEl.textContent = _formatDate(joined);
  }

  /* ── CHECK PENDING DELETION ──────────────────────────────── */
  async function checkPendingDeletion(user) {
    if (!sb || !user) return;

    try {
      const { data } = await sb
        .from('pending_deletions')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (data) {
        showPendingNotice(data.delete_at);
      }
    } catch (err) {
      console.warn('[Account] Pending deletion check:', err);
    }
  }

  function showPendingNotice(deleteAtStr) {
    const notice = document.getElementById('pending-deletion-notice');
    if (!notice) return;
    notice.classList.add('visible');

    const deleteAt = new Date(deleteAtStr);
    const countdown = document.getElementById('deletion-countdown');

    const update = () => {
      const remaining = Math.max(0, deleteAt - Date.now());
      const days = Math.floor(remaining / 86400000);
      const hrs  = Math.floor((remaining % 86400000) / 3600000);
      const mins = Math.floor((remaining % 3600000) / 60000);
      if (countdown) {
        countdown.textContent = `Account deletes in: ${days}d ${hrs}h ${mins}m — log in again to cancel.`;
      }
      if (remaining <= 0) clearInterval(iv);
    };

    update();
    const iv = setInterval(update, 60000);
  }

  /* ── DELETE ACCOUNT ──────────────────────────────────────── */
  function bindDeletion() {
    const deleteBtn   = document.getElementById('delete-account-btn');
    const confirmModal= document.getElementById('delete-modal');
    const cancelBtn   = document.getElementById('delete-cancel-btn');
    const confirmBtn  = document.getElementById('delete-confirm-btn');
    const confirmInput= document.getElementById('delete-confirm-input');

    if (!deleteBtn) return;

    // Step 1: open modal
    deleteBtn.addEventListener('click', () => {
      if (!confirmModal) return;
      confirmModal.classList.remove('hidden');
      confirmModal.removeAttribute('aria-hidden');
      if (confirmInput) {
        confirmInput.value = '';
        confirmInput.focus();
      }
      if (confirmBtn) confirmBtn.disabled = true;
    });

    // Watch input for exact phrase
    confirmInput && confirmInput.addEventListener('input', () => {
      if (confirmBtn) {
        confirmBtn.disabled = confirmInput.value !== DELETE_CONFIRM_PHRASE;
      }
    });

    // Cancel
    cancelBtn && cancelBtn.addEventListener('click', closeDeleteModal);

    confirmModal && confirmModal.addEventListener('click', (e) => {
      if (e.target === confirmModal) closeDeleteModal();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && confirmModal && !confirmModal.classList.contains('hidden')) {
        closeDeleteModal();
      }
    });

    // Step 2: confirm deletion
    confirmBtn && confirmBtn.addEventListener('click', async () => {
      if (confirmInput?.value !== DELETE_CONFIRM_PHRASE) return;

      confirmBtn.disabled = true;
      confirmBtn.textContent = 'Processing...';

      await scheduleAccountDeletion();
      closeDeleteModal();
    });
  }

  async function scheduleAccountDeletion() {
    if (!sb || !currentUser) return;

    const deleteAt = new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString();

    try {
      // Record pending deletion
      const { error } = await sb.from('pending_deletions').upsert({
        user_id:   currentUser.id,
        delete_at: deleteAt,
      }, { onConflict: 'user_id' });

      if (error) throw error;

      Toast.warning('Account marked for deletion. You have 14 days to log back in to cancel.', 8000);
      showPendingNotice(deleteAt);

      // Sign out
      setTimeout(async () => {
        await Auth.logout();
      }, 3000);

    } catch (err) {
      console.error('[Account] Deletion scheduling:', err);
      Toast.error('Failed to schedule account deletion. Try again.');
      const btn = document.getElementById('delete-confirm-btn');
      if (btn) { btn.disabled = false; btn.textContent = 'Confirm Deletion'; }
    }
  }

  function closeDeleteModal() {
    const modal = document.getElementById('delete-modal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');

    const input = document.getElementById('delete-confirm-input');
    if (input) input.value = '';
    const btn = document.getElementById('delete-confirm-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Confirm Deletion'; }
  }

  /* ── HELPERS ─────────────────────────────────────────────── */
  function _deriveMemberId(uuid) {
    if (!uuid) return 'N/A';
    // Take first 8 chars of UUID for display
    return 'FSM-' + uuid.replace(/-/g, '').substring(0, 8).toUpperCase();
  }

  function _formatDate(dateStr) {
    if (!dateStr) return 'Unknown';
    try {
      return new Date(dateStr).toLocaleDateString('en-ZM', {
        year: 'numeric', month: 'long', day: 'numeric'
      });
    } catch { return dateStr; }
  }

  /* ── EXPORTS ─────────────────────────────────────────────── */
  window.Account = { init };

})();
