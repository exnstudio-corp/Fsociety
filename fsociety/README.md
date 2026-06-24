# F-Society — Setup & Deployment Guide
**EXN STUDIO** | Cybersecurity Education Platform

---

## Project Structure

```
fsociety/
├── index.html              # Main app shell (Learn / Chat / Account)
├── login.html              # Login page
├── signup.html             # Registration page
├── warning.html            # Full legal warning & disclaimer
├── privacy.html            # Privacy Policy
├── terms.html              # Terms & Conditions
├── netlify.toml            # Netlify config (headers, redirects, functions)
├── SUPABASE_SCHEMA.sql     # Full DB schema — run in Supabase SQL Editor
├── css/
│   └── style.css           # Global stylesheet (terminal dark theme)
├── js/
│   ├── toast.js            # Toast notification system
│   ├── auth.js             # Auth module (login, signup, rate limiting)
│   ├── learn.js            # Learn section (JSONBin articles + search)
│   ├── chat.js             # Chat module (Supabase Realtime + file sharing)
│   ├── account.js          # Account module (profile + deletion)
│   └── app.js              # App orchestrator (routing, session guard)
├── assets/
│   └── fonts/              # (Optional) local font fallbacks
└── netlify/
    └── functions/
        └── env.js          # Edge function: injects env vars as window.__ENV__
```

---

## 1. Supabase Setup

