# Remember Stockholm 2026 — Convention Photo Pool

A single-page photo-sharing site for our international convention, styled after
the *Discover Guide Stockholm 2026*. Everyone's photos land in **one shared
Google Drive folder**; the site is the pretty front door to it.

**How it works (and why it's reliable):**

- **Storage** — a normal Google Drive folder you own. No database, no custom
  server that can go down or lose data. If the site ever breaks, the photos are
  still just sitting in Drive.
- **Gallery** — the folder is shared "Anyone with the link", so the site can
  list and show the photos using a read-only API key. No sign-in needed to browse.
- **Uploads** — friends click *Sign in with Google* and their photos upload
  straight into the folder from their browser, under their own account (the
  minimal `drive.file` permission — the site can only touch files it creates,
  never their whole Drive).
- **Hosting** — GitHub Pages, straight from this repository. Free, static, nothing to maintain.

Features: masonry gallery with lightbox and keyboard navigation, drag-and-drop
multi-file upload with progress bars, grouping by **day** (from the photo's EXIF
date) and by **person** (who uploaded it), live counters, video support.

---

## Setup

You do this once; it takes about 15 minutes.

### 1. Create the shared Drive folder

1. In [Google Drive](https://drive.google.com), create a folder, e.g. **Convention Photos 2026**.
2. Right-click it → **Share** → under *General access* choose
   **Anyone with the link** → **Editor**.
   *(Editor lets friends upload during the convention. Afterwards you can flip
   it to **Viewer** — the gallery keeps working, uploads stop.)*
3. Copy the folder link. The ID is the last part of the URL:
   `https://drive.google.com/drive/folders/`**`1AbCdEfGh...`**

### 2. Create the Google Cloud credentials

1. Go to [console.cloud.google.com](https://console.cloud.google.com) (sign in
   with your Gmail) and create a new project, e.g. `ic-photo`.
2. **Enable the Drive API:** *APIs & Services → Library →* search
   **Google Drive API** → **Enable**.
3. **API key** (for the gallery): *APIs & Services → Credentials → Create
   credentials → API key.* Then click the key to restrict it:
   - *Application restrictions:* **Websites** → add your site URL
     (e.g. `https://skeilmann.github.io/*`)
   - *API restrictions:* **Restrict key** → Google Drive API
4. **OAuth consent screen:** *APIs & Services → OAuth consent screen* →
   External → fill in the app name and your email. Add the scope
   `.../auth/drive.file` if asked. Add your friends as *test users*, **or**
   click **Publish app** so anyone with a Google account can sign in
   (recommended for a convention — the `drive.file` scope needs no Google review).
5. **OAuth Client ID** (for uploads): *Credentials → Create credentials →
   OAuth client ID → Web application.* Under **Authorized JavaScript origins** add:
   - `https://skeilmann.github.io`
   - `http://localhost:8000` (for testing locally)

### 3. Configure the site

Open [`js/config.js`](js/config.js) and paste in your three values:

```js
API_KEY:  "AIza....",
CLIENT_ID: "123456-abc.apps.googleusercontent.com",
FOLDER_ID: "1AbCdEfGh...",
```

Commit and push.

### 4. Turn on GitHub Pages

Repository → **Settings → Pages** → *Source:* **Deploy from a branch** →
pick the branch → `/ (root)` → Save.

Your site goes live at `https://skeilmann.github.io/IC-photo/`.
Share that link with your friends — that's it.

---

## Testing locally

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

(Sign-in works on localhost only if you added `http://localhost:8000` as an
authorized origin in step 2.5.)

## Everyday use

- **Friends:** open the site → *Add your photos* → sign in with Google once →
  drag photos in. Done.
- **Browsing:** no sign-in needed. Tabs switch between *All*, *By day*
  (photo's EXIF capture date) and *By person* (uploader's Google name).
- **After the convention:** set the folder's link sharing to *Viewer* to freeze
  the collection. To let everyone take it home, they can open the folder in
  Drive (footer link) and use Drive's built-in **Download all** (zip).

## Design

Colors, type and motifs follow the *Discover Guide Stockholm 2026*:

| Token | Value | Used for |
|---|---|---|
| Blue | `#1B75BC` | headers, ribbon, "The Pool" |
| Orange | `#F7941D` | actions, "Add photos" |
| Yellow | `#E5B632` / `#FFC20E` | accents, third grouping |
| Warm gray | `#9C9A8E` | muted text, dotted texture |

Headings: Poppins (extra-bold, uppercase) · Body: Inter · Handwritten accents: Caveat.
