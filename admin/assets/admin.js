(function(){
  "use strict";

  const loginScreen = document.getElementById("login-screen");
  const dashboard = document.getElementById("dashboard");
  const pwInput = document.getElementById("pw-input");
  const loginBtn = document.getElementById("login-btn");
  const loginError = document.getElementById("login-error");
  const logoutBtn = document.getElementById("logout-btn");
  const syncBtn = document.getElementById("sync-btn");
  const syncStatus = document.getElementById("sync-status");
  const bizName = document.getElementById("biz-name");
  const bizEmail = document.getElementById("biz-email");
  const hoursPerDay = document.getElementById("hours-per-day");
  const bufferDays = document.getElementById("buffer-days");
  const saveSettingsBtn = document.getElementById("save-settings-btn");
  const settingsStatus = document.getElementById("settings-status");
  const smtpStatusLine = document.getElementById("smtp-status-line");
  const smtpTestBtn = document.getElementById("smtp-test-btn");
  const smtpTestStatus = document.getElementById("smtp-test-status");
  const eventModeToggle = document.getElementById("event-mode-toggle");
  const kioskModeToggle = document.getElementById("kiosk-mode-toggle");
  const kioskIdleMinutes = document.getElementById("kiosk-idle-minutes");
  const saveEventSettingsBtn = document.getElementById("save-event-settings-btn");
  const eventSettingsStatus = document.getElementById("event-settings-status");
  const quotesEmpty = document.getElementById("quotes-empty");
  const quotesTable = document.getElementById("quotes-table");
  const quoteRowsEl = document.getElementById("quote-rows");
  const rowsEl = document.getElementById("design-rows");
  const searchEl = document.getElementById("admin-search");

  let allDesigns = [];

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }

  async function checkSession(){
    const r = await fetch("/api/admin/session").then(r => r.json());
    if(r.isAdmin) showDashboard(); else showLogin();
  }

  function showLogin(){
    loginScreen.style.display = "flex";
    dashboard.style.display = "none";
  }
  async function showDashboard(){
    loginScreen.style.display = "none";
    dashboard.style.display = "block";
    await Promise.all([loadSettings(), loadDesigns(), loadSmtpStatus(), loadQuotes()]);
  }

  loginBtn.addEventListener("click", doLogin);
  pwInput.addEventListener("keydown", e => { if(e.key === "Enter") doLogin(); });

  async function doLogin(){
    loginError.textContent = "";
    loginBtn.disabled = true;
    try{
      const res = await fetch("/api/admin/login", {
        method: "POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ password: pwInput.value })
      });
      if(!res.ok){ loginError.textContent = "Wrong password."; loginBtn.disabled = false; return; }
      pwInput.value = "";
      await showDashboard();
    }catch(err){
      loginError.textContent = "Couldn't reach the server.";
    }finally{
      loginBtn.disabled = false;
    }
  }

  logoutBtn.addEventListener("click", async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    showLogin();
  });

  // ---- settings ----
  async function loadSettings(){
    const s = await fetch("/api/admin/settings").then(r => r.json());
    bizName.value = s.businessName || "";
    bizEmail.value = s.businessEmail || "";
    hoursPerDay.value = s.hoursPerDayCapacity != null ? s.hoursPerDayCapacity : 6;
    bufferDays.value = s.leadTimeBufferDays != null ? s.leadTimeBufferDays : 2;
    eventModeToggle.checked = !!s.eventModeEnabled;
    kioskModeToggle.checked = !!s.kioskModeEnabled;
    kioskIdleMinutes.value = s.kioskIdleMinutes != null ? s.kioskIdleMinutes : 2;
  }
  saveSettingsBtn.addEventListener("click", async () => {
    settingsStatus.textContent = "Saving…";
    try{
      const res = await fetch("/api/admin/settings", {
        method: "POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({
          businessName: bizName.value,
          businessEmail: bizEmail.value,
          hoursPerDayCapacity: hoursPerDay.value,
          leadTimeBufferDays: bufferDays.value
        })
      });
      if(!res.ok) throw new Error();
      settingsStatus.textContent = "Saved.";
      setTimeout(() => settingsStatus.textContent = "", 2000);
    }catch(err){
      settingsStatus.textContent = "Failed to save — check the lead time fields are valid numbers.";
    }
  });

  saveEventSettingsBtn.addEventListener("click", async () => {
    eventSettingsStatus.textContent = "Saving…";
    try{
      const res = await fetch("/api/admin/settings", {
        method: "POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({
          eventModeEnabled: eventModeToggle.checked,
          kioskModeEnabled: kioskModeToggle.checked,
          kioskIdleMinutes: kioskIdleMinutes.value
        })
      });
      if(!res.ok) throw new Error();
      eventSettingsStatus.textContent = "Saved.";
      setTimeout(() => eventSettingsStatus.textContent = "", 2000);
      loadDesigns(); // visible/featured filtering may have changed what matters to show
    }catch(err){
      eventSettingsStatus.textContent = "Failed to save — check idle minutes is a valid number.";
    }
  });

  // ---- SMTP status ----
  async function loadSmtpStatus(){
    try{
      const r = await fetch("/api/admin/smtp-status").then(r => r.json());
      smtpStatusLine.textContent = r.configured
        ? "SMTP is configured — customers can receive PDF quotes by email."
        : "SMTP is not configured — the storefront will fall back to a plain mailto link instead of emailing PDFs. Set SMTP_HOST / SMTP_USER / SMTP_PASS etc. in the environment.";
    }catch(err){
      smtpStatusLine.textContent = "Couldn't check SMTP status.";
    }
  }
  smtpTestBtn.addEventListener("click", async () => {
    smtpTestBtn.disabled = true;
    smtpTestStatus.textContent = "Testing…";
    try{
      const res = await fetch("/api/admin/smtp-test", { method: "POST" });
      const j = await res.json();
      smtpTestStatus.textContent = res.ok ? "Connected OK." : ("Failed: " + j.error);
    }catch(err){
      smtpTestStatus.textContent = "Failed: couldn't reach server.";
    }finally{
      smtpTestBtn.disabled = false;
    }
  });

  // ---- designs ----
  async function loadDesigns(){
    const r = await fetch("/api/admin/designs").then(r => r.json());
    allDesigns = r.data || [];
    renderRows();
  }

  searchEl.addEventListener("input", renderRows);

  function renderRows(){
    const q = searchEl.value.trim().toLowerCase();
    const list = q ? allDesigns.filter(d => (d.title||"").toLowerCase().includes(q) || d.slug.includes(q)) : allDesigns;
    rowsEl.innerHTML = "";
    const frag = document.createDocumentFragment();
    for(const d of list) frag.appendChild(buildRow(d));
    rowsEl.appendChild(frag);
  }

  function buildRow(d){
    const tr = document.createElement("tr");
    if(d.visible === false) tr.classList.add("hidden-row");

    const tdThumb = document.createElement("td");
    const img = document.createElement("img");
    img.className = "thumb"; img.src = d.image_url || ""; img.loading = "lazy";
    tdThumb.appendChild(img);
    tr.appendChild(tdThumb);

    const tdTitle = document.createElement("td");
    tdTitle.innerHTML = '<div class="t">' + escapeHtml(d.title) +
      '</div><div style="color:var(--text-faint);font-size:0.72rem;">' +
      escapeHtml(d.category || "") + (d.round != null ? " · round " + escapeHtml(String(d.round)) : "") +
      (d.purchase_only ? " · extra" : "") + '</div>';
    tr.appendChild(tdTitle);

    const tdPrice = document.createElement("td");
    const priceInput = document.createElement("input");
    priceInput.type = "number"; priceInput.min = "0"; priceInput.step = "0.01"; priceInput.className = "price";
    priceInput.placeholder = "—";
    priceInput.value = d.price_cents != null ? (d.price_cents / 100).toFixed(2) : "";
    tdPrice.appendChild(priceInput);
    tr.appendChild(tdPrice);

    const tdUrl = document.createElement("td");
    const urlInput = document.createElement("input");
    urlInput.type = "text"; urlInput.placeholder = "https://yourshop.com/…";
    urlInput.value = d.shop_url || "";
    tdUrl.appendChild(urlInput);
    tr.appendChild(tdUrl);

    const tdVisible = document.createElement("td");
    const visCheck = document.createElement("input");
    visCheck.type = "checkbox"; visCheck.checked = d.visible !== false;
    tdVisible.appendChild(visCheck);
    tr.appendChild(tdVisible);

    const tdFeatured = document.createElement("td");
    const featCheck = document.createElement("input");
    featCheck.type = "checkbox"; featCheck.checked = !!d.featured;
    tdFeatured.appendChild(featCheck);
    tr.appendChild(tdFeatured);

    const tdSave = document.createElement("td");
    const saveBtn = document.createElement("button");
    saveBtn.className = "btn small row-save"; saveBtn.textContent = "Save";
    const status = document.createElement("span");
    status.className = "row-status";
    saveBtn.addEventListener("click", async () => {
      saveBtn.disabled = true;
      status.textContent = "Saving…";
      try{
        const res = await fetch("/api/admin/designs/" + encodeURIComponent(d.slug), {
          method: "POST", headers: {"Content-Type":"application/json"},
          body: JSON.stringify({
            price: priceInput.value === "" ? "" : priceInput.value,
            shop_url: urlInput.value.trim(),
            visible: visCheck.checked,
            featured: featCheck.checked
          })
        });
        if(!res.ok) throw new Error();
        const saved = (await res.json()).data;
        Object.assign(d, saved);
        tr.classList.toggle("hidden-row", d.visible === false);
        status.textContent = "Saved";
        setTimeout(() => status.textContent = "", 1500);
      }catch(err){
        status.textContent = "Failed";
      }finally{
        saveBtn.disabled = false;
      }
    });
    tdSave.appendChild(saveBtn);
    tdSave.appendChild(status);
    tr.appendChild(tdSave);

    return tr;
  }

  // ---- quote request log ----
  async function loadQuotes(){
    try{
      const r = await fetch("/api/admin/quotes").then(r => r.json());
      const rows = r.data || [];
      quotesEmpty.style.display = rows.length ? "none" : "block";
      quotesTable.style.display = rows.length ? "table" : "none";
      quoteRowsEl.innerHTML = "";
      const frag = document.createDocumentFragment();
      for(const q of rows) frag.appendChild(buildQuoteRow(q));
      quoteRowsEl.appendChild(frag);
    }catch(err){
      quotesEmpty.style.display = "block";
      quotesEmpty.textContent = "Couldn't load quote requests.";
    }
  }

  function buildQuoteRow(q){
    const tr = document.createElement("tr");
    const date = new Date(q.createdAt);
    const dateStr = isNaN(date) ? q.createdAt : date.toLocaleString([], { month:"short", day:"numeric", hour:"numeric", minute:"2-digit" });
    const itemTitles = (q.items || []).map(i => i.title).join(", ");
    const cost = q.totalCents != null ? "$" + (q.totalCents/100).toFixed(2) : "—";
    const lead = q.leadTimeLow != null ? q.leadTimeLow + "–" + q.leadTimeHigh + "d" : "—";
    const statusColor = q.status === "sent" ? "var(--teal)" : "var(--red)";

    tr.innerHTML =
      '<td>' + escapeHtml(dateStr) + '</td>' +
      '<td>' + escapeHtml(q.customerName || "—") + '<div style="color:var(--text-faint);font-size:0.72rem;">' + escapeHtml(q.customerEmail || "") + '</div></td>' +
      '<td style="max-width:220px;">' + escapeHtml(itemTitles) + '</td>' +
      '<td>' + escapeHtml(cost) + '</td>' +
      '<td>' + escapeHtml(lead) + '</td>' +
      '<td style="color:' + statusColor + ';">' + escapeHtml(q.status || "") + '</td>';
    return tr;
  }

  // ---- sync ----
  syncBtn.addEventListener("click", async () => {
    syncBtn.disabled = true;
    syncStatus.textContent = "Syncing from N3D — this can take a moment…";
    try{
      const res = await fetch("/api/admin/sync", {
        method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ full: false })
      });
      const j = await res.json();
      if(!res.ok) throw new Error(j.error || "sync failed");
      syncStatus.textContent = "Done — " + j.added + " new, " + j.updated + " updated.";
      await loadDesigns();
    }catch(err){
      syncStatus.textContent = "Sync failed: " + err.message;
    }finally{
      syncBtn.disabled = false;
    }
  });

  checkSession();
})();