### 1a. Create a Supabase Project
1. Go to [supabase.com](https://supabase.com) and create a new project.
2. Note your **Project URL** and **anon/public API key** from Settings → API.

### 1b. Run the Schema
1. Open **SQL Editor** in your Supabase Dashboard.
2. Paste and run the entire contents of `SUPABASE_SCHEMA.sql`.
3. This creates:
   - `chat_messages` table with RLS
   - `pending_deletions` table with RLS
   - `file_upload_tracking` table with RLS
   - `increment_upload_count` function
   - Realtime publication for `chat_messages`

### 1c. Create the Storage Bucket
1. Go to **Storage** → **New Bucket**.
2. Name: `chat-files`
3. Public bucket: **OFF** (private)
4. File size limit: `5120` bytes (5KB)
5. Allowed MIME types: `text/plain`

### 1d. Storage RLS Policies
In **Storage → Policies → chat-files**, add:

**Upload (INSERT)**
```sql
(bucket_id = 'chat-files') AND (auth.uid()::text = (storage.foldername(name))[1])
```

**Read (SELECT)**
```sql
bucket_id = 'chat-files'
```

**Delete (DELETE)**
```sql
(bucket_id = 'chat-files') AND (auth.uid()::text = (storage.foldername(name))[1])
```

### 1e. Enable Realtime
Go to **Database → Replication** and toggle **chat_messages** to enabled.

### 1f. (Optional) Enable pg_cron for Auto-Deletion
In **SQL Editor**, enable and schedule:
```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'delete-expired-accounts',
  '0 2 * * *',
  $$
    DELETE FROM auth.users
    WHERE id IN (
      SELECT user_id FROM public.pending_deletions
      WHERE delete_at < NOW()
    );
  $$
);
```

---

## 2. JSONBin Setup (Article Storage)

### 2a. Create an Account
1. Go to [jsonbin.io](https://jsonbin.io) and sign up.
2. Get your **Master Key** from Account → API Keys.

### 2b. Create a Bin
1. Click **Create Bin**.
2. Paste initial article data (see format below).
3. Copy the **Bin ID** from the URL.

### 2c. Article Format
Your JSONBin should contain an array of article objects:
```json
{
  "articles": [
    {
      "id": "1",
      "title": "Introduction to Network Scanning with Nmap",
      "description": "Learn how to use Nmap for host discovery and port scanning in authorized environments.",
      "content": "Full article content goes here...",
      "tags": ["nmap", "network", "scanning", "beginner"],
      "date": "2025-01-15",
      "author": "EXN Studio"
    },
    {
      "id": "2",
      "title": "Understanding ARP Spoofing",
      "description": "A deep dive into ARP protocol vulnerabilities and how they are exploited in MITM attacks.",
      "content": "Full article content goes here...",
      "tags": ["arp", "mitm", "networking", "intermediate"],
      "date": "2025-01-20",
      "author": "EXN Studio"
    }
  ]
}
```

---

## 3. Netlify Deployment

### 3a. Connect Repository
1. Push the project to a GitHub/GitLab repository.
2. In [Netlify](https://netlify.com), click **Add new site → Import from Git**.
3. Select your repository.
4. Build settings:
   - **Build command:** *(leave empty — static site)*
   - **Publish directory:** `.` (root)

### 3b. Set Environment Variables
Go to **Site Settings → Environment Variables** and add:

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | Your Supabase anon/public key |
| `JSONBIN_BIN_ID` | Your JSONBin bin ID |
| `JSONBIN_API_KEY` | Your JSONBin master/access key |

### 3c. Deploy
Click **Deploy site**. Netlify will build and publish.

### 3d. Add Env Injection to HTML Pages
The `netlify/functions/env.js` function exposes env vars safely.

Add this **before** other scripts in each HTML `<head>`:
```html
<script src="/.netlify/functions/env"></script>
```

Add it to: `index.html`, `login.html`, `signup.html`

---

## 4. Supabase Auth Configuration

### Email Format Note
F-Society uses `username@fsociety.internal` as a synthetic email format
to satisfy Supabase Auth's email requirement while keeping usernames
as the user-facing identifier.

### Recommended Auth Settings (Dashboard → Auth → Settings)
- **Email confirmations:** OFF (or configure SMTP if you want email verification)
- **Secure email change:** OFF
- **Session expiry:** 604800 (7 days) for "remember me" behavior
- **Enable signup:** ON

---

## 5. Feature Summary

| Feature | Implementation |
|---|---|
| Splash screen warning | `localStorage` acknowledgement, shows once per device |
| Registration rate limit | 2 attempts per 24h, 9-hour cooldown, client + server tracking |
| Password strength meter | Live 5-rule indicator (length, upper, lower, number, symbol) |
| Real-time chat | Supabase Realtime postgres_changes subscription |
| Message validation | 500 char limit, URL/link rejection, XSS sanitization |
| File sharing | .txt only, 5KB max, 3/day limit, download warning modal |
| Article search | Instant case-insensitive search across title, tags, content |
| Account deletion | 14-day grace period, login cancels deletion |
| Terminal loader | Animated boot sequence on app load |
| Toast notifications | 4 types (success/error/warning/info), auto-dismiss 4s |
| Keyboard navigation | Full Tab/Enter/Escape/Arrow support, visible focus states |
| WCAG AA | ARIA labels, roles, live regions, screen reader support |
| Dark theme | CSS custom properties, Share Tech Mono font, matrix green accent |
| Mobile responsive | Bottom nav bar on mobile, sidebar on desktop |
| CSP headers | Content-Security-Policy via meta tags + netlify.toml |

---

## 6. Security Notes

- **No secrets in client code.** All keys come from `window.__ENV__` injected by the Netlify function.
- **XSS protection:** All user content is escaped before DOM insertion using `textContent` or `_escHtml()`.
- **URL injection:** Chat messages are validated against URL patterns client-side. Add a Supabase DB trigger for server-side enforcement.
- **RLS enforced:** All tables require authentication. Users can only insert their own rows.
- **File validation:** Extension and MIME type checked client-side. Supabase Storage bucket enforces MIME type server-side.
- **Rate limiting:** Registration (2/24h) tracked in `localStorage` + server-side via Supabase counts. Chat upload limit (3/day) tracked same way.

---

## 7. Customization

### Adding Articles
Edit your JSONBin via the JSONBin dashboard or API. Articles load on every visit.

### Changing the Accent Color
In `css/style.css`, update:
```css
--accent: #00ff41;
```

### Updating the Logo/Brand
Search for `F-SOCIETY` in all HTML files and update as needed.

---

*F-Society by EXN Studio | exn-studio.netlify.app*
