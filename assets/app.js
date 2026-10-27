/* global crypto, Blob, URL */
(function () {
  "use strict";

  const STORAGE_KEY = "qiuzhao-tracker:v1";
  const VIEW_KEY = "qiuzhao-tracker:view";

  const STATUSES = [
    { key: "applied", label: "已投递", color: "#b56a4a" },
    { key: "screening", label: "筛选中", color: "#a47d2e" },
    { key: "written", label: "笔试", color: "#557da2" },
    { key: "interview", label: "面试中", color: "#77699b" },
    { key: "offer", label: "已获 Offer", color: "#547c5e" },
    { key: "rejected", label: "未通过", color: "#8f877a" }
  ];

  const STATUS_MAP = Object.fromEntries(STATUSES.map((status) => [status.key, status]));
  const CHANNELS = ["官网投递", "内推", "招聘平台", "校园宣讲", "其他"];
  const ACTIVE_STATUSES = new Set(["applied", "screening", "written", "interview"]);
  const ADVANCED_STATUSES = new Set(["screening", "written", "interview", "offer"]);
  const LOGO_PALETTES = [
    { bg: "#ebe3d2", ink: "#65553d" },
    { bg: "#f2dfd4", ink: "#8b4e39" },
    { bg: "#dfe8e1", ink: "#4d6854" },
    { bg: "#e0e7ef", ink: "#4c6582" },
    { bg: "#eae2ee", ink: "#685a7b" },
    { bg: "#f0e7ce", ink: "#7c6532" },
    { bg: "#e8e2d6", ink: "#5b5549" }
  ];

  const refs = {
    applicationDialog: document.getElementById("application-dialog"),
    applicationForm: document.getElementById("application-form"),
    confirmDialog: document.getElementById("confirm-dialog"),
    confirmMessage: document.getElementById("confirm-message"),
    dialogTitle: document.getElementById("dialog-title"),
    dialogKicker: document.getElementById("dialog-kicker"),
    deleteButton: document.getElementById("delete-application"),
    saveButton: document.getElementById("save-application"),
    notes: document.getElementById("field-notes"),
    notesCount: document.getElementById("notes-count"),
    search: document.getElementById("search-input"),
    listView: document.getElementById("list-view"),
    boardView: document.getElementById("board-view"),
    applicationList: document.getElementById("application-list"),
    tableHead: document.getElementById("table-head"),
    filterRow: document.getElementById("filter-row"),
    trackerPanel: document.querySelector(".tracker-panel"),
    listCount: document.getElementById("list-count"),
    dataMenuButton: document.getElementById("data-menu-btn"),
    dataMenu: document.getElementById("data-menu"),
    importFile: document.getElementById("import-file"),
    toastRegion: document.getElementById("toast-region"),
    progressRing: document.getElementById("progress-ring"),
    seasonYear: document.getElementById("season-year"),
    seasonLabel: document.getElementById("season-label")
  };

  const state = {
    applications: [],
    filter: "all",
    search: "",
    view: "list",
    editingId: null,
    pendingDeleteId: null,
    storageWarningShown: false
  };

  /* ---------- Utilities ---------- */

  const HTML_ENTITIES = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  };

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (char) => HTML_ENTITIES[char]);
  }

  function cleanText(value, maxLength) {
    if (value == null) return "";
    return String(value).replace(/\s+/g, " ").trim().slice(0, maxLength);
  }

  function cleanNotes(value) {
    if (value == null) return "";
    return String(value)
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
      .slice(0, 200);
  }

  function uid() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return "app-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
  }

  function todayIso() {
    const now = new Date();
    return [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0")
    ].join("-");
  }

  function isValidIsoDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return (
      date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day
    );
  }

  function dateFromIso(value) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function formatShortDate(value) {
    if (!isValidIsoDate(value)) return "—";
    const [year, month, day] = value.split("-");
    return year + "." + month + "." + day;
  }

  function formatFullDate(value) {
    if (!isValidIsoDate(value)) return "日期未知";
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "long",
      day: "numeric"
    }).format(dateFromIso(value));
  }

  function formatRelativeDate(value) {
    if (!isValidIsoDate(value)) return "";
    const today = startOfDay(new Date());
    const target = startOfDay(dateFromIso(value));
    const diff = Math.round((today - target) / 86400000);
    if (diff === 0) return "今天";
    if (diff === 1) return "昨天";
    if (diff > 1 && diff < 30) return diff + " 天前";
    if (diff < 0) return Math.abs(diff) + " 天后";
    if (diff < 365) {
      return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(target);
    }
    return Math.floor(diff / 365) + " 年前";
  }

  function getStatus(key) {
    return STATUS_MAP[key] || STATUS_MAP.applied;
  }

  function getCompanyLetter(company) {
    const value = String(company || "").trim();
    if (!value) return "·";
    const first = Array.from(value)[0];
    return /[a-zA-Z0-9]/.test(first) ? first.toUpperCase() : first;
  }

  function getCompanyPalette(company) {
    let hash = 0;
    const value = String(company || "");
    for (let index = 0; index < value.length; index += 1) {
      hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
    }
    return LOGO_PALETTES[hash % LOGO_PALETTES.length];
  }

  function logoStyle(company) {
    const palette = getCompanyPalette(company);
    return "--logo-bg:" + palette.bg + ";--logo-ink:" + palette.ink + ";";
  }

  function relativeInitials(company) {
    return escapeHtml(getCompanyLetter(company));
  }

  /* ---------- Data ---------- */

  function normalizeApplication(raw) {
    if (!raw || typeof raw !== "object") return null;
    const company = cleanText(raw.company, 60);
    const position = cleanText(raw.position, 80);
    if (!company || !position) return null;

    const appliedAt = isValidIsoDate(raw.appliedAt) ? raw.appliedAt : todayIso();
    const status = STATUS_MAP[raw.status] ? raw.status : "applied";
    const channel = CHANNELS.includes(raw.channel) ? raw.channel : "官网投递";
    const createdAt = !Number.isNaN(Date.parse(raw.createdAt))
      ? new Date(raw.createdAt).toISOString()
      : new Date().toISOString();
    const updatedAt = !Number.isNaN(Date.parse(raw.updatedAt))
      ? new Date(raw.updatedAt).toISOString()
      : createdAt;

    return {
      id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim().slice(0, 80) : uid(),
      company,
      position,
      appliedAt,
      status,
      channel,
      location: cleanText(raw.location, 40),
      notes: cleanNotes(raw.notes),
      createdAt,
      updatedAt
    };
  }

  function dedupeIds(applications) {
    const seen = new Set();
    return applications.map((application) => {
      if (seen.has(application.id)) {
        return Object.assign({}, application, { id: uid() });
      }
      seen.add(application.id);
      return application;
    });
  }

  function loadApplications() {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (!stored) return [];
      const parsed = JSON.parse(stored);
      const list = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.applications) ? parsed.applications : [];
      return dedupeIds(list.map(normalizeApplication).filter(Boolean));
    } catch (error) {
      return [];
    }
  }

  function saveApplications() {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          version: 1,
          updatedAt: new Date().toISOString(),
          applications: state.applications
        })
      );
      return true;
    } catch (error) {
      if (!state.storageWarningShown) {
        state.storageWarningShown = true;
        showToast("浏览器本地存储不可用，记录可能无法保留。", "error");
      }
      return false;
    }
  }

  function sortApplications(applications) {
    return applications.slice().sort((first, second) => {
      const dateCompare = second.appliedAt.localeCompare(first.appliedAt);
      if (dateCompare !== 0) return dateCompare;
      return String(second.createdAt).localeCompare(String(first.createdAt));
    });
  }

  function getFilteredApplications() {
    const query = state.search.trim().toLowerCase();
    return sortApplications(
      state.applications.filter((application) => {
        if (state.filter !== "all" && application.status !== state.filter) return false;
        if (!query) return true;
        return [
          application.company,
          application.position,
          application.location,
          application.channel,
          application.notes,
          getStatus(application.status).label
        ]
          .join(" ")
          .toLowerCase()
          .includes(query);
      })
    );
  }

  function getStatusCounts() {
    const counts = { all: state.applications.length };
    STATUSES.forEach((status) => {
      counts[status.key] = 0;
    });
    state.applications.forEach((application) => {
      counts[application.status] = (counts[application.status] || 0) + 1;
    });
    return counts;
  }

  function getThisWeekCount() {
    const today = startOfDay(new Date());
    const weekday = (today.getDay() + 6) % 7;
    const monday = new Date(today);
    monday.setDate(today.getDate() - weekday);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return state.applications.filter((application) => {
      if (!isValidIsoDate(application.appliedAt)) return false;
      const date = startOfDay(dateFromIso(application.appliedAt));
      return date >= monday && date <= sunday;
    }).length;
  }

  function getLatestApplication() {
    return sortApplications(state.applications)[0] || null;
  }

  /* ---------- Dashboard ---------- */

  function renderDashboard() {
    const applications = state.applications;
    const total = applications.length;
    const active = applications.filter((application) => ACTIVE_STATUSES.has(application.status)).length;
    const waiting = applications.filter(
      (application) => application.status === "applied" || application.status === "screening"
    ).length;
    const written = applications.filter((application) => application.status === "written").length;
    const interview = applications.filter((application) => application.status === "interview").length;
    const offers = applications.filter((application) => application.status === "offer").length;
    const advanced = applications.filter((application) => ADVANCED_STATUSES.has(application.status)).length;
    const companies = new Set(applications.map((application) => application.company)).size;
    const progress = total ? Math.round((advanced / total) * 100) : 0;
    const offerRate = total ? Math.round((offers / total) * 100) : 0;
    const thisWeek = getThisWeekCount();
    const latest = getLatestApplication();
    const now = new Date();
    const year = now.getFullYear();

    refs.seasonYear.textContent = String(year);
    refs.seasonLabel.textContent = year + " AUTUMN RECRUITMENT";

    document.getElementById("hero-total").textContent = String(total);
    document.getElementById("hero-waiting").textContent = String(waiting);
    document.getElementById("hero-week").textContent = "+" + thisWeek;
    document.getElementById("progress-value").innerHTML = progress + "<span>%</span>";
    refs.progressRing.style.setProperty("--progress", String(progress));
    refs.progressRing.setAttribute("aria-label", "投递推进率 " + progress + "%");

    document.getElementById("latest-application").textContent = latest
      ? "最近投递：" + latest.company + " · " + latest.position
      : "最近投递：暂无记录";

    document.getElementById("stat-total").textContent = String(total);
    document.getElementById("stat-active").textContent = String(active);
    document.getElementById("stat-interview").textContent = String(written + interview + offers);
    document.getElementById("stat-offer").textContent = String(offers);

    document.getElementById("stat-total-foot").textContent = total
      ? "覆盖 " + companies + " 家企业"
      : "等待第一份记录";
    document.getElementById("stat-active-foot").textContent = total
      ? waiting + " 个等待回音"
      : "等待回音或进行中";
    document.getElementById("stat-interview-foot").textContent = total
      ? "笔试 " + written + " · 面试 " + interview
      : "笔试与面试机会";
    document.getElementById("stat-offer-foot").textContent = "Offer 转化率 " + offerRate + "%";

    const caption = document.getElementById("overview-caption");
    if (total === 0) {
      caption.textContent = "从第一份投递开始，慢慢积累。";
    } else if (offers > 0) {
      caption.textContent = "已有 " + offers + " 个 Offer 落袋，继续按自己的节奏来。";
    } else if (written + interview > 0) {
      caption.textContent = "已进入 " + (written + interview) + " 次笔面，记得留一点时间给自己。";
    } else {
      caption.textContent = "已经记录 " + total + " 次投递，静候回音。";
    }
  }

  /* ---------- Filters ---------- */

  function renderFilters() {
    if (!refs.filterRow) return;
    const counts = getStatusCounts();
    const chips = [
      '<button type="button" class="filter-chip' + (state.filter === "all" ? " is-active" : "") + '" data-filter="all" aria-pressed="' + (state.filter === 'all') + '">',
      '<span class="chip-dot" style="--chip-color:#201e19"></span>',
      "全部",
      '<span class="chip-count">' + counts.all + "</span>",
      "</button>"
    ];

    STATUSES.forEach((status) => {
      chips.push(
        '<button type="button" class="filter-chip' +
          (state.filter === status.key ? " is-active" : "") +
          '" data-filter="' +
          status.key +
          '" aria-pressed="' + (state.filter === status.key) + '">' +
          '<span class="chip-dot" style="--chip-color:' +
          status.color +
          '"></span>' +
          escapeHtml(status.label) +
          '<span class="chip-count">' +
          (counts[status.key] || 0) +
          "</span></button>"
      );
    });

    refs.filterRow.innerHTML = chips.join("");
  }

  /* ---------- Empty states ---------- */

  function emptyIllustration() {
    return [
      '<svg class="empty-il" viewBox="0 0 160 122" fill="none" aria-hidden="true">',
      '<path class="il-paper" d="M34 18h68l25 25v64a5 5 0 0 1-5 5H34a5 5 0 0 1-5-5V23a5 5 0 0 1 5-5Z"/>',
      '<path class="il-line" d="M101 18v20a5 5 0 0 0 5 5h20"/>',
      '<path class="il-line" d="M47 54h52M47 64h38M47 82h29"/>',
      '<path class="il-accent" d="M47 44h21"/>',
      '<circle cx="108" cy="87" r="15" stroke="#c24e35" stroke-width="1.2" opacity=".52"/>',
      '<path class="il-accent" d="m101 87 5 5 9-10" opacity=".8"/>',
      '<path class="il-tick" d="M28 35v-8h8M132 35v-8h-8M28 94v8h8M132 94v8h-8" opacity=".55"/>',
      '<circle class="il-fill" cx="22" cy="63" r="2.2" opacity=".55"/>',
      '<circle class="il-fill" cx="141" cy="53" r="1.6" opacity=".4"/>',
      "</svg>"
    ].join("");
  }

  function searchIllustration() {
    return [
      '<svg class="empty-il" viewBox="0 0 160 122" fill="none" aria-hidden="true">',
      '<path class="il-paper" d="M30 16h69l24 24v50a5 5 0 0 1-5 5H30a5 5 0 0 1-5-5V21a5 5 0 0 1 5-5Z"/>',
      '<path class="il-line" d="M96 16v19a5 5 0 0 0 5 5h19"/>',
      '<path class="il-line" d="M41 48h49M41 58h33M41 74h24"/>',
      '<circle cx="111" cy="80" r="19" stroke="#9b9486" stroke-width="1.5"/>',
      '<path d="m125 94 12 12" stroke="#9b9486" stroke-width="1.8"/>',
      '<path class="il-accent" d="M103 80h16" opacity=".7"/>',
      "</svg>"
    ].join("");
  }

  function renderEmptyState(total, visible) {
    if (total === 0) {
      return [
        '<div class="empty-state">',
        '<div class="empty-illustration">' + emptyIllustration() + "</div>",
        "<h3>第一份投递，从这里开始</h3>",
        "<p>把企业、岗位和投递时间写下来。之后每一次状态变化，都可以随手更新。</p>",
        '<button type="button" class="btn btn-primary" data-open-add>',
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
        "记录第一次投递</button>",
        "</div>"
      ].join("");
    }

    if (visible === 0) {
      return [
        '<div class="empty-state">',
        '<div class="empty-illustration">' + searchIllustration() + "</div>",
        "<h3>没有找到匹配的记录</h3>",
        "<p>换个关键词，或者清除筛选条件再看看。也许那份投递只是在和你捉迷藏。</p>",
        '<button type="button" class="empty-reset" data-action="clear-filters">清除筛选条件</button>',
        "</div>"
      ].join("");
    }

    return "";
  }

  /* ---------- List ---------- */

  function statusSelectMarkup(application) {
    const status = getStatus(application.status);
    const options = STATUSES.map(
      (item) =>
        '<option value="' +
        item.key +
        '"' +
        (item.key === application.status ? " selected" : "") +
        ">" +
        escapeHtml(item.label) +
        "</option>"
    ).join("");
    return [
      '<label class="status-select status-' + status.key + '">',
      '<select data-action="status" data-id="' + escapeHtml(application.id) + '" aria-label="更新 ' +
        escapeHtml(application.company) + " " + escapeHtml(application.position) + ' 的投递状态">',
      options,
      "</select>",
      "</label>"
    ].join("");
  }

  function listRowMarkup(application) {
    const status = getStatus(application.status);
    const noteHint = application.notes
      ? '<span class="note-hint" title="' + escapeHtml(application.notes) + '" aria-label="有备注">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v12H9l-4 4V4Z"/><path d="M9 8h6M9 12h4"/></svg></span>'
      : "";
    const location = application.location
      ? '<span class="meta-separator">·</span><span>' + escapeHtml(application.location) + "</span>"
      : "";

    return [
      '<article class="app-row status-' + status.key + '" data-id="' + escapeHtml(application.id) + '">',
      '  <div class="company-cell">',
      '    <div class="company-logo" style="' + logoStyle(application.company) + '" aria-hidden="true">' +
        relativeInitials(application.company) + "</div>",
      '    <div class="company-info">',
      '      <h3 title="' + escapeHtml(application.company) + '">' + escapeHtml(application.company) + "</h3>",
      '      <p class="position-line"><span title="' + escapeHtml(application.position) + '">' +
        escapeHtml(application.position) + "</span>" + location + noteHint + "</p>",
      "    </div>",
      "  </div>",
      '  <div class="date-cell" title="' + escapeHtml(formatFullDate(application.appliedAt)) + '">',
      "    <strong>" + formatShortDate(application.appliedAt) + "</strong>",
      "    <small>" + formatRelativeDate(application.appliedAt) + "</small>",
      "  </div>",
      '  <div class="channel-cell"><span class="channel-tag">' + escapeHtml(application.channel) + "</span></div>",
      '  <div class="status-cell">' + statusSelectMarkup(application) + "</div>",
      '  <div class="action-cell">',
      '    <button type="button" class="row-edit" data-action="edit" title="编辑记录" aria-label="编辑 ' +
        escapeHtml(application.company) + " " + escapeHtml(application.position) + ' 的投递记录">',
      '      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 4.3-1L20 7.3a2.1 2.1 0 0 0-3-3L5.3 16 4 20Z"/><path d="m14.5 6.5 3 3"/></svg>',
      "    </button>",
      "  </div>",
      "</article>"
    ].join("");
  }

  function renderList(filtered) {
    const total = state.applications.length;
    if (filtered.length === 0) {
      refs.applicationList.innerHTML = renderEmptyState(total, 0);
      refs.listView.classList.add("is-empty");
      return;
    }
    refs.listView.classList.remove("is-empty");
    refs.applicationList.innerHTML = filtered.map(listRowMarkup).join("");
  }

  /* ---------- Board ---------- */

  function boardCardMarkup(application) {
    const notes = application.notes
      ? '<p class="board-notes">' + escapeHtml(application.notes) + "</p>"
      : "";
    return [
      '<article class="board-card" draggable="true" data-id="' + escapeHtml(application.id) + '"',
      ' tabindex="0" role="button" aria-label="编辑 ' + escapeHtml(application.company) + " " +
        escapeHtml(application.position) + ' 的投递记录">',
      '  <div class="board-card-top">',
      '    <div class="board-logo" style="' + logoStyle(application.company) + '" aria-hidden="true">' +
        relativeInitials(application.company) + "</div>",
      '    <span class="board-company">' + escapeHtml(application.company) + "</span>",
      "  </div>",
      '  <p class="board-position">' + escapeHtml(application.position) + "</p>",
      notes,
      '  <div class="board-card-foot">',
      "    <span>" + formatShortDate(application.appliedAt) + "</span>",
      '    <span class="board-channel">' + escapeHtml(application.channel) + "</span>",
      "  </div>",
      "</article>"
    ].join("");
  }

  function renderBoard(filtered) {
    refs.boardView.innerHTML = STATUSES.map((status) => {
      const cards = filtered.filter((application) => application.status === status.key);
      const body = cards.length
        ? cards.map(boardCardMarkup).join("")
        : '<div class="board-empty">拖到这里，或手动添加</div>';
      return [
        '<section class="board-column status-' + status.key + '" data-status="' + status.key + '" aria-label="' +
          escapeHtml(status.label) + '">',
        '  <header class="board-column-head">',
        '    <span class="board-dot" aria-hidden="true"></span>',
        '    <div class="board-column-title"><h3>' + escapeHtml(status.label) + "</h3>",
        '      <span class="board-count">' + cards.length + "</span></div>",
        '    <button type="button" class="board-add" data-action="board-add" data-status="' + status.key +
          '" aria-label="在此状态新增投递" title="新增投递">',
        '      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
        "    </button>",
        "  </header>",
        '  <div class="board-column-body">' + body + "</div>",
        "</section>"
      ].join("");
    }).join("");
  }

  /* ---------- Render ---------- */

  function render() {
    const filtered = getFilteredApplications();
    renderDashboard();
    renderFilters();

    refs.listCount.textContent = String(state.applications.length ? filtered.length : 0);
    refs.listCount.setAttribute(
      "aria-label",
      state.applications.length ? "当前显示 " + filtered.length + " 条记录" : "暂无记录"
    );

    const isEmpty = state.applications.length === 0;
    refs.trackerPanel.classList.toggle("is-empty", isEmpty);

    const showList = state.view === "list";
    refs.listView.hidden = !showList;
    refs.boardView.hidden = showList;

    if (showList) {
      renderList(filtered);
    } else {
      renderBoard(filtered);
      refs.listView.classList.remove("is-empty");
    }

    document.querySelectorAll("[data-view]").forEach((button) => {
      const active = button.getAttribute("data-view") === state.view;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  /* ---------- Dialog ---------- */

  function clearFormErrors() {
    refs.applicationForm.querySelectorAll(".field.has-error").forEach((field) => {
      field.classList.remove("has-error");
    });
    refs.applicationForm.querySelectorAll(".field-error").forEach((error) => {
      error.textContent = "";
    });
    refs.applicationForm.querySelectorAll("[aria-invalid]").forEach((input) => {
      input.removeAttribute("aria-invalid");
      input.removeAttribute("aria-describedby");
    });
  }

  function setFieldError(name, message) {
    const input = refs.applicationForm.elements[name];
    if (!input) return;
    const field = input.closest(".field");
    const error = refs.applicationForm.querySelector('[data-error-for="' + name + '"]');
    if (field) field.classList.add("has-error");
    if (error) {
      if (!error.id) error.id = "field-" + name + "-error";
      error.textContent = message;
      input.setAttribute("aria-invalid", "true");
      input.setAttribute("aria-describedby", error.id);
    }
  }

  function fillSelect(select, values) {
    select.innerHTML = values
      .map((item) => '<option value="' + item.value + '">' + escapeHtml(item.label) + "</option>")
      .join("");
  }

  function initFormOptions() {
    const statusSelect = document.getElementById("field-status");
    const channelSelect = document.getElementById("field-channel");
    fillSelect(
      statusSelect,
      STATUSES.map((status) => ({ value: status.key, label: status.label }))
    );
    fillSelect(
      channelSelect,
      CHANNELS.map((channel) => ({ value: channel, label: channel }))
    );
  }

  function openApplicationDialog(options) {
    const settings = options || {};
    const application = settings.application || null;
    const presetStatus = STATUS_MAP[settings.status] ? settings.status : "applied";
    const form = refs.applicationForm;

    form.reset();
    clearFormErrors();
    state.editingId = application ? application.id : null;

    refs.dialogTitle.textContent = application ? "编辑投递记录" : "记录一次投递";
    refs.dialogKicker.textContent = application ? "EDIT APPLICATION" : "NEW APPLICATION";
    refs.saveButton.textContent = application ? "保存修改" : "保存投递";
    refs.deleteButton.hidden = !application;

    if (application) {
      form.elements.company.value = application.company;
      form.elements.position.value = application.position;
      form.elements.appliedAt.value = application.appliedAt;
      form.elements.status.value = application.status;
      form.elements.channel.value = application.channel;
      form.elements.location.value = application.location;
      form.elements.notes.value = application.notes;
    } else {
      form.elements.appliedAt.value = todayIso();
      form.elements.status.value = presetStatus;
      form.elements.channel.value = "官网投递";
    }

    refs.notesCount.textContent = String(form.elements.notes.value.length);

    if (typeof refs.applicationDialog.showModal === "function") {
      refs.applicationDialog.showModal();
    } else {
      refs.applicationDialog.setAttribute("open", "");
    }
    document.body.classList.add("is-dialog-open");

    window.setTimeout(() => {
      form.elements.company.focus();
      form.elements.company.select();
    }, 40);
  }

  function closeApplicationDialog() {
    if (refs.applicationDialog.open) {
      refs.applicationDialog.close();
    } else {
      refs.applicationDialog.removeAttribute("open");
    }
  }

  function collectFormValues() {
    const form = refs.applicationForm;
    return {
      company: cleanText(form.elements.company.value, 60),
      position: cleanText(form.elements.position.value, 80),
      appliedAt: form.elements.appliedAt.value,
      status: form.elements.status.value,
      channel: form.elements.channel.value,
      location: cleanText(form.elements.location.value, 40),
      notes: cleanNotes(form.elements.notes.value)
    };
  }

  function validateForm(values) {
    clearFormErrors();
    let firstInvalid = null;
    const errors = [];

    if (!values.company) {
      errors.push(["company", "请填写企业名称"]);
    }
    if (!values.position) {
      errors.push(["position", "请填写投递岗位"]);
    }
    if (!values.appliedAt) {
      errors.push(["appliedAt", "请选择投递时间"]);
    } else if (!isValidIsoDate(values.appliedAt)) {
      errors.push(["appliedAt", "投递时间格式有误"]);
    }
    if (!STATUS_MAP[values.status]) {
      errors.push(["status", "请选择当前状态"]);
    }

    errors.forEach((error) => {
      setFieldError(error[0], error[1]);
      if (!firstInvalid) firstInvalid = refs.applicationForm.elements[error[0]];
    });

    if (firstInvalid) {
      firstInvalid.focus();
      return false;
    }
    return true;
  }

  function ensureSavedApplicationVisible(application) {
    const search = state.search.trim().toLowerCase();
    const searchMatches =
      !search ||
      [
        application.company,
        application.position,
        application.location,
        application.channel,
        application.notes
      ]
        .join(" ")
        .toLowerCase()
        .includes(search);
    if (!searchMatches) {
      state.search = "";
      refs.search.value = "";
    }
    if (state.filter !== "all" && state.filter !== application.status) {
      state.filter = "all";
    }
  }

  function handleFormSubmit(event) {
    event.preventDefault();
    const values = collectFormValues();
    if (!validateForm(values)) return;

    const now = new Date().toISOString();
    const existing = state.editingId
      ? state.applications.find((application) => application.id === state.editingId)
      : null;

    let application;
    if (existing) {
      application = Object.assign({}, existing, values, { updatedAt: now });
      state.applications = state.applications.map((item) =>
        item.id === existing.id ? application : item
      );
    } else {
      application = Object.assign({}, values, {
        id: uid(),
        createdAt: now,
        updatedAt: now
      });
      state.applications.push(application);
      ensureSavedApplicationVisible(application);
    }

    saveApplications();
    closeApplicationDialog();
    render();
    showToast(existing ? "投递记录已更新" : "已记录「" + application.company + "」的投递");
  }

  function openDeleteConfirm(applicationId) {
    const application = state.applications.find((item) => item.id === applicationId);
    if (!application) return;
    state.pendingDeleteId = applicationId;
    refs.confirmMessage.textContent =
      "「" + application.company + " · " + application.position + "」删除后无法恢复。";
    if (typeof refs.confirmDialog.showModal === "function") {
      refs.confirmDialog.showModal();
    } else {
      refs.confirmDialog.setAttribute("open", "");
    }
    document.body.classList.add("is-dialog-open");
  }

  function closeConfirmDialog() {
    state.pendingDeleteId = null;
    if (refs.confirmDialog.open) {
      refs.confirmDialog.close();
    } else {
      refs.confirmDialog.removeAttribute("open");
    }
  }

  function deletePendingApplication() {
    const id = state.pendingDeleteId;
    if (!id) return;
    const application = state.applications.find((item) => item.id === id);
    state.applications = state.applications.filter((item) => item.id !== id);
    state.pendingDeleteId = null;
    saveApplications();
    if (refs.confirmDialog.open) refs.confirmDialog.close();
    if (refs.applicationDialog.open) closeApplicationDialog();
    render();
    showToast(application ? "已删除「" + application.company + "」的投递记录" : "投递记录已删除");
  }

  /* ---------- Status updates ---------- */

  function updateStatus(applicationId, newStatus, options) {
    const settings = options || {};
    if (!STATUS_MAP[newStatus]) return;
    const application = state.applications.find((item) => item.id === applicationId);
    if (!application || application.status === newStatus) return;

    application.status = newStatus;
    application.updatedAt = new Date().toISOString();
    saveApplications();

    if (settings.fromBoard) {
      render();
      showToast("已移动到「" + getStatus(newStatus).label + "」");
      return;
    }

    // Keep keyboard focus in the current select for quick status changes.
    if (state.view === "list" && state.filter === "all") {
      const row = refs.applicationList.querySelector('.app-row[data-id="' + cssEscape(applicationId) + '"]');
      if (row) {
        row.className = "app-row status-" + newStatus;
        const label = row.querySelector(".status-select");
        if (label) label.className = "status-select status-" + newStatus;
        const select = row.querySelector("select");
        if (select) select.blur();
        if (select) select.focus({ preventScroll: true });
      }
      renderDashboard();
      renderFilters();
      refs.listCount.textContent = String(getFilteredApplications().length);
      showToast("已更新为「" + getStatus(newStatus).label + "」");
      return;
    }

    render();
    showToast("已更新为「" + getStatus(newStatus).label + "」");
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(value);
    }
    return String(value).replace(/["\\]/g, "\\$&");
  }

  /* ---------- Toast ---------- */

  function showToast(message, type) {
    if (!refs.toastRegion) return;
    while (refs.toastRegion.children.length >= 3) {
      refs.toastRegion.firstElementChild.remove();
    }
    const toast = document.createElement("div");
    toast.className = "toast" + (type === "error" ? " toast-error" : "");
    toast.innerHTML =
      (type === "error"
        ? '<svg viewBox="0 0 24 24" aria-hidden="true" style="color:#e1a89f"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>'
        : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4.5 4.5L19 7"/></svg>') +
      "<span>" +
      escapeHtml(message) +
      "</span>";
    refs.toastRegion.appendChild(toast);
    window.setTimeout(() => {
      toast.classList.add("is-leaving");
      window.setTimeout(() => toast.remove(), 220);
    }, 2800);
  }

  /* ---------- Data menu / export / import ---------- */

  function setDataMenu(open) {
    refs.dataMenuButton.setAttribute("aria-expanded", String(open));
    refs.dataMenu.hidden = !open;
  }

  function downloadBlob(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function csvCell(value) {
    let text = value == null ? "" : String(value);
    if (/^[=+\-@]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function exportCsv() {
    if (state.applications.length === 0) {
      showToast("还没有可以导出的投递记录", "error");
      return;
    }
    const rows = [["企业", "岗位", "投递时间", "当前状态", "投递渠道", "工作城市", "备注"]];
    sortApplications(state.applications).forEach((application) => {
      rows.push([
        application.company,
        application.position,
        application.appliedAt,
        getStatus(application.status).label,
        application.channel,
        application.location,
        application.notes
      ]);
    });
    const csv = "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
    downloadBlob(csv, "投递簿-" + todayIso() + ".csv", "text/csv;charset=utf-8");
    showToast("CSV 表格已导出");
  }

  function exportJson() {
    if (state.applications.length === 0) {
      showToast("还没有可以备份的投递记录", "error");
      return;
    }
    const payload = {
      app: "投递簿",
      version: 1,
      exportedAt: new Date().toISOString(),
      applications: sortApplications(state.applications)
    };
    downloadBlob(
      JSON.stringify(payload, null, 2),
      "投递簿-备份-" + todayIso() + ".json",
      "application/json;charset=utf-8"
    );
    showToast("JSON 备份已导出");
  }

  function importJsonFile(file) {
    const reader = new FileReader();
    reader.onload = function () {
      try {
        const parsed = JSON.parse(String(reader.result || ""));
        const rawList = Array.isArray(parsed)
          ? parsed
          : parsed && Array.isArray(parsed.applications)
            ? parsed.applications
            : null;
        if (!rawList) throw new Error("invalid shape");
        const imported = dedupeIds(rawList.map(normalizeApplication).filter(Boolean));
        if (imported.length === 0) throw new Error("empty");

        let added = 0;
        let updated = 0;
        imported.forEach((incoming) => {
          const index = state.applications.findIndex((item) => item.id === incoming.id);
          if (index >= 0) {
            state.applications[index] = incoming;
            updated += 1;
          } else {
            state.applications.push(incoming);
            added += 1;
          }
        });
        saveApplications();
        render();
        showToast(
          "导入完成：新增 " + added + " 条" + (updated ? "，更新 " + updated + " 条" : "")
        );
      } catch (error) {
        showToast("无法读取这个文件，请选择由投递簿导出的 JSON 备份。", "error");
      } finally {
        refs.importFile.value = "";
      }
    };
    reader.onerror = function () {
      refs.importFile.value = "";
      showToast("文件读取失败，请重试。", "error");
    };
    reader.readAsText(file);
  }

  /* ---------- Events ---------- */

  document.addEventListener("click", function (event) {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const addButton = target.closest("[data-open-add]");
    if (addButton) {
      openApplicationDialog();
      return;
    }

    const closeButton = target.closest("[data-close-dialog]");
    if (closeButton) {
      closeApplicationDialog();
      return;
    }

    const editButton = target.closest('[data-action="edit"]');
    if (editButton) {
      const row = editButton.closest(".app-row");
      const application = state.applications.find((item) => item.id === row.getAttribute("data-id"));
      if (application) openApplicationDialog({ application: application });
      return;
    }

    const boardAdd = target.closest('[data-action="board-add"]');
    if (boardAdd) {
      openApplicationDialog({ status: boardAdd.getAttribute("data-status") });
      return;
    }

    const boardCard = target.closest(".board-card");
    if (boardCard) {
      const application = state.applications.find(
        (item) => item.id === boardCard.getAttribute("data-id")
      );
      if (application) openApplicationDialog({ application: application });
      return;
    }

    const filterButton = target.closest("[data-filter]");
    if (filterButton) {
      state.filter = filterButton.getAttribute("data-filter");
      render();
      return;
    }

    const viewButton = target.closest("[data-view]");
    if (viewButton) {
      state.view = viewButton.getAttribute("data-view") === "board" ? "board" : "list";
      try {
        window.localStorage.setItem(VIEW_KEY, state.view);
      } catch (error) {
        /* View preference is non-critical. */
      }
      render();
      return;
    }

    const clearFilters = target.closest('[data-action="clear-filters"]');
    if (clearFilters) {
      state.filter = "all";
      state.search = "";
      refs.search.value = "";
      render();
      return;
    }

    const dataAction = target.closest("[data-data-action]");
    if (dataAction) {
      setDataMenu(false);
      const action = dataAction.getAttribute("data-data-action");
      if (action === "export-csv") exportCsv();
      if (action === "export-json") exportJson();
      if (action === "import-json") refs.importFile.click();
      return;
    }

    if (!target.closest(".menu-wrap")) {
      setDataMenu(false);
    }
  });

  refs.dataMenuButton.addEventListener("click", function () {
    const isOpen = refs.dataMenuButton.getAttribute("aria-expanded") === "true";
    setDataMenu(!isOpen);
  });

  document.addEventListener("keydown", function (event) {
    const target = event.target;
    const isTyping =
      target instanceof Element &&
      (target.matches("input, textarea, select") || target.isContentEditable);
    const anyDialogOpen = document.querySelector("dialog[open]");

    if (event.key === "Escape" && refs.dataMenuButton.getAttribute("aria-expanded") === "true") {
      setDataMenu(false);
      refs.dataMenuButton.focus();
      return;
    }

    if (anyDialogOpen || isTyping || event.metaKey || event.ctrlKey || event.altKey) return;

    if (event.key.toLowerCase() === "n") {
      event.preventDefault();
      openApplicationDialog();
    } else if (event.key === "/") {
      event.preventDefault();
      if (state.applications.length > 0) refs.search.focus();
    }
  });

  refs.search.addEventListener("input", function () {
    state.search = refs.search.value;
    render();
  });

  refs.applicationForm.addEventListener("input", function (event) {
    const field = event.target.closest(".field");
    if (field) field.classList.remove("has-error");
    const error = event.target
      .closest(".field")
      ?.querySelector(".field-error");
    if (error) error.textContent = "";
    event.target.removeAttribute("aria-invalid");
    event.target.removeAttribute("aria-describedby");
  });

  refs.notes.addEventListener("input", function () {
    refs.notesCount.textContent = String(refs.notes.value.length);
  });

  refs.applicationForm.addEventListener("submit", handleFormSubmit);

  refs.deleteButton.addEventListener("click", function () {
    if (state.editingId) openDeleteConfirm(state.editingId);
  });

  document.getElementById("confirm-cancel").addEventListener("click", closeConfirmDialog);
  document.getElementById("confirm-ok").addEventListener("click", deletePendingApplication);

  refs.applicationDialog.addEventListener("close", function () {
    state.editingId = null;
    if (!document.querySelector("dialog[open]")) {
      document.body.classList.remove("is-dialog-open");
    }
  });

  refs.confirmDialog.addEventListener("close", function () {
    state.pendingDeleteId = null;
    if (!document.querySelector("dialog[open]")) {
      document.body.classList.remove("is-dialog-open");
    }
  });

  [refs.applicationDialog, refs.confirmDialog].forEach((dialog) => {
    dialog.addEventListener("click", function (event) {
      if (event.target === dialog) {
        if (dialog === refs.confirmDialog) {
          closeConfirmDialog();
        } else {
          closeApplicationDialog();
        }
      }
    });
  });

  refs.applicationForm.elements.appliedAt.addEventListener("change", function () {
    if (this.value) setFieldError("appliedAt", "");
  });

  refs.applicationList.addEventListener("change", function (event) {
    const select = event.target.closest('select[data-action="status"]');
    if (!select) return;
    updateStatus(select.getAttribute("data-id"), select.value);
  });

  refs.boardView.addEventListener("keydown", function (event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    const card = event.target.closest(".board-card");
    if (!card) return;
    event.preventDefault();
    const application = state.applications.find((item) => item.id === card.getAttribute("data-id"));
    if (application) openApplicationDialog({ application: application });
  });

  // Drag and drop between board columns.
  refs.boardView.addEventListener("dragstart", function (event) {
    const card = event.target.closest(".board-card");
    if (!card) return;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", card.getAttribute("data-id"));
    card.classList.add("is-dragging");
  });

  refs.boardView.addEventListener("dragend", function (event) {
    const card = event.target.closest(".board-card");
    if (card) card.classList.remove("is-dragging");
    refs.boardView.querySelectorAll(".board-column.is-drag-over").forEach((column) => {
      column.classList.remove("is-drag-over");
    });
  });

  refs.boardView.addEventListener("dragover", function (event) {
    const column = event.target.closest(".board-column");
    if (!column) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    refs.boardView.querySelectorAll(".board-column.is-drag-over").forEach((item) => {
      if (item !== column) item.classList.remove("is-drag-over");
    });
    column.classList.add("is-drag-over");
  });

  refs.boardView.addEventListener("dragleave", function (event) {
    const column = event.target.closest(".board-column");
    if (!column) return;
    if (!column.contains(event.relatedTarget)) column.classList.remove("is-drag-over");
  });

  refs.boardView.addEventListener("drop", function (event) {
    const column = event.target.closest(".board-column");
    if (!column) return;
    event.preventDefault();
    const applicationId = event.dataTransfer.getData("text/plain");
    const newStatus = column.getAttribute("data-status");
    column.classList.remove("is-drag-over");
    updateStatus(applicationId, newStatus, { fromBoard: true });
  });

  refs.importFile.addEventListener("change", function () {
    const file = refs.importFile.files && refs.importFile.files[0];
    if (file) importJsonFile(file);
  });

  window.addEventListener("storage", function (event) {
    if (event.key !== STORAGE_KEY) return;
    state.applications = loadApplications();
    render();
  });

  /* ---------- Initialization ---------- */

  initFormOptions();
  state.applications = loadApplications();
  try {
    const storedView = window.localStorage.getItem(VIEW_KEY);
    if (storedView === "board" || storedView === "list") state.view = storedView;
  } catch (error) {
    state.view = "list";
  }

  render();

  // Highlight the section currently in view in the top navigation.
  if ("IntersectionObserver" in window) {
    const navLinks = Array.from(document.querySelectorAll(".main-nav a"));
    const sections = [
      { id: "tracker", link: navLinks.find((link) => link.getAttribute("href") === "#tracker") },
      { id: "overview", link: navLinks.find((link) => link.getAttribute("href") === "#overview") }
    ].filter((item) => item.link && document.getElementById(item.id));

    const observer = new IntersectionObserver(
      function (entries) {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          navLinks.forEach((link) => link.classList.remove("is-active"));
          const match = sections.find((item) => item.id === entry.target.id);
          if (match) match.link.classList.add("is-active");
        });
      },
      { rootMargin: "-25% 0px -62% 0px", threshold: 0 }
    );
    sections.forEach((item) => observer.observe(document.getElementById(item.id)));
  }
})();
