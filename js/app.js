/* ============================================================
   Remember Stockholm 2026 — photo pool
   Static site + Google Drive:
     · Gallery reads the public shared folder with an API key
     · Uploads use Google sign-in (drive.file scope) so each
       friend uploads under their own account — no server needed
   ============================================================ */

(function () {
  "use strict";

  const cfg = window.IC_CONFIG || {};
  const configured =
    cfg.API_KEY && !cfg.API_KEY.startsWith("YOUR_") &&
    cfg.CLIENT_ID && !cfg.CLIENT_ID.startsWith("YOUR_") &&
    cfg.FOLDER_ID && !cfg.FOLDER_ID.startsWith("YOUR_");

  const UPLOAD_SCOPES =
    "https://www.googleapis.com/auth/drive.file " +
    "https://www.googleapis.com/auth/userinfo.profile " +
    "https://www.googleapis.com/auth/userinfo.email";

  const META_PREFIX = "pool-meta__"; // per-user JSON files in the shared folder

  // ---------- element handles ----------
  const $ = (sel) => document.querySelector(sel);
  const els = {
    setupNotice: $("#setup-notice"),
    signinBtn: $("#signin-btn"),
    userChip: $("#user-chip"),
    dropzone: $("#dropzone"),
    tray: $("#tray"),
    trayGrid: $("#tray-grid"),
    trayCount: $("#tray-count"),
    trayUpload: $("#tray-upload"),
    trayClear: $("#tray-clear"),
    fab: $("#fab"),
    dzTitle: $("#dz-title"),
    dzSub: $("#dz-sub"),
    fileInput: $("#file-input"),
    uploadList: $("#upload-list"),
    toolbar: $("#toolbar"),
    fSort: $("#f-sort"),
    fDay: $("#f-day"),
    fPerson: $("#f-person"),
    fType: $("#f-type"),
    fTime: $("#f-time"),
    map: $("#map"),
    mapNote: $("#map-note"),
    lbDelete: $("#lb-delete"),
    lbFav: $("#lb-fav"),
    lbRotate: $("#lb-rotate"),
    lbShare: $("#lb-share"),
    lbSave: $("#lb-save"),
    review: $("#review"),
    reviewList: $("#review-list"),
    fReset: $("#f-reset"),
    galleryStatus: $("#gallery-status"),
    galleryGroups: $("#gallery-groups"),
    heroStats: $("#hero-stats"),
    statPhotos: $("#stat-photos"),
    statPeople: $("#stat-people"),
    statDays: $("#stat-days"),
    folderLink: $("#folder-link"),
    lightbox: $("#lightbox"),
    lbStage: $("#lb-stage"),
    lbCaption: $("#lb-caption"),
  };

  // ---------- state ----------
  let files = [];          // all media files from the folder
  let flatOrder = [];      // files in currently rendered order (for lightbox nav)
  let currentGroup = "all";
  let accessToken = null;
  let tokenExpiresAt = 0;  // ms epoch; Google tokens live ~1 hour
  let tokenClient = null;
  let userName = null;
  let userSub = null;      // stable Google account id
  let userEmail = null;
  let isAdmin = false;
  let loginHint = null;    // last account, for one-click re-sign-in

  const SESSION_KEY = "ic-photo-session";

  // ---- shared metadata aggregated from everyone's pool-meta files ----
  let favCounts = new Map();     // fileId -> number of hearts
  let myFavs = new Set();        // fileIds the signed-in user hearted
  let deleteReqBy = new Map();   // fileId -> requester display name
  let dismissed = new Set();     // fileIds the admin decided to keep
  let rotations = new Map();     // fileId -> degrees (0/90/180/270)
  let metaMine = { deleteRequests: [], rotations: {}, dismissed: [] };
  let metaMineId = null;         // Drive file id of my meta file
  let metaByName = new Map();    // meta file name -> {id, data}

  // ============================================================
  // Gallery: list the shared folder with the public API key
  // ============================================================

  async function loadGallery() {
    if (!configured) {
      els.setupNotice.hidden = false;
      els.galleryStatus.textContent =
        "The gallery will appear here once the site is connected to Google Drive.";
      return;
    }

    els.folderLink.href = "https://drive.google.com/drive/folders/" + cfg.FOLDER_ID;

    const fields =
      "nextPageToken,files(id,name,mimeType,createdTime,modifiedTime,thumbnailLink,md5Checksum," +
      "imageMediaMetadata(time,width,height,location,cameraMake,cameraModel)," +
      "videoMediaMetadata(durationMillis)," +
      "owners(displayName),lastModifyingUser(displayName))";

    let out = [];
    let pageToken = "";
    try {
      for (let page = 0; page < 20; page++) {
        const url =
          "https://www.googleapis.com/drive/v3/files" +
          "?q=" + encodeURIComponent(`'${cfg.FOLDER_ID}' in parents and trashed=false`) +
          "&key=" + cfg.API_KEY +
          "&pageSize=200&orderBy=createdTime desc" +
          "&fields=" + encodeURIComponent(fields) +
          (pageToken ? "&pageToken=" + pageToken : "");
        const res = await fetch(url);
        if (!res.ok) throw new Error("Drive API error " + res.status);
        const data = await res.json();
        out = out.concat(data.files || []);
        pageToken = data.nextPageToken;
        if (!pageToken) break;
      }
    } catch (err) {
      console.error(err);
      els.galleryStatus.textContent =
        "Couldn't load the photos. Check that the folder is shared as " +
        "“Anyone with the link” and that the API key in js/config.js is correct.";
      return;
    }

    const metaFiles = out.filter((f) => f.name && f.name.startsWith(META_PREFIX));
    await loadMetas(metaFiles);

    files = out.filter(
      (f) => f.mimeType.startsWith("image/") || f.mimeType.startsWith("video/")
    );

    // Hide exact duplicates (same bytes uploaded twice) — keep the earliest
    const byHash = new Map();
    for (const f of [...files].reverse()) {
      if (f.md5Checksum) byHash.set(f.md5Checksum, f);
    }
    files = files.filter((f) => !f.md5Checksum || byHash.get(f.md5Checksum) === f);

    updateStats();
    populateFilters();
    renderGallery();
    renderReview();
  }

  // ---------- admin review panel ----------

  function renderReview() {
    if (!isAdmin) { els.review.hidden = true; return; }
    const flagged = files.filter(
      (f) => deleteReqBy.has(f.id) && !dismissed.has(f.id)
    );
    els.review.hidden = !flagged.length;
    els.reviewList.innerHTML = "";
    for (const f of flagged) {
      const card = document.createElement("div");
      card.className = "review-card";

      const img = document.createElement("img");
      img.src = imgUrl(f, 300);
      img.alt = f.name;
      img.addEventListener("click", () => {
        flatOrder = flagged;
        openLightbox(flagged.indexOf(f));
      });
      card.appendChild(img);

      const info = document.createElement("div");
      info.className = "review-info";
      info.innerHTML = "<strong></strong><span></span>";
      info.querySelector("strong").textContent =
        "Requested by " + (deleteReqBy.get(f.id) || "someone");
      info.querySelector("span").textContent =
        "Photo by " + fileOwner(f) + " · " +
        fileDate(f).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
      card.appendChild(info);

      const actions = document.createElement("div");
      actions.className = "review-actions";

      const keep = document.createElement("button");
      keep.className = "btn-small btn-keep";
      keep.textContent = "Keep photo";
      keep.addEventListener("click", () => {
        metaMine.dismissed.push(f.id);
        dismissed.add(f.id);
        saveMeta();
        renderReview();
        renderGallery();
      });
      actions.appendChild(keep);

      const rm = document.createElement("button");
      rm.className = "btn-small btn-remove";
      rm.textContent = "Remove photo";
      rm.addEventListener("click", async () => {
        if (!window.confirm("Remove this photo from the shared pool?")) return;
        rm.disabled = true;
        let ok = false;
        // try trash first (works if the admin owns the file), then
        // detaching it from the shared folder (works for others' uploads)
        try {
          let res = await fetch(
            "https://www.googleapis.com/drive/v3/files/" + f.id,
            {
              method: "PATCH",
              headers: {
                Authorization: "Bearer " + accessToken,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ trashed: true }),
            }
          );
          if (!res.ok) {
            res = await fetch(
              "https://www.googleapis.com/drive/v3/files/" + f.id +
              "?removeParents=" + cfg.FOLDER_ID,
              { method: "PATCH", headers: { Authorization: "Bearer " + accessToken } }
            );
          }
          ok = res.ok;
        } catch { ok = false; }
        rm.disabled = false;
        if (ok) {
          files = files.filter((x) => x.id !== f.id);
          updateStats();
          renderReview();
          renderGallery();
        } else {
          window.alert(
            "Drive refused the removal from here. Open the folder in Drive and delete the file there:\n" +
            "https://drive.google.com/drive/folders/" + cfg.FOLDER_ID
          );
        }
      });
      actions.appendChild(rm);

      card.appendChild(actions);
      els.reviewList.appendChild(card);
    }
  }

  // ---------- filtering & sorting ----------

  function populateFilters() {
    if (!files.length) return;

    const keep = (sel) => sel.value; // preserve selection across refreshes
    const dayVal = keep(els.fDay);
    const personVal = keep(els.fPerson);

    const days = [...new Set(files.map(dayKey))].sort();
    els.fDay.innerHTML = '<option value="">All days</option>';
    for (const k of days) {
      const opt = document.createElement("option");
      opt.value = k;
      opt.textContent = dayLabel(k);
      els.fDay.appendChild(opt);
    }
    els.fDay.value = days.includes(dayVal) ? dayVal : "";

    const people = [...new Set(files.map(fileOwner))].sort((a, b) => a.localeCompare(b));
    els.fPerson.innerHTML = '<option value="">Everyone</option>';
    for (const p of people) {
      const opt = document.createElement("option");
      opt.value = p;
      opt.textContent = p;
      els.fPerson.appendChild(opt);
    }
    els.fPerson.value = people.includes(personVal) ? personVal : "";

    els.toolbar.hidden = false;
  }

  function visibleFiles() {
    let list = files;
    if (!isAdmin) {
      const hidden = hiddenIds();
      if (hidden.size) list = list.filter((f) => !hidden.has(f.id));
    }
    if (els.fType.value) list = list.filter((f) => f.mimeType.startsWith(els.fType.value + "/"));
    if (els.fTime.value) list = list.filter((f) => timeOfDay(f) === els.fTime.value);
    if (els.fDay.value) list = list.filter((f) => dayKey(f) === els.fDay.value);
    if (els.fPerson.value) list = list.filter((f) => fileOwner(f) === els.fPerson.value);
    if (els.fSort.value === "fav") {
      return [...list].sort((a, b) =>
        (favCounts.get(b.id) || 0) - (favCounts.get(a.id) || 0) || fileDate(b) - fileDate(a)
      );
    }
    const dir = els.fSort.value === "old" ? 1 : -1;
    return [...list].sort((a, b) => dir * (fileDate(a) - fileDate(b)));
  }

  function updateToolbarState() {
    let any = false;
    for (const sel of [els.fDay, els.fPerson, els.fType, els.fTime]) {
      sel.classList.toggle("is-set", !!sel.value);
      if (sel.value) any = true;
    }
    els.fReset.hidden = !any;
  }

  [els.fSort, els.fDay, els.fPerson, els.fType, els.fTime].forEach((sel) =>
    sel.addEventListener("change", () => {
      updateToolbarState();
      renderGallery();
    })
  );

  els.fReset.addEventListener("click", () => {
    els.fDay.value = els.fPerson.value = els.fType.value = els.fTime.value = "";
    updateToolbarState();
    renderGallery();
  });

  // ---------- shared meta files (favorites / requests / rotations) ----------

  async function loadMetas(metaFiles) {
    favCounts = new Map();
    deleteReqBy = new Map();
    dismissed = new Set();
    rotations = new Map();
    metaByName = new Map();

    const loaded = await Promise.all(
      metaFiles.map(async (f) => {
        try {
          const r = await fetch(
            "https://www.googleapis.com/drive/v3/files/" + f.id +
            "?alt=media&key=" + cfg.API_KEY
          );
          if (!r.ok) return null;
          return { file: f, data: await r.json() };
        } catch { return null; }
      })
    );

    // oldest first so newer rotations win
    const entries = loaded.filter(Boolean).sort(
      (a, b) => new Date(a.file.modifiedTime) - new Date(b.file.modifiedTime)
    );

    for (const { file, data } of entries) {
      metaByName.set(file.name, { id: file.id, data });
      for (const id of data.favorites || []) {
        favCounts.set(id, (favCounts.get(id) || 0) + 1);
      }
      for (const req of data.deleteRequests || []) {
        const id = typeof req === "string" ? req : req.id;
        if (id && !deleteReqBy.has(id)) deleteReqBy.set(id, data.name || "someone");
      }
      for (const [id, deg] of Object.entries(data.rotations || {})) {
        rotations.set(id, deg);
      }
      if (data.admin) for (const id of data.dismissed || []) dismissed.add(id);
    }

    // re-attach my own meta if I'm signed in
    if (userSub) adoptMyMeta();
  }

  function adoptMyMeta() {
    const mine = metaByName.get(META_PREFIX + userSub + ".json");
    if (mine) {
      metaMineId = mine.id;
      metaMine = Object.assign(
        { deleteRequests: [], rotations: {}, dismissed: [] }, mine.data
      );
      myFavs = new Set(mine.data.favorites || []);
    }
  }

  function hiddenIds() {
    const out = new Set();
    for (const id of deleteReqBy.keys()) if (!dismissed.has(id)) out.add(id);
    return out;
  }

  let saveTimer = null;

  function saveMeta() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(doSaveMeta, 600); // coalesce rapid taps
  }

  async function doSaveMeta() {
    if (!accessToken || !userSub) return;
    const body = JSON.stringify({
      v: 1,
      name: userName,
      admin: isAdmin,
      favorites: [...myFavs],
      deleteRequests: metaMine.deleteRequests,
      rotations: metaMine.rotations,
      dismissed: metaMine.dismissed,
    });
    try {
      if (metaMineId) {
        await fetch(
          "https://www.googleapis.com/upload/drive/v3/files/" + metaMineId +
          "?uploadType=media",
          {
            method: "PATCH",
            headers: {
              Authorization: "Bearer " + accessToken,
              "Content-Type": "application/json",
            },
            body,
          }
        );
      } else {
        const form = new FormData();
        form.append("metadata", new Blob([JSON.stringify({
          name: META_PREFIX + userSub + ".json",
          parents: [cfg.FOLDER_ID],
          mimeType: "application/json",
        })], { type: "application/json" }));
        form.append("file", new Blob([body], { type: "application/json" }));
        const r = await fetch(
          "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
          { method: "POST", headers: { Authorization: "Bearer " + accessToken }, body: form }
        );
        if (r.ok) metaMineId = (await r.json()).id;
      }
    } catch (err) {
      console.error("meta save failed", err);
    }
  }

  function fileDate(f) {
    const exif = f.imageMediaMetadata && f.imageMediaMetadata.time;
    if (exif) {
      // EXIF format: "2026:07:01 14:30:22"
      const m = exif.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
      if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    }
    return new Date(f.createdTime);
  }

  function fileOwner(f) {
    if (f.owners && f.owners[0] && f.owners[0].displayName) return f.owners[0].displayName;
    if (f.lastModifyingUser && f.lastModifyingUser.displayName) return f.lastModifyingUser.displayName;
    return "Someone";
  }

  function dayKey(f) {
    const d = fileDate(f);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }

  function dayLabel(key) {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-GB", {
      weekday: "long", day: "numeric", month: "long",
    });
  }

  function thumbUrl(f, size) {
    return "https://drive.google.com/thumbnail?id=" + f.id + "&sz=w" + size;
  }

  // Prefer the lh3.googleusercontent.com link from the API — unlike the
  // drive.google.com/thumbnail redirect it loads reliably on mobile
  // browsers without Drive cookies. "=sN" suffix picks the size.
  function imgUrl(f, size) {
    if (f.thumbnailLink) return f.thumbnailLink.replace(/=s\d+.*$/, "=s" + size);
    return thumbUrl(f, size);
  }

  function timeOfDay(f) {
    const h = fileDate(f).getHours();
    if (h >= 5 && h < 12) return "morning";
    if (h >= 12 && h < 17) return "afternoon";
    if (h >= 17 && h < 22) return "evening";
    return "night";
  }

  function fmtDuration(ms) {
    const s = Math.round(ms / 1000);
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }

  function geo(f) {
    const loc = f.imageMediaMetadata && f.imageMediaMetadata.location;
    if (loc && typeof loc.latitude === "number" && (loc.latitude || loc.longitude)) {
      return [loc.latitude, loc.longitude];
    }
    return null;
  }

  function updateStats() {
    if (!files.length) return;
    els.statPhotos.textContent = files.length;
    els.statPeople.textContent = new Set(files.map(fileOwner)).size;
    els.statDays.textContent = new Set(files.map(dayKey)).size;
    els.heroStats.hidden = false;
  }

  // ---------- rendering ----------

  function renderGallery() {
    els.galleryGroups.innerHTML = "";
    flatOrder = [];

    if (!files.length) {
      els.galleryStatus.textContent =
        "No photos yet — be the first to add some! 📸";
      return;
    }

    const shown = visibleFiles(); // filters + sort applied

    if (currentGroup === "map") {
      els.galleryStatus.textContent = "";
      els.map.hidden = false;
      els.mapNote.hidden = false;
      renderMap(shown);
      return;
    }
    els.map.hidden = true;
    els.mapNote.hidden = true;

    if (!shown.length) {
      els.galleryStatus.textContent = "No photos match these filters.";
      return;
    }
    els.galleryStatus.textContent = "";

    let groups; // array of [title, files[]] — lists keep the chosen sort order
    if (currentGroup === "day") {
      const map = new Map();
      for (const f of shown) {
        const k = dayKey(f);
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(f);
      }
      const dir = els.fSort.value === "old" ? 1 : -1;
      groups = [...map.entries()]
        .sort((a, b) => dir * a[0].localeCompare(b[0]))
        .map(([k, list]) => [dayLabel(k), list]);
    } else if (currentGroup === "person") {
      const map = new Map();
      for (const f of shown) {
        const k = fileOwner(f);
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(f);
      }
      groups = [...map.entries()].sort((a, b) =>
        b[1].length - a[1].length || a[0].localeCompare(b[0])
      );
    } else {
      groups = [[null, shown]];
    }

    for (const [title, list] of groups) {
      const block = document.createElement("div");
      block.className = "group-block";
      if (title) {
        const h = document.createElement("h3");
        h.className = "group-title";
        h.textContent = title;
        block.appendChild(h);
      }
      const grid = document.createElement("div");
      grid.className = "grid";
      for (const f of list) {
        const idx = flatOrder.length;
        flatOrder.push(f);

        const fig = document.createElement("figure");
        const img = document.createElement("img");
        img.loading = "lazy";
        img.alt = f.name;
        img.src = imgUrl(f, 640);
        img.onerror = () => { img.onerror = null; img.src = thumbUrl(f, 640); };
        fig.appendChild(img);

        if (f.mimeType.startsWith("video/")) {
          const badge = document.createElement("span");
          badge.className = "badge-video";
          const dur = f.videoMediaMetadata && f.videoMediaMetadata.durationMillis;
          badge.textContent = dur ? "▶ " + fmtDuration(+dur) : "VIDEO";
          fig.appendChild(badge);
        }

        const hearts = favCounts.get(f.id) || 0;
        if (hearts > 0) {
          const fav = document.createElement("span");
          fav.className = "badge-fav";
          fav.textContent = "♥ " + hearts;
          fig.appendChild(fav);
        }

        if (isAdmin && deleteReqBy.has(f.id) && !dismissed.has(f.id)) {
          fig.classList.add("is-flagged");
        }

        const cap = document.createElement("figcaption");
        cap.textContent = fileOwner(f) + " · " +
          fileDate(f).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
        fig.appendChild(cap);

        fig.addEventListener("click", () => openLightbox(idx));
        grid.appendChild(fig);
      }
      block.appendChild(grid);
      els.galleryGroups.appendChild(block);
    }
  }

  // tabs
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("is-active"));
      tab.classList.add("is-active");
      currentGroup = tab.dataset.group;
      renderGallery();
    });
  });

  // ============================================================
  // Map view (Leaflet + OpenStreetMap, photos with EXIF GPS)
  // ============================================================

  let leafletMap = null;
  let markerLayer = null;

  function renderMap(shown) {
    if (!window.L) { // Leaflet still loading
      setTimeout(() => { if (currentGroup === "map") renderMap(visibleFiles()); }, 300);
      return;
    }
    if (!leafletMap) {
      leafletMap = L.map(els.map).setView([59.3293, 18.0686], 12); // Stockholm
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(leafletMap);
      markerLayer = L.layerGroup().addTo(leafletMap);
    }
    // map was hidden while created → recalc size
    setTimeout(() => leafletMap.invalidateSize(), 60);

    markerLayer.clearLayers();
    const located = shown.filter(geo);
    flatOrder = located; // lightbox navigates the mapped photos
    if (!located.length) {
      els.galleryStatus.textContent = "None of the current photos carry location data.";
      return;
    }
    els.galleryStatus.textContent = "";

    const bounds = [];
    located.forEach((f, idx) => {
      const ll = geo(f);
      bounds.push(ll);
      const isVideo = f.mimeType.startsWith("video/");
      const marker = L.marker(ll, {
        icon: L.divIcon({
          className: "",
          html: '<div class="pin' + (isVideo ? " pin-video" : "") + '"></div>',
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        }),
      });
      const pop = document.createElement("div");
      pop.className = "map-pop";
      pop.innerHTML = '<img alt=""><span></span>';
      pop.querySelector("img").src = imgUrl(f, 300);
      pop.querySelector("span").textContent =
        fileOwner(f) + " · " +
        fileDate(f).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
      pop.addEventListener("click", () => openLightbox(idx));
      marker.bindPopup(pop);
      marker.addTo(markerLayer);
    });
    leafletMap.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
  }

  // ============================================================
  // Lightbox
  // ============================================================

  let lbIndex = 0;

  function openLightbox(i) {
    lbIndex = i;
    showLightboxItem();
    els.lightbox.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeLightbox() {
    els.lightbox.hidden = true;
    els.lbStage.innerHTML = "";
    document.body.style.overflow = "";
  }

  function showLightboxItem() {
    const f = flatOrder[lbIndex];
    if (!f) return;
    els.lbStage.innerHTML = "";
    if (f.mimeType.startsWith("video/")) {
      const iframe = document.createElement("iframe");
      iframe.src = "https://drive.google.com/file/d/" + f.id + "/preview";
      iframe.allow = "autoplay; fullscreen";
      els.lbStage.appendChild(iframe);
    } else {
      // show the (usually cached) small version instantly, then swap in
      // the full-size one when it has loaded
      const img = document.createElement("img");
      img.alt = f.name;
      img.className = "is-loading";
      img.src = imgUrl(f, 640);
      els.lbStage.appendChild(img);

      const idx = lbIndex;
      const hi = new Image();
      hi.onload = () => {
        if (lbIndex === idx && els.lbStage.contains(img)) {
          img.src = hi.src;
          img.classList.remove("is-loading");
        }
      };
      hi.onerror = () => {
        const alt = thumbUrl(f, 2000); // fall back to the other endpoint
        if (hi.src !== alt) { hi.src = alt; }
        else img.classList.remove("is-loading");
      };
      hi.src = imgUrl(f, 2048);
    }
    applyRotation();

    // favorite state
    const hearts = favCounts.get(f.id) || 0;
    els.lbFav.textContent = (myFavs.has(f.id) ? "♥" : "♡") + (hearts ? " " + hearts : "");
    els.lbFav.classList.toggle("is-fav", myFavs.has(f.id));

    // delete vs delete-request, depending on ownership
    const own = userName && fileOwner(f) === userName;
    els.lbDelete.textContent = own || !accessToken ? "🗑 Delete" : "🚩 Ask to delete";

    const cam = f.imageMediaMetadata &&
      (f.imageMediaMetadata.cameraModel || f.imageMediaMetadata.cameraMake);
    els.lbCaption.textContent =
      fileOwner(f) + " · " +
      fileDate(f).toLocaleString("en-GB", {
        weekday: "short", day: "numeric", month: "long",
        hour: "2-digit", minute: "2-digit",
      }) + (cam ? " · 📷 " + cam : "") +
      " · " + (lbIndex + 1) + " / " + flatOrder.length;
  }

  function lbStep(delta) {
    lbIndex = (lbIndex + delta + flatOrder.length) % flatOrder.length;
    showLightboxItem();
  }

  $(".lb-close").addEventListener("click", closeLightbox);
  $(".lb-prev").addEventListener("click", () => lbStep(-1));
  $(".lb-next").addEventListener("click", () => lbStep(1));
  els.lightbox.addEventListener("click", (e) => {
    if (e.target === els.lightbox) closeLightbox();
  });
  document.addEventListener("keydown", (e) => {
    if (els.lightbox.hidden) return;
    if (e.key === "Escape") closeLightbox();
    if (e.key === "ArrowLeft") lbStep(-1);
    if (e.key === "ArrowRight") lbStep(1);
  });

  // ---------- rotate ----------

  function applyRotation() {
    const f = flatOrder[lbIndex];
    if (!f) return;
    const img = els.lbStage.querySelector("img");
    if (!img) return;
    const deg = +(rotations.get(f.id) || 0);
    img.style.transform = deg ? "rotate(" + deg + "deg)" : "";
    // rotated 90/270: keep the image inside the viewport
    if (deg % 180 !== 0) {
      img.style.maxWidth = "84vh";
      img.style.maxHeight = "92vw";
    } else {
      img.style.maxWidth = "";
      img.style.maxHeight = "";
    }
  }

  function rotateCurrent() {
    const f = flatOrder[lbIndex];
    if (!f || f.mimeType.startsWith("video/")) return;
    const deg = (+(rotations.get(f.id) || 0) + 90) % 360;
    rotations.set(f.id, deg);
    applyRotation();
    if (accessToken) { // persist for everyone; otherwise view-only rotation
      metaMine.rotations[f.id] = deg;
      saveMeta();
    }
  }

  els.lbRotate.addEventListener("click", rotateCurrent);

  // ---------- send / share via the phone's native share sheet ----------

  async function shareCurrent() {
    const f = flatOrder[lbIndex];
    if (!f) return;
    const driveLink = "https://drive.google.com/file/d/" + f.id + "/view";
    const title = cfg.EVENT_NAME || "Shared photo";

    els.lbShare.disabled = true;
    try {
      // Best case: hand the actual image file to the share sheet
      // (WhatsApp, Telegram, AirDrop, email… get the photo itself)
      if (navigator.canShare && f.mimeType.startsWith("image/")) {
        try {
          const blob = await (await fetch(imgUrl(f, 2048))).blob();
          const file = new File([blob], f.name || "photo.jpg", {
            type: blob.type || "image/jpeg",
          });
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title });
            return;
          }
        } catch { /* CORS or fetch hiccup — fall through to link share */ }
      }
      // Next best: native share sheet with the Drive link
      if (navigator.share) {
        await navigator.share({ title, url: driveLink });
        return;
      }
      // Desktop fallback: copy the link
      await navigator.clipboard.writeText(driveLink);
      window.alert("Link copied to clipboard:\n" + driveLink);
    } catch (err) {
      // user closed the share sheet — not an error
      if (err && err.name !== "AbortError") {
        window.alert("Couldn't share. Direct link:\n" + driveLink);
      }
    } finally {
      els.lbShare.disabled = false;
    }
  }

  els.lbShare.addEventListener("click", shareCurrent);

  // ---------- save to device ----------

  async function saveCurrent() {
    const f = flatOrder[lbIndex];
    if (!f) return;
    els.lbSave.disabled = true;
    try {
      if (f.mimeType.startsWith("image/")) {
        // download the full-size image as a real file
        const blob = await (await fetch(imgUrl(f, 2048))).blob();
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = f.name || "photo.jpg";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      } else {
        // videos: let Drive serve the original file
        window.open(
          "https://drive.google.com/uc?export=download&id=" + f.id,
          "_blank", "noopener"
        );
      }
    } catch {
      // CORS hiccup — fall back to Drive's own download
      window.open(
        "https://drive.google.com/uc?export=download&id=" + f.id,
        "_blank", "noopener"
      );
    } finally {
      els.lbSave.disabled = false;
    }
  }

  els.lbSave.addEventListener("click", saveCurrent);

  // ---------- favorites ----------

  function toggleFav() {
    const f = flatOrder[lbIndex];
    if (!f) return;
    if (needSignIn(toggleFav)) return;
    const n = favCounts.get(f.id) || 0;
    if (myFavs.has(f.id)) {
      myFavs.delete(f.id);
      favCounts.set(f.id, Math.max(0, n - 1));
    } else {
      myFavs.add(f.id);
      favCounts.set(f.id, n + 1);
    }
    saveMeta();
    showLightboxItem();
  }

  els.lbFav.addEventListener("click", toggleFav);

  // ---------- delete own / request deletion of someone else's ----------

  async function deleteCurrent() {
    const f = flatOrder[lbIndex];
    if (!f) return;
    if (needSignIn(deleteCurrent)) return;

    const own = fileOwner(f) === userName;
    if (!own) {
      if (!window.confirm(
        "Ask for this photo to be deleted?\nIt will be hidden from everyone right away, and the admin will decide."
      )) return;
      metaMine.deleteRequests.push({ id: f.id, at: f.modifiedTime || "" });
      deleteReqBy.set(f.id, userName);
      saveMeta();
      closeLightbox();
      renderGallery();
      renderReview();
      window.alert("Request sent — the photo is hidden until the admin reviews it.");
      return;
    }

    if (!window.confirm("Delete this photo from the shared pool?\n(It moves to the Drive trash and can be restored for 30 days.)")) return;

    els.lbDelete.disabled = true;
    try {
      const res = await fetch("https://www.googleapis.com/drive/v3/files/" + f.id, {
        method: "PATCH",
        headers: {
          Authorization: "Bearer " + accessToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ trashed: true }),
      });
      if (res.ok) {
        files = files.filter((x) => x.id !== f.id);
        updateStats();
        populateFilters();
        if (files.length && flatOrder.length > 1) {
          renderGallery();
          // stay in the lightbox on the next photo
          lbIndex = Math.min(lbIndex, flatOrder.length - 1);
          showLightboxItem();
        } else {
          closeLightbox();
          renderGallery();
        }
      } else if (res.status === 403 || res.status === 404) {
        window.alert("You can only delete photos that you uploaded yourself.");
      } else {
        window.alert("Delete failed (" + res.status + "). Please try again.");
      }
    } catch {
      window.alert("Delete failed — check your connection and try again.");
    } finally {
      els.lbDelete.disabled = false;
    }
  }

  els.lbDelete.addEventListener("click", deleteCurrent);

  // swipe left/right on touch screens
  let touchX = null;
  els.lightbox.addEventListener("touchstart", (e) => {
    touchX = e.changedTouches[0].clientX;
  }, { passive: true });
  els.lightbox.addEventListener("touchend", (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) > 50) lbStep(dx < 0 ? 1 : -1);
  }, { passive: true });

  // ============================================================
  // Sign-in + upload (Google Identity Services, drive.file scope)
  // ============================================================

  function initAuth() {
    if (!configured) return;
    if (!(window.google && google.accounts && google.accounts.oauth2)) {
      // GIS script not loaded yet — retry shortly
      setTimeout(initAuth, 300);
      return;
    }
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: cfg.CLIENT_ID,
      scope: UPLOAD_SCOPES,
      callback: onToken,
    });
    if (!accessToken) els.signinBtn.hidden = false;
  }

  async function onToken(resp) {
    if (resp.error) {
      console.error(resp);
      return;
    }
    accessToken = resp.access_token;
    tokenExpiresAt = Date.now() + (Math.max(60, (resp.expires_in || 3600) - 120)) * 1000;
    try {
      const r = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: "Bearer " + accessToken },
      });
      const info = await r.json();
      userName = info.name || info.given_name || "you";
      userSub = info.sub || null;
      userEmail = info.email || null;
      isAdmin = !!(cfg.ADMIN_EMAIL && userEmail &&
        userEmail.toLowerCase() === cfg.ADMIN_EMAIL.toLowerCase());
    } catch { userName = "you"; }

    saveSession();
    signedInUi();

    // If sign-in was triggered by an action button, continue it now
    if (pendingAction) {
      const act = pendingAction;
      pendingAction = null;
      act();
    }
  }

  function signedInUi() {
    els.signinBtn.hidden = true;
    els.userChip.textContent = (isAdmin ? "⭐ " : "📷 ") + userName;
    els.userChip.hidden = false;
    els.dzTitle.textContent = "Choose photos, " + userName.split(" ")[0];
    adoptMyMeta();
    renderReview();
    renderGallery(); // admin sees hidden photos; fav states show
  }

  // ---------- session persistence across page reloads ----------

  function saveSession() {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({
        token: accessToken,
        expiresAt: tokenExpiresAt,
        name: userName,
        sub: userSub,
        email: userEmail,
        isAdmin,
      }));
    } catch { /* private mode etc. — sign-in just won't persist */ }
  }

  function restoreSession() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { }
    if (!s) return;
    loginHint = s.email || null; // for instant re-sign-in after expiry
    if (!s.token || !(s.expiresAt > Date.now() + 30000)) return;
    accessToken = s.token;
    tokenExpiresAt = s.expiresAt;
    userName = s.name;
    userSub = s.sub;
    userEmail = s.email;
    isAdmin = !!s.isAdmin;
    signedInUi();
  }

  function dropSession() {
    accessToken = null;
    tokenExpiresAt = 0;
    try { localStorage.removeItem(SESSION_KEY); } catch { }
  }

  let pendingAction = null;

  function needSignIn(action) {
    if (accessToken && Date.now() < tokenExpiresAt) return false;
    if (accessToken) dropSession(); // expired
    pendingAction = action;
    requestSignIn();
    return true;
  }

  function requestSignIn() {
    if (!tokenClient) return;
    // with a known account, skip the account chooser for an instant popup
    tokenClient.requestAccessToken(
      loginHint ? { prompt: "", login_hint: loginHint } : {}
    );
  }

  els.signinBtn.addEventListener("click", requestSignIn);

  // ---------- pick → check → confirm flow ----------

  let staged = [];        // Files waiting for the user to press "Upload"

  function handlePicked(fileList) {
    const media = [...fileList].filter(
      (f) => f.type.startsWith("image/") || f.type.startsWith("video/")
    );
    if (!media.length) return;
    if (!configured) {
      els.setupNotice.hidden = false;
      els.setupNotice.scrollIntoView({ behavior: "smooth" });
      return;
    }
    staged = staged.concat(media);
    renderTray();
    // bring the confirm tray front and center — especially when photos were
    // picked via the floating + button far from the upload section
    requestAnimationFrame(() => {
      els.tray.scrollIntoView({ behavior: "smooth", block: "center" });
      els.tray.classList.remove("is-pulsing");
      void els.tray.offsetWidth; // restart the animation
      els.tray.classList.add("is-pulsing");
    });
  }

  function renderTray() {
    els.trayGrid.innerHTML = "";
    if (!staged.length) {
      els.tray.hidden = true;
      return;
    }
    staged.forEach((file, i) => {
      const cell = document.createElement("div");
      cell.className = "tray-thumb";
      if (file.type.startsWith("image/")) {
        const img = document.createElement("img");
        img.alt = file.name;
        img.src = URL.createObjectURL(file);
        img.onload = () => URL.revokeObjectURL(img.src);
        cell.appendChild(img);
      } else {
        const v = document.createElement("span");
        v.className = "t-video";
        v.textContent = "▶";
        cell.appendChild(v);
      }
      const rm = document.createElement("button");
      rm.className = "tray-remove";
      rm.setAttribute("aria-label", "Remove " + file.name);
      rm.textContent = "×";
      rm.addEventListener("click", () => {
        staged.splice(i, 1);
        renderTray();
      });
      cell.appendChild(rm);
      els.trayGrid.appendChild(cell);
    });
    els.trayCount.textContent =
      "— " + staged.length + (staged.length === 1 ? " photo" : " photos");
    els.tray.hidden = false;
  }

  function confirmUpload() {
    if (!staged.length) return;
    if (needSignIn(confirmUpload)) return;
    const batch = staged.splice(0);
    renderTray();
    uploadFiles(batch);
  }

  els.trayUpload.addEventListener("click", confirmUpload);
  els.trayClear.addEventListener("click", () => {
    staged = [];
    renderTray();
  });

  els.fab.addEventListener("click", () => els.fileInput.click());
  els.dropzone.addEventListener("click", () => els.fileInput.click());
  els.dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); els.fileInput.click(); }
  });
  els.fileInput.addEventListener("change", () => {
    handlePicked(els.fileInput.files);
    els.fileInput.value = "";
  });

  ["dragenter", "dragover"].forEach((ev) =>
    els.dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      els.dropzone.classList.add("is-drag");
    })
  );
  ["dragleave", "drop"].forEach((ev) =>
    els.dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      els.dropzone.classList.remove("is-drag");
    })
  );
  els.dropzone.addEventListener("drop", (e) => handlePicked(e.dataTransfer.files));

  // ---------- upload ----------

  function uploadFiles(list) {
    let remaining = list.length;
    for (const file of list) {
      const li = document.createElement("li");
      li.className = "upload-item";
      li.innerHTML =
        '<span class="u-name"></span><span class="u-bar"><span class="u-bar-fill"></span></span>' +
        '<span class="u-status">0%</span>';
      li.querySelector(".u-name").textContent = file.name;
      els.uploadList.prepend(li);

      uploadOne(file, li).finally(() => {
        remaining--;
        if (remaining === 0) loadGallery(); // refresh once the batch is done
      });
    }
  }

  function uploadOne(file, li) {
    return new Promise((resolve) => {
      const fill = li.querySelector(".u-bar-fill");
      const status = li.querySelector(".u-status");

      const metadata = { name: file.name, parents: [cfg.FOLDER_ID] };
      const form = new FormData();
      form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
      form.append("file", file);

      const xhr = new XMLHttpRequest();
      xhr.open("POST",
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id");
      xhr.setRequestHeader("Authorization", "Bearer " + accessToken);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          fill.style.width = pct + "%";
          status.textContent = pct + "%";
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          li.classList.add("is-done");
          fill.style.width = "100%";
          status.textContent = "Done ✓";
          // tidy up after a moment so long batches don't pile up
          setTimeout(() => {
            li.classList.add("fade-out");
            setTimeout(() => li.remove(), 600);
          }, 3500);
        } else if (xhr.status === 401) {
          // token expired — ask again and let the user retry
          dropSession();
          li.classList.add("is-error");
          status.textContent = "Sign in";
          requestSignIn();
        } else {
          console.error("Upload failed", xhr.status, xhr.responseText);
          li.classList.add("is-error");
          status.textContent = "Failed";
        }
        resolve();
      };
      xhr.onerror = () => {
        li.classList.add("is-error");
        status.textContent = "Failed";
        resolve();
      };
      xhr.send(form);
    });
  }

  // ============================================================
  // boot
  // ============================================================

  if (!configured) els.setupNotice.hidden = false;
  if (configured) restoreSession(); // stay signed in across page reloads
  loadGallery();
  if (document.readyState === "complete") initAuth();
  else window.addEventListener("load", initAuth);
})();
