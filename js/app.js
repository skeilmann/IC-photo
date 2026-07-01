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
    "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.profile";

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
  let tokenClient = null;
  let userName = null;

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
      "nextPageToken,files(id,name,mimeType,createdTime,thumbnailLink," +
      "imageMediaMetadata(time,width,height),videoMediaMetadata(durationMillis)," +
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

    files = out.filter(
      (f) => f.mimeType.startsWith("image/") || f.mimeType.startsWith("video/")
    );

    updateStats();
    populateFilters();
    renderGallery();
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
    if (els.fType.value) list = list.filter((f) => f.mimeType.startsWith(els.fType.value + "/"));
    if (els.fDay.value) list = list.filter((f) => dayKey(f) === els.fDay.value);
    if (els.fPerson.value) list = list.filter((f) => fileOwner(f) === els.fPerson.value);
    const dir = els.fSort.value === "old" ? 1 : -1;
    return [...list].sort((a, b) => dir * (fileDate(a) - fileDate(b)));
  }

  function updateToolbarState() {
    let any = false;
    for (const sel of [els.fDay, els.fPerson, els.fType]) {
      sel.classList.toggle("is-set", !!sel.value);
      if (sel.value) any = true;
    }
    els.fReset.hidden = !any;
  }

  [els.fSort, els.fDay, els.fPerson, els.fType].forEach((sel) =>
    sel.addEventListener("change", () => {
      updateToolbarState();
      renderGallery();
    })
  );

  els.fReset.addEventListener("click", () => {
    els.fDay.value = els.fPerson.value = els.fType.value = "";
    updateToolbarState();
    renderGallery();
  });

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
        img.src = f.thumbnailLink
          ? f.thumbnailLink.replace(/=s\d+$/, "=s640")
          : thumbUrl(f, 640);
        img.onerror = () => { img.onerror = null; img.src = thumbUrl(f, 640); };
        fig.appendChild(img);

        if (f.mimeType.startsWith("video/")) {
          const badge = document.createElement("span");
          badge.className = "badge-video";
          badge.textContent = "VIDEO";
          fig.appendChild(badge);
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
      const img = document.createElement("img");
      img.src = thumbUrl(f, 2000);
      img.alt = f.name;
      els.lbStage.appendChild(img);
    }
    els.lbCaption.textContent =
      fileOwner(f) + " · " +
      fileDate(f).toLocaleString("en-GB", {
        weekday: "short", day: "numeric", month: "long",
        hour: "2-digit", minute: "2-digit",
      }) + " · " + (lbIndex + 1) + " / " + flatOrder.length;
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
    els.signinBtn.hidden = false;
  }

  async function onToken(resp) {
    if (resp.error) {
      console.error(resp);
      return;
    }
    accessToken = resp.access_token;
    try {
      const r = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: "Bearer " + accessToken },
      });
      const info = await r.json();
      userName = info.name || info.given_name || "you";
    } catch { userName = "you"; }

    els.signinBtn.hidden = true;
    els.userChip.textContent = "📷 " + userName;
    els.userChip.hidden = false;
    els.dzTitle.textContent = "Choose photos, " + userName.split(" ")[0];

    // If sign-in was triggered by the Upload button, continue now
    if (pendingUpload) {
      pendingUpload = false;
      confirmUpload();
    }
  }

  function requestSignIn() {
    if (!tokenClient) return;
    tokenClient.requestAccessToken();
  }

  els.signinBtn.addEventListener("click", requestSignIn);

  // ---------- pick → check → confirm flow ----------

  let staged = [];        // Files waiting for the user to press "Upload"
  let pendingUpload = false;

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
    els.tray.scrollIntoView({ behavior: "smooth", block: "nearest" });
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
    if (!accessToken) {
      pendingUpload = true;
      requestSignIn();
      return;
    }
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
        } else if (xhr.status === 401) {
          // token expired — ask again and let the user retry
          accessToken = null;
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
  loadGallery();
  if (document.readyState === "complete") initAuth();
  else window.addEventListener("load", initAuth);
})();
