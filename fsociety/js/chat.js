/**
 * chat.js — F-Society Chat Module
 * EXN STUDIO
 * Global real-time chat via Supabase Realtime.
 * Message validation, file sharing (.txt only, 5KB max),
 * download confirmation modal, daily upload limits.
 */

(function () {
  'use strict';

  const MAX_MSG_LEN    = 500;
  const MAX_FILE_SIZE  = 5 * 1024;      // 5 KB
  const ALLOWED_EXT    = ['txt'];
  const DAILY_UPLOAD_LIMIT = 3;
  const UPLOAD_KEY     = 'fsoc_uploads';
  const URL_PATTERNS   = [/https?:\/\//i, /www\./i];
  const MD_LINK_RE     = /\[.+?\]\(.+?\)/;
  const BUCKET_NAME    = 'chat-files';   // Must exist in Supabase Storage

  let sb        = null;
  let channel   = null;
  let currentUser = null;
  let pendingDownload = null;

  /* ── INIT ────────────────────────────────────────────────── */
  async function init(supabaseClient, user) {
    sb          = supabaseClient;
    currentUser = user;

    if (!sb) {
      renderError('Chat unavailable: Supabase not configured.');
      return;
    }

    await loadHistory();
    subscribeRealtime();
    bindInputEvents();
    bindFileUpload();
    bindDownloadModal();
  }

  /* ── LOAD HISTORY ────────────────────────────────────────── */
  async function loadHistory() {
    try {
      const { data, error } = await sb
        .from('chat_messages')
        .select('*')
        .order('created_at', { ascending: true })
        .limit(150);

      if (error) throw error;

      const container = document.getElementById('chat-messages');
      if (!container) return;
      container.innerHTML = '';

      (data || []).forEach(msg => appendMessage(msg, false));
      scrollToBottom();

    } catch (err) {
      console.error('[Chat] History load:', err);
      renderError('Failed to load chat history.');
    }
  }

  /* ── REALTIME SUBSCRIPTION ───────────────────────────────── */
  function subscribeRealtime() {
    if (!sb) return;

    channel = sb
      .channel('public:chat_messages')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_messages',
      }, (payload) => {
        const msg = payload.new;
        // Avoid duplicate if we optimistically added it
        const exists = document.querySelector(`[data-msg-id="${msg.id}"]`);
        if (!exists) {
          appendMessage(msg, true);
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[Chat] Realtime connected.');
        }
      });
  }

  /* ── APPEND MESSAGE ──────────────────────────────────────── */
  function appendMessage(msg, doScroll = true) {
    const container = document.getElementById('chat-messages');
    if (!container) return;

    const isOwn = currentUser && msg.user_id === currentUser.id;
    const isFile = msg.message_type === 'file';

    const el = document.createElement('div');
    el.className = `chat-msg${isOwn ? ' own-msg' : ''}`;
    el.setAttribute('data-msg-id', msg.id || '');
    el.setAttribute('role', 'article');
    el.setAttribute('aria-label', `Message from ${_escHtml(msg.username || 'User')} at ${_formatTime(msg.created_at)}`);

    el.innerHTML = `
      <div class="chat-msg-header">
        <span class="chat-msg-user">${_escHtml(msg.username || 'anon')}</span>
        <span class="chat-msg-time">${_formatTime(msg.created_at)}</span>
      </div>
      ${isFile
        ? `<div class="chat-msg-body is-file">
             <ion-icon name="document-text-outline" aria-hidden="true"></ion-icon>
             <span>${_escHtml(msg.file_name || 'file.txt')}</span>
             <span class="file-dl"
               role="button" tabindex="0"
               aria-label="Download file: ${_escHtml(msg.file_name || 'file')}"
               data-path="${_escHtml(msg.file_path || '')}"
               data-name="${_escHtml(msg.file_name || 'file.txt')}"
               onclick="Chat.promptDownload('${_escHtml(msg.file_path || '')}','${_escHtml(msg.file_name || 'file.txt')}')"
               onkeydown="if(event.key==='Enter'){Chat.promptDownload('${_escHtml(msg.file_path || '')}','${_escHtml(msg.file_name || 'file.txt')}')}"
             >[download]</span>
           </div>`
        : `<div class="chat-msg-body">${_escHtml(msg.content || '')}</div>`
      }
    `;

    container.appendChild(el);
    if (doScroll) scrollToBottom();
  }

  /* ── BIND INPUT EVENTS ───────────────────────────────────── */
  function bindInputEvents() {
    const textarea   = document.getElementById('chat-textarea');
    const sendBtn    = document.getElementById('chat-send-btn');
    const charCount  = document.getElementById('char-count');

    if (!textarea) return;

    textarea.addEventListener('input', () => {
      const len = textarea.value.length;
      if (charCount) {
        charCount.textContent = `${len}/${MAX_MSG_LEN}`;
        charCount.className   = 'chat-char-count';
        if (len > MAX_MSG_LEN * 0.85) charCount.classList.add('warn');
        if (len > MAX_MSG_LEN)        charCount.classList.replace('warn', 'over');
      }
      if (sendBtn) sendBtn.disabled = len === 0 || len > MAX_MSG_LEN;
    });

    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    sendBtn && sendBtn.addEventListener('click', sendMessage);
  }

  /* ── SEND MESSAGE ────────────────────────────────────────── */
  async function sendMessage() {
    const textarea = document.getElementById('chat-textarea');
    if (!textarea || !sb || !currentUser) return;

    const raw = textarea.value.trim();
    if (!raw) return;

    // Validate length
    if (raw.length > MAX_MSG_LEN) {
      Toast.error(`Message exceeds ${MAX_MSG_LEN} characters.`);
      return;
    }

    // Reject URLs
    if (URL_PATTERNS.some(p => p.test(raw)) || MD_LINK_RE.test(raw)) {
      Toast.warning('Links are not allowed in chat messages.');
      return;
    }

    // Sanitize (strip HTML)
    const content = _sanitize(raw);

    const username = localStorage.getItem('fsoc_username') || 'anon';

    // Optimistic render
    const tempId = `temp-${Date.now()}`;
    const tempMsg = {
      id:           tempId,
      user_id:      currentUser.id,
      username,
      content,
      message_type: 'text',
      created_at:   new Date().toISOString(),
    };
    appendMessage(tempMsg, true);
    textarea.value = '';
    updateCharCount(0);

    try {
      const { data, error } = await sb.from('chat_messages').insert({
        user_id:      currentUser.id,
        username,
        content,
        message_type: 'text',
      }).select().single();

      if (error) throw error;

      // Update temp element with real id
      const tempEl = document.querySelector(`[data-msg-id="${tempId}"]`);
      if (tempEl && data) tempEl.setAttribute('data-msg-id', data.id);

    } catch (err) {
      console.error('[Chat] Send:', err);
      Toast.error('Failed to send message.');
      // Remove optimistic message
      const tempEl = document.querySelector(`[data-msg-id="${tempId}"]`);
      if (tempEl) tempEl.remove();
      if (textarea) textarea.value = content;
      updateCharCount(content.length);
    }
  }

  /* ── FILE UPLOAD ─────────────────────────────────────────── */
  function bindFileUpload() {
    const uploadBtn = document.getElementById('chat-upload-btn');
    const fileInput = document.getElementById('file-upload-input');

    if (!uploadBtn || !fileInput) return;

    uploadBtn.addEventListener('click', () => {
      if (!checkUploadLimit()) {
        Toast.warning(`Daily upload limit reached (${DAILY_UPLOAD_LIMIT} files/day). Resets in 24 hours.`);
        return;
      }
      fileInput.click();
    });

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      fileInput.value = '';
      if (!file) return;

      if (!checkUploadLimit()) {
        Toast.warning(`Daily upload limit reached (${DAILY_UPLOAD_LIMIT} files/day).`);
        return;
      }

      // Validate extension
      const ext = file.name.split('.').pop().toLowerCase();
      if (!ALLOWED_EXT.includes(ext)) {
        Toast.error('Only .txt files are allowed.');
        return;
      }

      // Validate size
      if (file.size > MAX_FILE_SIZE) {
        Toast.error(`File too large. Maximum size is ${MAX_FILE_SIZE / 1024}KB.`);
        return;
      }

      await uploadFile(file);
    });

    updateUploadCount();
  }

  async function uploadFile(file) {
    if (!sb || !currentUser) return;

    const uploadBtn = document.getElementById('chat-upload-btn');
    if (uploadBtn) uploadBtn.disabled = true;

    try {
      const path     = `${currentUser.id}/${Date.now()}_${_sanitizeFilename(file.name)}`;
      const username = localStorage.getItem('fsoc_username') || 'anon';

      // Upload to Supabase Storage
      const { data: storageData, error: storageErr } = await sb.storage
        .from(BUCKET_NAME)
        .upload(path, file, { contentType: 'text/plain' });

      if (storageErr) throw storageErr;

      // Record in chat_messages
      const { error: msgErr } = await sb.from('chat_messages').insert({
        user_id:      currentUser.id,
        username,
        content:      '',
        message_type: 'file',
        file_name:    file.name,
        file_path:    path,
      });

      if (msgErr) throw msgErr;

      // Track daily upload
      recordUpload();
      updateUploadCount();
      Toast.success(`File "${file.name}" uploaded successfully.`);

    } catch (err) {
      console.error('[Chat] Upload:', err);
      Toast.error('File upload failed. Try again.');
    } finally {
      if (uploadBtn) uploadBtn.disabled = false;
    }
  }

  /* ── UPLOAD LIMIT TRACKING ───────────────────────────────── */
  function getUploadData() {
    try {
      const raw = localStorage.getItem(UPLOAD_KEY);
      return raw ? JSON.parse(raw) : { count: 0, resetAt: 0 };
    } catch { return { count: 0, resetAt: 0 }; }
  }

  function checkUploadLimit() {
    let d = getUploadData();
    const now = Date.now();
    if (now > d.resetAt) {
      d = { count: 0, resetAt: now + 24 * 3600 * 1000 };
      localStorage.setItem(UPLOAD_KEY, JSON.stringify(d));
    }
    return d.count < DAILY_UPLOAD_LIMIT;
  }

  function recordUpload() {
    let d = getUploadData();
    const now = Date.now();
    if (now > d.resetAt) d = { count: 0, resetAt: now + 24 * 3600 * 1000 };
    d.count++;
    localStorage.setItem(UPLOAD_KEY, JSON.stringify(d));
  }

  function updateUploadCount() {
    const d   = getUploadData();
    const now = Date.now();
    const count = now > d.resetAt ? 0 : d.count;
    const el  = document.getElementById('upload-count');
    if (el) el.textContent = `${count}/${DAILY_UPLOAD_LIMIT} uploads today`;
  }

  function updateCharCount(len) {
    const el = document.getElementById('char-count');
    if (!el) return;
    el.textContent = `${len}/${MAX_MSG_LEN}`;
    el.className   = 'chat-char-count';
  }

  /* ── DOWNLOAD MODAL ──────────────────────────────────────── */
  function promptDownload(filePath, fileName) {
    pendingDownload = { filePath, fileName };
    const modal = document.getElementById('download-modal');
    if (!modal) return;
    document.getElementById('dl-filename').textContent = fileName || 'file.txt';
    modal.classList.remove('hidden');
    modal.removeAttribute('aria-hidden');
    document.getElementById('dl-cancel-btn')?.focus();
  }

  function bindDownloadModal() {
    const cancelBtn   = document.getElementById('dl-cancel-btn');
    const proceedBtn  = document.getElementById('dl-proceed-btn');
    const modal       = document.getElementById('download-modal');

    cancelBtn && cancelBtn.addEventListener('click', () => {
      if (modal) { modal.classList.add('hidden'); modal.setAttribute('aria-hidden','true'); }
      pendingDownload = null;
    });

    proceedBtn && proceedBtn.addEventListener('click', async () => {
      if (!pendingDownload || !sb) return;
      if (modal) { modal.classList.add('hidden'); modal.setAttribute('aria-hidden','true'); }
      await doDownload(pendingDownload.filePath, pendingDownload.fileName);
      pendingDownload = null;
    });

    modal && modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.add('hidden');
        modal.setAttribute('aria-hidden', 'true');
        pendingDownload = null;
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) {
        modal.classList.add('hidden');
        modal.setAttribute('aria-hidden', 'true');
        pendingDownload = null;
      }
    });
  }

  async function doDownload(filePath, fileName) {
    try {
      const { data, error } = await sb.storage.from(BUCKET_NAME).download(filePath);
      if (error) throw error;

      const url  = URL.createObjectURL(data);
      const link = document.createElement('a');
      link.href     = url;
      link.download = fileName || 'download.txt';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      Toast.success(`Downloading "${fileName}".`);
    } catch (err) {
      console.error('[Chat] Download:', err);
      Toast.error('Download failed. File may no longer exist.');
    }
  }

  /* ── HELPERS ─────────────────────────────────────────────── */
  function scrollToBottom() {
    const container = document.getElementById('chat-messages');
    if (container) container.scrollTop = container.scrollHeight;
  }

  function renderError(msg) {
    const container = document.getElementById('chat-messages');
    if (!container) return;
    container.innerHTML = `
      <div class="empty-state">
        <ion-icon name="alert-circle-outline" aria-hidden="true"></ion-icon>
        <p>${_escHtml(msg)}</p>
      </div>`;
  }

  function _formatTime(isoStr) {
    if (!isoStr) return '';
    try {
      return new Date(isoStr).toLocaleTimeString('en-ZM', {
        hour: '2-digit', minute: '2-digit'
      });
    } catch { return isoStr; }
  }

  function _sanitize(str) {
    // Strip all HTML tags
    const d = document.createElement('div');
    d.textContent = str;
    return d.textContent;
  }

  function _sanitizeFilename(name) {
    return name.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 64);
  }

  function _escHtml(str) {
    return String(str)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  /* ── EXPORTS ─────────────────────────────────────────────── */
  window.Chat = { init, promptDownload };

})();
