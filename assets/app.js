/* global crypto, Blob, URL */
(function () {
  "use strict";

  const STORAGE_KEY = "qiuzhao-tracker:v1";
  const VIEW_KEY = "qiuzhao-tracker:view";
  const SYNC_CONFIG_KEY = "qiuzhao-tracker:github-sync";
  const SYNC_API_BASE = "https://api.github.com";
  const SYNC_DEFAULT_REPO = "2015105076/qiuzhao-tracker-data";
  const SYNC_DEFAULT_BRANCH = "main";
  const SYNC_DEFAULT_PATH = "applications.json";
  const SYNC_DEBOUNCE_MS = 1200;
  const SYNC_FOCUS_THROTTLE_MS = 30000;
  const TOMBSTONE_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;

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
  const IMPORT_MAX_ROWS = 1000;
  const IMPORT_MAX_FILE_SIZE = 8 * 1024 * 1024;
  const IMPORT_PREVIEW_LIMIT = 50;
  const XLSX_SCRIPT_URL = "assets/vendor/xlsx.full.min.js";
  const IMPORT_COLUMNS = [
    { key: "company", label: "企业" },
    { key: "position", label: "岗位" },
    { key: "appliedAt", label: "投递时间" },
    { key: "status", label: "状态" },
    { key: "channel", label: "投递渠道" },
    { key: "location", label: "工作城市" },
    { key: "notes", label: "备注" }
  ];
  const IMPORT_HEADER_ALIASES = {
    company: ["企业", "公司", "企业名称", "公司名称", "单位", "单位名称", "应聘企业", "company", "companyname"],
    position: ["岗位", "职位", "岗位名称", "职位名称", "投递岗位", "应聘岗位", "应聘职位", "position", "jobtitle", "role"],
    appliedAt: ["投递时间", "投递日期", "申请时间", "申请日期", "日期", "时间", "appliedat", "applieddate", "applydate", "applicationdate", "date"],
    status: ["状态", "投递状态", "当前状态", "进度", "status", "currentstatus"],
    channel: ["渠道", "投递渠道", "来源", "申请渠道", "channel", "source"],
    location: ["城市", "工作城市", "地点", "工作地点", "base", "location", "city"],
    notes: ["备注", "说明", "备注信息", "notes", "note", "remark"]
  };
  const IMPORT_STATUS_ALIASES = {
    applied: ["已投递", "投递", "已申请", "申请中", "已提交", "applied", "submitted", "apply"],
    screening: ["筛选中", "筛选", "初筛", "简历筛选", "评估中", "screening"],
    written: ["笔试", "笔试中", "在线笔试", "测评", "测试", "written", "test", "assessment"],
    interview: ["面试中", "面试", "一面", "二面", "三面", "hr面", "终面", "interview", "interviewing"],
    offer: ["已获offer", "offer", "已offer", "收到offer", "录用", "已录用", "意向书", "已发offer"],
    rejected: ["未通过", "已挂", "挂", "拒绝", "已拒绝", "淘汰", "未录用", "rejected", "reject", "failed"]
  };
  const IMPORT_CHANNEL_ALIASES = [
    { value: "内推", aliases: ["内推", "referral", "refer", "员工推荐"] },
    { value: "官网投递", aliases: ["官网", "官网投递", "网申", "校招官网", "official", "careers"] },
    { value: "招聘平台", aliases: ["招聘平台", "boss", "boss直聘", "智联", "智联招聘", "前程无忧", "猎聘", "牛客", "拉勾", "linkedin", "领英"] },
    { value: "校园宣讲", aliases: ["校园", "宣讲", "校园宣讲", "校招", "双选会", "校招会"] },
    { value: "其他", aliases: ["其他", "other", "其它"] }
  ];
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
    syncBadge: document.getElementById("sync-badge"),
    syncBadgeText: document.getElementById("sync-badge-text"),
    syncMenuState: document.getElementById("sync-menu-state"),
    syncDialog: document.getElementById("sync-dialog"),
    syncStatusCard: document.getElementById("sync-status-card"),
    syncStatusTitle: document.getElementById("sync-status-title"),
    syncStatusDesc: document.getElementById("sync-status-desc"),
    syncStatusPill: document.getElementById("sync-status-pill"),
    syncError: document.getElementById("sync-error"),
    syncFormError: document.getElementById("sync-form-error"),
    syncConnected: document.getElementById("sync-connected"),
    syncConnectedRepo: document.getElementById("sync-connected-repo"),
    syncConnectedPath: document.getElementById("sync-connected-path"),
    syncConnectedBranch: document.getElementById("sync-connected-branch"),
    syncConnectedTime: document.getElementById("sync-connected-time"),
    syncAuto: document.getElementById("sync-auto"),
    syncAutoSetup: document.getElementById("sync-auto-setup"),
    syncNow: document.getElementById("sync-now"),
    syncEdit: document.getElementById("sync-edit"),
    syncDisconnect: document.getElementById("sync-disconnect"),
    syncSetup: document.getElementById("sync-setup"),
    syncHelp: document.getElementById("sync-help"),
    syncForm: document.getElementById("sync-form"),
    syncRepo: document.getElementById("sync-repo"),
    syncBranch: document.getElementById("sync-branch"),
    syncPath: document.getElementById("sync-path"),
    syncToken: document.getElementById("sync-token"),
    syncTokenHint: document.getElementById("sync-token-hint"),
    syncTokenToggle: document.getElementById("sync-token-toggle"),
    syncRepoLink: document.getElementById("sync-repo-link"),
    syncHelpRepo: document.getElementById("sync-help-repo"),
    syncSubmit: document.getElementById("sync-submit"),
    syncCancel: document.getElementById("sync-cancel"),
    importDialog: document.getElementById("import-dialog"),
    importFile: document.getElementById("import-file"),
    excelFile: document.getElementById("excel-file"),
    excelDropzone: document.getElementById("excel-dropzone"),
    importLoading: document.getElementById("import-loading"),
    importError: document.getElementById("import-error"),
    importResult: document.getElementById("import-result"),
    importFileName: document.getElementById("import-file-name"),
    importFileMeta: document.getElementById("import-file-meta"),
    importSummary: document.getElementById("import-summary"),
    importPreviewBody: document.getElementById("import-preview-body"),
    importPreviewNote: document.getElementById("import-preview-note"),
    importSkipDuplicates: document.getElementById("import-skip-duplicates"),
    importReselect: document.getElementById("import-reselect"),
    confirmImport: document.getElementById("confirm-import"),
    toastRegion: document.getElementById("toast-region"),
    progressRing: document.getElementById("progress-ring"),
    seasonYear: document.getElementById("season-year"),
    seasonLabel: document.getElementById("season-label")
  };

  const state = {
    applications: [],
    deletions: {},
    documentUpdatedAt: null,
    filter: "all",
    search: "",
    view: "list",
    editingId: null,
    pendingDeleteId: null,
    storageWarningShown: false
  };

  const syncState = {
    config: null,
    status: "local",
    error: "",
    formError: "",
    dirty: false,
    changeVersion: 0,
    lastSyncAt: 0,
    lastAttemptAt: 0,
    editing: false,
    inFlight: false,
    pending: false,
    timer: null,
    syncPromise: null,
    notifiedError: false
  };

  const importState = {
    rows: [],
    fileName: "",
    sheetName: "",
    skipDuplicates: true,
    parseToken: 0,
    xlsxPromise: null
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

  function sanitizeDeletions(raw) {
    const result = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result;
    Object.keys(raw).forEach((id) => {
      const timestamp = raw[id];
      const parsed = Date.parse(timestamp);
      if (typeof id === "string" && id && !Number.isNaN(parsed)) {
        result[id] = new Date(parsed).toISOString();
      }
    });
    return result;
  }

  function pruneDeletions(deletions) {
    const cutoff = Date.now() - TOMBSTONE_MAX_AGE_MS;
    const result = {};
    Object.keys(deletions || {}).forEach((id) => {
      const timestamp = Date.parse(deletions[id]);
      if (!Number.isNaN(timestamp) && timestamp >= cutoff) {
        result[id] = new Date(timestamp).toISOString();
      }
    });
    return result;
  }

  function loadLocalDocument() {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (!stored) {
        return { applications: [], deletions: {}, updatedAt: null };
      }
      const parsed = JSON.parse(stored);
      const list = Array.isArray(parsed)
        ? parsed
        : parsed && Array.isArray(parsed.applications)
          ? parsed.applications
          : [];
      const updatedAt =
        !Array.isArray(parsed) &&
        parsed &&
        !Number.isNaN(Date.parse(parsed.updatedAt))
          ? new Date(parsed.updatedAt).toISOString()
          : null;
      return {
        applications: dedupeIds(list.map(normalizeApplication).filter(Boolean)),
        deletions: pruneDeletions(
          sanitizeDeletions(!Array.isArray(parsed) && parsed ? parsed.deletions : {})
        ),
        updatedAt: updatedAt
      };
    } catch (error) {
      return { applications: [], deletions: {}, updatedAt: null };
    }
  }

  function saveApplications(options) {
    const settings = options || {};
    const touch = settings.touch !== false;
    const now = new Date().toISOString();
    if (touch || !state.documentUpdatedAt) {
      state.documentUpdatedAt = now;
    }
    state.deletions = pruneDeletions(state.deletions);

    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          version: 2,
          updatedAt: state.documentUpdatedAt,
          applications: state.applications,
          deletions: state.deletions
        })
      );
    } catch (error) {
      if (!state.storageWarningShown) {
        state.storageWarningShown = true;
        showToast("浏览器本地存储不可用，记录可能无法保留。", "error");
      }
    }

    if (touch && !settings.skipCloudSync) {
      onLocalDataChanged();
    }
    return true;
  }

  function clearDeletionMark(id) {
    if (id && state.deletions[id]) delete state.deletions[id];
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
        '<button type="button" class="empty-import-link" data-open-import>',
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M8 13h8M8 17h5"/></svg>',
        "已有 Excel？批量导入",
        "</button>",
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

    clearDeletionMark(application.id);
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
    state.deletions[id] = new Date().toISOString();
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
    clearDeletionMark(application.id);
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
          clearDeletionMark(incoming.id);
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

  /* ---------- Excel batch import ---------- */

  function normalizeImportText(value) {
    return String(value == null ? "" : value)
      .replace(/\uFEFF/g, "")
      .replace(/[（(][^）)]*[）)]/g, "")
      .replace(/[\s：:*＊]/g, "")
      .replace(/必填|选填/g, "")
      .toLowerCase();
  }

  function importUserError(message) {
    const error = new Error(message);
    error.isUserFacing = true;
    return error;
  }

  function formatFileSize(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function loadXlsxLibrary() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (importState.xlsxPromise) return importState.xlsxPromise;

    importState.xlsxPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = new URL(XLSX_SCRIPT_URL, document.baseURI).href;
      script.async = true;
      script.dataset.xlsxLibrary = "true";
      script.onload = () => {
        if (window.XLSX) {
          resolve(window.XLSX);
        } else {
          importState.xlsxPromise = null;
          reject(importUserError("Excel 解析组件加载失败，请刷新页面后重试。"));
        }
      };
      script.onerror = () => {
        importState.xlsxPromise = null;
        script.remove();
        reject(importUserError("Excel 解析组件加载失败，请检查网络后重试。"));
      };
      document.head.appendChild(script);
    });

    return importState.xlsxPromise;
  }

  function detectImportHeader(rows) {
    const fields = Object.keys(IMPORT_HEADER_ALIASES);
    const limit = Math.min(rows.length, 20);

    for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
      const headerCells = (rows[rowIndex] || []).map(normalizeImportText);
      const mapping = {};

      fields.forEach((field) => {
        const aliases = IMPORT_HEADER_ALIASES[field].map(normalizeImportText);
        const index = headerCells.findIndex(
          (cell) => cell && aliases.includes(cell)
        );
        if (index >= 0) mapping[field] = index;
      });

      if (mapping.company != null && mapping.position != null && mapping.appliedAt != null) {
        return { rowIndex: rowIndex, mapping: mapping };
      }
    }

    return null;
  }

  function isoFromParts(year, month, day) {
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
      return "";
    }
    const value = [
      String(year).padStart(4, "0"),
      String(month).padStart(2, "0"),
      String(day).padStart(2, "0")
    ].join("-");
    return isValidIsoDate(value) ? value : "";
  }

  function parseImportDate(value, XLSX, date1904) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return isoFromParts(value.getFullYear(), value.getMonth() + 1, value.getDate());
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      const parsed = XLSX.SSF.parse_date_code(value, { date1904: Boolean(date1904) });
      if (parsed && parsed.y && parsed.m && parsed.d) {
        return isoFromParts(parsed.y, parsed.m, parsed.d);
      }
      return "";
    }

    const text = String(value == null ? "" : value).trim().replace(/^['"]/, "");
    if (!text) return "";

    let match = text.match(/^(\d{4})[\-\/.年](\d{1,2})[\-\/.月](\d{1,2})日?/);
    if (match) {
      return isoFromParts(Number(match[1]), Number(match[2]), Number(match[3]));
    }

    match = text.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (match) {
      return isoFromParts(Number(match[1]), Number(match[2]), Number(match[3]));
    }

    match = text.match(/^(\d{1,2})[\-\/.](\d{1,2})[\-\/.](\d{4})$/);
    if (match) {
      const first = Number(match[1]);
      const second = Number(match[2]);
      const year = Number(match[3]);
      if (first <= 12) {
        return isoFromParts(year, first, second);
      }
      return isoFromParts(year, second, first);
    }

    if (/^\d{5}(\.\d+)?$/.test(text)) {
      const parsed = XLSX.SSF.parse_date_code(Number(text), { date1904: Boolean(date1904) });
      if (parsed && parsed.y && parsed.m && parsed.d) {
        return isoFromParts(parsed.y, parsed.m, parsed.d);
      }
    }

    return "";
  }

  function normalizeImportStatus(value) {
    const raw = cleanText(value, 30);
    const normalized = normalizeImportText(raw);

    if (!normalized) {
      return {
        status: "applied",
        warning: "状态为空，已按“已投递”导入"
      };
    }

    const matched = Object.keys(IMPORT_STATUS_ALIASES).find((key) =>
      IMPORT_STATUS_ALIASES[key].map(normalizeImportText).includes(normalized)
    );

    if (matched) return { status: matched, warning: "" };

    return {
      error:
        "无法识别状态“" +
        raw +
        "”，可选：已投递、筛选中、笔试、面试中、已获 Offer、未通过"
    };
  }

  function normalizeImportChannel(value) {
    const raw = cleanText(value, 40);
    if (!raw) return { channel: "官网投递", warning: "" };

    const normalized = normalizeImportText(raw);
    const direct = CHANNELS.find((channel) => normalizeImportText(channel) === normalized);
    if (direct) return { channel: direct, warning: "" };

    for (let index = 0; index < IMPORT_CHANNEL_ALIASES.length; index += 1) {
      const item = IMPORT_CHANNEL_ALIASES[index];
      const aliases = item.aliases.map(normalizeImportText);
      if (aliases.includes(normalized) || aliases.some((alias) => normalized.includes(alias))) {
        return { channel: item.value, warning: "" };
      }
    }

    return {
      channel: "其他",
      warning: "渠道“" + raw + "”无法识别，已归入“其他”"
    };
  }

  function importFingerprint(company, position, appliedAt) {
    return [
      cleanText(company, 60).toLowerCase(),
      cleanText(position, 80).toLowerCase(),
      appliedAt
    ].join("|");
  }

  function existingApplicationKeys() {
    return new Set(
      state.applications.map((application) =>
        importFingerprint(application.company, application.position, application.appliedAt)
      )
    );
  }

  function parseImportSheet(rows, XLSX, date1904, existingKeys) {
    const header = detectImportHeader(rows);
    if (!header) return null;

    const mapping = header.mapping;
    const records = [];
    const seenKeys = new Set();

    function cell(row, field) {
      const index = mapping[field];
      return index == null ? "" : row[index];
    }

    for (let rowIndex = header.rowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex] || [];
      const rawCompany = cell(row, "company");
      const rawPosition = cell(row, "position");
      const rawDate = cell(row, "appliedAt");
      const rawStatus = cell(row, "status");
      const rawChannel = cell(row, "channel");
      const rawLocation = cell(row, "location");
      const rawNotes = cell(row, "notes");

      const hasData = [rawCompany, rawPosition, rawDate].some(
        (value) => String(value == null ? "" : value).trim() !== ""
      );
      const allMappedBlank = IMPORT_COLUMNS.every((column) => {
        if (mapping[column.key] == null) return true;
        return String(row[mapping[column.key]] == null ? "" : row[mapping[column.key]]).trim() === "";
      });
      if (!hasData || allMappedBlank) continue;

      if (records.length >= IMPORT_MAX_ROWS) {
        throw importUserError(
          "表格中的数据超过 " + IMPORT_MAX_ROWS + " 行，请分批导入。"
        );
      }

      const company = cleanText(rawCompany, 60);
      const position = cleanText(rawPosition, 80);
      const appliedAt = parseImportDate(rawDate, XLSX, date1904);
      const statusResult = normalizeImportStatus(rawStatus);
      const channelResult = normalizeImportChannel(rawChannel);
      const location = cleanText(rawLocation, 40);
      const notes = cleanNotes(rawNotes);
      const errors = [];
      const warnings = [];

      if (!company) errors.push("企业名称为空");
      if (!position) errors.push("岗位为空");
      if (!appliedAt) errors.push("投递时间无法识别");
      if (statusResult.error) errors.push(statusResult.error);
      if (statusResult.warning) warnings.push(statusResult.warning);
      if (channelResult.warning) warnings.push(channelResult.warning);
      if (String(rawCompany || "").trim().length > 60) warnings.push("企业名称超过 60 字，已截断");
      if (String(rawPosition || "").trim().length > 80) warnings.push("岗位超过 80 字，已截断");

      let duplicate = null;
      if (errors.length === 0) {
        const key = importFingerprint(company, position, appliedAt);
        if (existingKeys.has(key)) {
          duplicate = "existing";
        } else if (seenKeys.has(key)) {
          duplicate = "file";
        }
        seenKeys.add(key);
      }

      records.push({
        rowNumber: rowIndex + 1,
        company,
        position,
        appliedAt,
        rawDate: String(rawDate == null ? "" : rawDate),
        status: statusResult.status || "applied",
        channel: channelResult.channel,
        location,
        notes,
        errors,
        warnings,
        duplicate
      });
    }

    return {
      records,
      headerRow: header.rowIndex + 1,
      missingStatusColumn: mapping.status == null,
      missingChannelColumn: mapping.channel == null
    };
  }

  function showImportError(message) {
    refs.importLoading.hidden = true;
    refs.importResult.hidden = true;
    refs.excelDropzone.hidden = false;
    refs.importError.hidden = false;
    refs.importError.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>' +
      "<span>" +
      escapeHtml(message) +
      "</span>";
    refs.confirmImport.disabled = true;
    refs.confirmImport.textContent = "导入 0 条";
  }

  function clearImportError() {
    refs.importError.hidden = true;
    refs.importError.textContent = "";
  }

  async function parseExcelFile(file) {
    clearImportError();
    if (!file) return;

    const extension = String(file.name || "").split(".").pop().toLowerCase();
    if (!["xlsx", "xls", "csv"].includes(extension)) {
      showImportError("请选择 .xlsx、.xls 或 .csv 格式的表格文件。");
      return;
    }
    if (file.size > IMPORT_MAX_FILE_SIZE) {
      showImportError("文件超过 8 MB，请删除无关工作表或分批导入。");
      return;
    }

    const token = importState.parseToken + 1;
    importState.parseToken = token;
    importState.rows = [];
    importState.fileName = file.name;
    importState.sheetName = "";
    importState.fileSize = file.size;
    refs.excelDropzone.hidden = true;
    refs.importResult.hidden = true;
    refs.importLoading.hidden = false;
    refs.confirmImport.disabled = true;
    refs.confirmImport.textContent = "导入 0 条";

    try {
      const XLSX = await loadXlsxLibrary();
      if (token !== importState.parseToken) return;
      const buffer = await file.arrayBuffer();
      if (token !== importState.parseToken) return;

      const workbook = XLSX.read(new Uint8Array(buffer), {
        type: "array",
        cellDates: false,
        dense: false
      });
      const date1904 = Boolean(
        workbook.Workbook &&
          workbook.Workbook.WBProps &&
          workbook.Workbook.WBProps.date1904
      );
      const existingKeys = existingApplicationKeys();
      let parsed = null;

      for (let index = 0; index < workbook.SheetNames.length; index += 1) {
        const sheetName = workbook.SheetNames[index];
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) continue;
        const rows = XLSX.utils.sheet_to_json(sheet, {
          header: 1,
          raw: true,
          defval: "",
          blankrows: true
        });
        const result = parseImportSheet(rows, XLSX, date1904, existingKeys);
        if (result) {
          parsed = Object.assign({}, result, { sheetName: sheetName });
          break;
        }
      }

      if (!parsed) {
        throw importUserError(
          "没有找到可识别的字段。请确认表格包含“企业”“岗位”“投递时间”三列，或先下载导入模板。"
        );
      }
      if (parsed.records.length === 0) {
        throw importUserError("表头识别成功，但没有找到可导入的数据行。");
      }

      if (token !== importState.parseToken) return;

      importState.rows = parsed.records;
      importState.sheetName = parsed.sheetName;
      importState.skipDuplicates = true;
      refs.importSkipDuplicates.checked = true;
      refs.importLoading.hidden = true;
      refs.excelDropzone.hidden = true;
      refs.importResult.hidden = false;
      refs.importFileName.textContent = file.name;
      refs.importFileMeta.textContent =
        "工作表：" +
        parsed.sheetName +
        " · " +
        parsed.records.length +
        " 行 · " +
        formatFileSize(file.size);
      renderImportResult();
    } catch (error) {
      if (token !== importState.parseToken) return;
      const message =
        error && error.isUserFacing
          ? error.message
          : "Excel 解析失败，请确认文件未损坏、未加密，并包含可识别的字段。";
      showImportError(message);
    } finally {
      if (token === importState.parseToken) refs.importLoading.hidden = true;
    }
  }

  function getSelectedImportRows() {
    const valid = importState.rows.filter((row) => row.errors.length === 0);
    if (!importState.skipDuplicates) return valid;
    return valid.filter((row) => !row.duplicate);
  }

  function importRowResult(row) {
    if (row.errors.length > 0) {
      return {
        className: "is-error",
        label: "待修正",
        detail: row.errors.join("；")
      };
    }
    if (row.duplicate) {
      const suffix =
        row.duplicate === "existing" ? "已有相同记录" : "表中出现重复";
      return importState.skipDuplicates
        ? { className: "is-duplicate", label: "重复 · 跳过", detail: suffix }
        : { className: "is-duplicate", label: "重复 · 导入", detail: suffix };
    }
    if (row.warnings.length > 0) {
      return {
        className: "is-warning",
        label: "可导入",
        detail: row.warnings.join("；")
      };
    }
    return { className: "is-ok", label: "可导入", detail: "" };
  }

  function renderImportResult() {
    if (!importState.rows.length) return;

    const valid = importState.rows.filter((row) => row.errors.length === 0);
    const invalid = importState.rows.filter((row) => row.errors.length > 0);
    const duplicateCount = valid.filter((row) => row.duplicate).length;
    const selected = getSelectedImportRows();
    const previewRows = importState.rows.slice(0, IMPORT_PREVIEW_LIMIT);

    refs.importSummary.innerHTML = [
      '<span class="import-stat is-valid"><strong>' + selected.length + "</strong> 条可导入</span>",
      duplicateCount
        ? '<span class="import-stat is-duplicate"><strong>' + duplicateCount + "</strong> 条重复</span>"
        : "",
      invalid.length
        ? '<span class="import-stat is-error"><strong>' + invalid.length + "</strong> 行待修正</span>"
        : ""
    ].join("");

    refs.importPreviewNote.textContent =
      importState.rows.length > IMPORT_PREVIEW_LIMIT
        ? "共 " + importState.rows.length + " 行，仅展示前 " + IMPORT_PREVIEW_LIMIT + " 行；导入将处理全部有效行"
        : "共 " + importState.rows.length + " 行";

    refs.importPreviewBody.innerHTML = previewRows
      .map((row) => {
        const result = importRowResult(row);
        const status = getStatus(row.status);
        return [
          '<tr class="' + (row.errors.length ? "is-invalid-row" : "") + '">',
          '<td class="col-row">' + row.rowNumber + "</td>",
          '<td class="col-company" title="' + escapeHtml(row.company) + '">',
          '  <span class="import-company-name">' + (escapeHtml(row.company) || "—") + "</span>",
          '  <span class="import-mobile-meta">',
          '    <span class="import-mobile-position">' + (escapeHtml(row.position) || "—") + "</span>",
          '    <span class="import-status status-' + status.key + '">' + escapeHtml(status.label) + "</span>",
          "  </span>",
          "</td>",
          '<td class="col-position" title="' + escapeHtml(row.position) + '">' + (escapeHtml(row.position) || "—") + "</td>",
          '<td class="col-date import-date">' + (row.appliedAt ? formatShortDate(row.appliedAt) : escapeHtml(row.rawDate) || "—") + "</td>",
          '<td class="col-status"><span class="import-status status-' + status.key + '">' + escapeHtml(status.label) + "</span></td>",
          '<td class="col-validation import-validation"><span class="import-row-status ' + result.className + '">' +
            escapeHtml(result.label) + "</span>" +
            (result.detail ? '<span class="import-row-detail" title="' + escapeHtml(result.detail) + '">' +
              escapeHtml(result.detail) + "</span>" : "") +
            "</td>",
          "</tr>"
        ].join("");
      })
      .join("");

    refs.importSkipDuplicates.disabled = duplicateCount === 0;
    refs.importSkipDuplicates.parentElement.hidden = duplicateCount === 0;
    refs.importSkipDuplicates.parentElement.classList.toggle(
      "is-disabled",
      duplicateCount === 0
    );

    refs.confirmImport.disabled = selected.length === 0;
    refs.confirmImport.textContent =
      selected.length === 0 ? "没有可导入数据" : "导入 " + selected.length + " 条";
  }

  function resetImportDialog() {
    importState.parseToken += 1;
    importState.rows = [];
    importState.fileName = "";
    importState.sheetName = "";
    importState.fileSize = 0;
    importState.skipDuplicates = true;
    refs.excelFile.value = "";
    refs.excelDropzone.hidden = false;
    refs.importLoading.hidden = true;
    refs.importResult.hidden = true;
    refs.importError.hidden = true;
    refs.importError.textContent = "";
    refs.importSummary.innerHTML = "";
    refs.importPreviewBody.innerHTML = "";
    refs.importPreviewNote.textContent = "";
    refs.importSkipDuplicates.checked = true;
    refs.importSkipDuplicates.disabled = false;
    refs.importSkipDuplicates.parentElement.hidden = false;
    refs.confirmImport.disabled = true;
    refs.confirmImport.textContent = "导入 0 条";
  }

  function openImportDialog() {
    resetImportDialog();
    if (typeof refs.importDialog.showModal === "function") {
      refs.importDialog.showModal();
    } else {
      refs.importDialog.setAttribute("open", "");
    }
    document.body.classList.add("is-dialog-open");
    window.setTimeout(() => {
      const chooseButton = document.getElementById("choose-excel");
      if (chooseButton) chooseButton.focus();
    }, 50);
  }

  function closeImportDialog() {
    if (refs.importDialog.open) {
      refs.importDialog.close();
    } else {
      refs.importDialog.removeAttribute("open");
    }
  }

  function confirmExcelImport() {
    const selected = getSelectedImportRows();
    if (selected.length === 0) {
      showToast("没有可导入的数据，请检查表格内容。", "error");
      return;
    }

    const now = new Date().toISOString();
    const imported = selected.map((row) =>
      normalizeApplication({
        id: uid(),
        company: row.company,
        position: row.position,
        appliedAt: row.appliedAt,
        status: row.status,
        channel: row.channel,
        location: row.location,
        notes: row.notes,
        createdAt: now,
        updatedAt: now
      })
    ).filter(Boolean);

    state.applications.push.apply(state.applications, imported);
    imported.forEach((application) => clearDeletionMark(application.id));
    state.filter = "all";
    state.search = "";
    refs.search.value = "";
    saveApplications();
    closeImportDialog();
    render();
    showToast("已从 Excel 导入 " + imported.length + " 条投递记录");
  }

  function downloadExcelTemplate() {
    const url = new URL("assets/import-template.xlsx", document.baseURI).href;
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "投递簿-批量导入模板.xlsx";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    showToast("Excel 模板已开始下载");
  }

  /* ---------- GitHub cloud sync ---------- */

  function syncUserError(message) {
    const error = new Error(message);
    error.isUserFacing = true;
    return error;
  }

  function validateSyncConfig(raw) {
    const repo = cleanText(raw.repo, 120);
    const branch = cleanText(raw.branch, 80) || SYNC_DEFAULT_BRANCH;
    const path = cleanText(raw.path, 120).replace(/^\/+/, "") || SYNC_DEFAULT_PATH;
    const token = String(raw.token == null ? "" : raw.token).trim();
    const invalidBranchChars = ["~", "^", ":", "?", "*", "[", "\\", " "];

    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
      return { error: "仓库格式应为 owner/repository，例如 2015105076/qiuzhao-tracker-data。", field: "repo" };
    }
    if (
      branch.startsWith("/") ||
      branch.endsWith("/") ||
      branch.includes("..") ||
      Array.from(branch).some((character) => invalidBranchChars.includes(character))
    ) {
      return { error: "分支名称无法识别，请填写 main 或已有的分支名。", field: "branch" };
    }
    const segments = path.split("/");
    if (
      !path ||
      segments.some((segment) => !segment || segment === "." || segment === "..") ||
      !/\.json$/i.test(path)
    ) {
      return { error: "数据文件需为 JSON 文件，例如 applications.json。", field: "path" };
    }
    if (token.length < 10) {
      return { error: "请填写有效的 GitHub Token。", field: "token" };
    }

    return {
      config: {
        repo: repo,
        branch: branch,
        path: path,
        token: token,
        autoSync: Boolean(raw.autoSync),
        lastSyncAt: raw.lastSyncAt || null
      }
    };
  }

  function loadSyncConfig() {
    try {
      const stored = window.localStorage.getItem(SYNC_CONFIG_KEY);
      if (!stored) return null;
      const parsed = JSON.parse(stored);
      const validated = validateSyncConfig(parsed || {});
      if (!validated.config) return null;
      const config = validated.config;
      config.lastSyncAt =
        !Number.isNaN(Date.parse(parsed.lastSyncAt)) && parsed.lastSyncAt
          ? new Date(parsed.lastSyncAt).toISOString()
          : null;
      return config;
    } catch (error) {
      return null;
    }
  }

  function storeSyncConfig(config) {
    try {
      window.localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(config));
      return true;
    } catch (error) {
      showToast("浏览器无法保存同步设置，请检查本地存储权限。", "error");
      return false;
    }
  }

  function formatSyncTime(value) {
    if (!value) return "尚未同步";
    const timestamp = Date.parse(value);
    if (Number.isNaN(timestamp)) return "尚未同步";
    const diff = Date.now() - timestamp;
    if (diff < 60000) return "刚刚";
    if (diff < 3600000) return Math.floor(diff / 60000) + " 分钟前";
    const date = new Date(timestamp);
    const now = new Date();
    if (
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate()
    ) {
      return "今天 " + new Intl.DateTimeFormat("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      }).format(date);
    }
    return new Intl.DateTimeFormat("zh-CN", {
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(date);
  }

  function getSyncDisplayState() {
    const config = syncState.config;
    if (!config) {
      return {
        key: "local",
        title: "仅保存在本机",
        description: "连接一个私有 GitHub 仓库，即可在不同设备同步投递记录。",
        pill: "未连接",
        badge: "仅本地存储",
        menu: "未连接"
      };
    }
    if (syncState.inFlight || syncState.status === "syncing") {
      return {
        key: "syncing",
        title: "正在与 GitHub 同步…",
        description: "正在读取远程记录并合并，请稍候。",
        pill: "同步中",
        badge: "同步中…",
        menu: "同步中"
      };
    }
    if (syncState.status === "error") {
      return {
        key: "error",
        title: "同步遇到问题",
        description: syncState.error || "暂时无法同步，请稍后重试。",
        pill: "同步失败",
        badge: "同步失败",
        menu: "失败"
      };
    }
    if (syncState.status === "offline" || navigator.onLine === false) {
      return {
        key: "error",
        title: "当前处于离线状态",
        description: "网络恢复后会自动重试，本地记录不会丢失。",
        pill: "离线",
        badge: "等待联网",
        menu: "离线"
      };
    }
    if (syncState.dirty) {
      return {
        key: "pending",
        title: "有改动等待同步",
        description: config.autoSync
          ? "本地记录已保存，稍后会自动同步到 GitHub。"
          : "自动同步已关闭，点击「立即同步」上传这次改动。",
        pill: "待同步",
        badge: "等待同步",
        menu: "待同步"
      };
    }
    if (!config.lastSyncAt) {
      return {
        key: "pending",
        title: "已连接 GitHub",
        description: "点击「立即同步」完成第一次同步。",
        pill: "待同步",
        badge: "等待同步",
        menu: "待同步"
      };
    }
    return {
      key: "synced",
      title: "GitHub 云同步已开启",
      description: "上次同步：" + formatSyncTime(config.lastSyncAt) + " · " + config.repo,
      pill: "已同步",
      badge: "GitHub 已同步",
      menu: "已同步"
    };
  }

  function renderSyncUi() {
    const config = syncState.config;
    const view = getSyncDisplayState();
    const connected = Boolean(config) && !syncState.editing;

    refs.syncBadge.dataset.state = view.key;
    refs.syncBadgeText.textContent = view.badge;
    refs.syncBadge.setAttribute("aria-label", "GitHub 云同步：" + view.badge);
    refs.syncMenuState.textContent = view.menu;
    refs.syncMenuState.dataset.state = view.key;

    refs.syncStatusCard.dataset.state = view.key;
    refs.syncStatusTitle.textContent = view.title;
    refs.syncStatusDesc.textContent = view.description;
    refs.syncStatusPill.textContent = view.pill;

    const topError = connected ? syncState.error : "";
    const inlineError = connected ? "" : syncState.error || syncState.formError;
    if (topError) {
      refs.syncError.hidden = false;
      refs.syncError.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>' +
        "<span>" +
        escapeHtml(topError) +
        "</span>";
    } else {
      refs.syncError.hidden = true;
      refs.syncError.textContent = "";
    }
    if (inlineError) {
      refs.syncFormError.hidden = false;
      refs.syncFormError.textContent = inlineError;
    } else {
      refs.syncFormError.hidden = true;
      refs.syncFormError.textContent = "";
    }

    refs.syncConnected.hidden = !connected;
    refs.syncSetup.hidden = connected;
    refs.syncSubmit.hidden = connected;
    refs.syncCancel.textContent = connected ? "关闭" : "取消";
    refs.syncSubmit.textContent = syncState.inFlight
      ? "正在同步…"
      : config
        ? "保存并同步"
        : "连接并同步";
    refs.syncSubmit.disabled = syncState.inFlight;
    refs.syncNow.disabled = syncState.inFlight || !config;
    refs.syncEdit.disabled = syncState.inFlight;
    refs.syncDisconnect.disabled = syncState.inFlight;
    refs.syncAuto.disabled = syncState.inFlight || !config;
    refs.syncAuto.checked = Boolean(config && config.autoSync);

    refs.syncConnectedRepo.textContent = config ? config.repo : "—";
    refs.syncConnectedPath.textContent = config ? config.path : "—";
    refs.syncConnectedBranch.textContent = config ? config.branch : "—";
    refs.syncConnectedTime.textContent = config ? formatSyncTime(config.lastSyncAt) : "尚未同步";

    refs.syncTokenHint.textContent = config
      ? "留空表示沿用已保存的 Token；如需更换，粘贴新的 Token。"
      : "仅需对该仓库的 Contents 授予 Read and write 权限。";
    refs.syncToken.placeholder = config ? "已保存，留空表示不修改" : "github_pat_...";
  }

  function updateSyncRepoLink() {
    const repo = cleanText(refs.syncRepo.value, 120);
    const valid = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo);
    refs.syncRepoLink.href = valid ? "https://github.com/" + repo : "https://github.com";
    refs.syncHelpRepo.textContent = valid ? repo : "owner/repo";
  }

  function clearSyncFormErrors() {
    syncState.formError = "";
    refs.syncForm.querySelectorAll(".field.has-error").forEach((field) => {
      field.classList.remove("has-error");
    });
  }

  function showSyncFormError(message, field) {
    syncState.formError = message;
    if (field) {
      const wrapper = field.closest(".field");
      if (wrapper) wrapper.classList.add("has-error");
      field.focus();
    }
    renderSyncUi();
  }

  function fillSyncForm(config) {
    refs.syncRepo.value = config ? config.repo : SYNC_DEFAULT_REPO;
    refs.syncBranch.value = config ? config.branch : SYNC_DEFAULT_BRANCH;
    refs.syncPath.value = config ? config.path : SYNC_DEFAULT_PATH;
    refs.syncToken.value = "";
    refs.syncToken.type = "password";
    refs.syncTokenToggle.textContent = "显示";
    refs.syncTokenToggle.setAttribute("aria-label", "显示 Token");
    refs.syncAutoSetup.checked = config ? Boolean(config.autoSync) : true;
    refs.syncHelp.open = !config;
    clearSyncFormErrors();
    updateSyncRepoLink();
  }

  function openSyncDialog() {
    syncState.editing = !syncState.config;
    fillSyncForm(syncState.config);
    syncState.formError = "";
    if (!syncState.config) syncState.error = "";
    if (typeof refs.syncDialog.showModal === "function") {
      refs.syncDialog.showModal();
    } else {
      refs.syncDialog.setAttribute("open", "");
    }
    document.body.classList.add("is-dialog-open");
    renderSyncUi();
    window.setTimeout(() => {
      if (window.matchMedia("(max-width: 680px)").matches) return;
      if (syncState.config && !syncState.editing) {
        refs.syncNow.focus();
      } else {
        refs.syncToken.focus();
      }
    }, 50);
  }

  function closeSyncDialog() {
    if (refs.syncDialog.open) {
      refs.syncDialog.close();
    } else {
      refs.syncDialog.removeAttribute("open");
    }
  }

  function handleSyncCancel() {
    if (syncState.config && syncState.editing) {
      syncState.editing = false;
      syncState.formError = "";
      renderSyncUi();
      return;
    }
    closeSyncDialog();
  }

  function handleSyncSubmit() {
    if (syncState.inFlight) return;
    const previous = syncState.config;
    const token =
      refs.syncToken.value.trim() || (previous ? previous.token : "");
    const validated = validateSyncConfig({
      repo: refs.syncRepo.value,
      branch: refs.syncBranch.value,
      path: refs.syncPath.value,
      token: token,
      autoSync: refs.syncAutoSetup.checked,
      lastSyncAt: previous ? previous.lastSyncAt : null
    });

    if (!validated.config) {
      const fieldMap = {
        repo: refs.syncRepo,
        branch: refs.syncBranch,
        path: refs.syncPath,
        token: refs.syncToken
      };
      showSyncFormError(validated.error, fieldMap[validated.field]);
      return;
    }

    const config = validated.config;
    syncState.formError = "";
    syncState.error = "";
    syncState.config = config;
    syncState.editing = true;
    renderSyncUi();

    runGithubSync(config, { verify: true, persistConfig: true })
      .then(() => {
        syncState.editing = false;
        syncState.pending = false;
        syncState.status = syncState.dirty ? "pending" : "synced";
        refs.syncToken.value = "";
        renderSyncUi();
        if (syncState.dirty && syncState.config && syncState.config.autoSync) {
          scheduleGithubSync(400);
        }
        showToast(previous ? "GitHub 连接设置已更新" : "GitHub 云同步已连接");
      })
      .catch((error) => {
        syncState.config = previous;
        syncState.status = previous ? "error" : "local";
        syncState.error = describeGithubError(error);
        syncState.editing = true;
        renderSyncUi();
        showToast(syncState.error, "error");
      });
  }

  function buildLocalSyncDocument() {
    return {
      applications: state.applications,
      deletions: state.deletions,
      updatedAt: state.documentUpdatedAt || new Date().toISOString()
    };
  }

  function emptySyncDocument() {
    return { applications: [], deletions: {}, updatedAt: new Date(0).toISOString() };
  }

  function normalizeSyncDocument(raw) {
    const parsed = Array.isArray(raw) ? { applications: raw } : raw;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.applications)) {
      throw syncUserError("远程数据格式无法识别，已停止同步以避免覆盖原文件。");
    }
    return {
      applications: dedupeIds(parsed.applications.map(normalizeApplication).filter(Boolean)),
      deletions: pruneDeletions(sanitizeDeletions(parsed.deletions)),
      updatedAt:
        !Number.isNaN(Date.parse(parsed.updatedAt)) && parsed.updatedAt
          ? new Date(parsed.updatedAt).toISOString()
          : new Date(0).toISOString()
    };
  }

  function canonicalSyncApplication(application) {
    return {
      id: application.id,
      company: application.company,
      position: application.position,
      appliedAt: application.appliedAt,
      status: application.status,
      channel: application.channel,
      location: application.location,
      notes: application.notes,
      createdAt: application.createdAt,
      updatedAt: application.updatedAt
    };
  }

  function syncSignature(documentState) {
    const applications = (documentState.applications || [])
      .map(canonicalSyncApplication)
      .sort((first, second) => first.id.localeCompare(second.id));
    const deletions = {};
    Object.keys(documentState.deletions || {})
      .sort()
      .forEach((id) => {
        deletions[id] = documentState.deletions[id];
      });
    return JSON.stringify({ applications: applications, deletions: deletions });
  }

  function isSyncDocumentEqual(first, second) {
    return syncSignature(first) === syncSignature(second);
  }

  function mergeSyncDocuments(localDocument, remoteDocument) {
    const documents = [localDocument, remoteDocument].filter(Boolean);
    const applicationMap = new Map();
    const deletions = {};

    documents.forEach((documentState) => {
      (documentState.applications || []).forEach((application) => {
        const current = applicationMap.get(application.id);
        if (!current) {
          applicationMap.set(application.id, application);
          return;
        }
        const currentTime = Date.parse(current.updatedAt) || 0;
        const incomingTime = Date.parse(application.updatedAt) || 0;
        if (incomingTime >= currentTime) {
          applicationMap.set(application.id, application);
        }
      });

      Object.keys(documentState.deletions || {}).forEach((id) => {
        const incoming = Date.parse(documentState.deletions[id]);
        const current = Date.parse(deletions[id]);
        if (Number.isNaN(current) || incoming >= current) {
          deletions[id] = new Date(incoming).toISOString();
        }
      });
    });

    Object.keys(deletions).forEach((id) => {
      const application = applicationMap.get(id);
      if (!application) return;
      const deletedAt = Date.parse(deletions[id]) || 0;
      const updatedAt = Date.parse(application.updatedAt) || 0;
      if (deletedAt >= updatedAt) {
        applicationMap.delete(id);
      } else {
        delete deletions[id];
      }
    });

    const stamps = documents
      .map((documentState) => Date.parse(documentState.updatedAt))
      .filter((stamp) => !Number.isNaN(stamp));
    const updatedAt = stamps.length
      ? new Date(Math.max.apply(null, stamps)).toISOString()
      : new Date().toISOString();

    return {
      applications: Array.from(applicationMap.values()),
      deletions: pruneDeletions(deletions),
      updatedAt: updatedAt
    };
  }

  function applySyncDocument(documentState) {
    state.applications = dedupeIds(
      documentState.applications.map(normalizeApplication).filter(Boolean)
    );
    state.deletions = pruneDeletions(documentState.deletions || {});
    state.documentUpdatedAt = documentState.updatedAt || new Date().toISOString();
    saveApplications({ touch: false, skipCloudSync: true });
    render();
  }

  function encodeBase64Utf8(value) {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode.apply(
        null,
        bytes.subarray(index, index + chunkSize)
      );
    }
    return window.btoa(binary);
  }

  function decodeBase64Utf8(value) {
    const binary = window.atob(String(value).replace(/\s/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new TextDecoder().decode(bytes);
  }

  function encodeGithubPath(path) {
    return path
      .split("/")
      .filter(Boolean)
      .map((segment) => encodeURIComponent(segment))
      .join("/");
  }

  async function githubFetch(config, endpoint, options) {
    const settings = options || {};
    const headers = {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + config.token,
      "X-GitHub-Api-Version": "2022-11-28"
    };
    if (settings.body) headers["Content-Type"] = "application/json";

    let response;
    try {
      response = await fetch(SYNC_API_BASE + endpoint, {
        method: settings.method || "GET",
        headers: headers,
        body: settings.body ? JSON.stringify(settings.body) : undefined,
        cache: "no-store"
      });
    } catch (error) {
      throw syncUserError("无法连接到 GitHub，请检查网络后重试。");
    }

    if (settings.allow404 && response.status === 404) return null;

    let data = null;
    const text = await response.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (error) {
        data = null;
      }
    }

    if (!response.ok) {
      const error = new Error(
        (data && data.message) || "GitHub 请求失败（HTTP " + response.status + "）。"
      );
      error.status = response.status;
      error.apiMessage = data && data.message ? data.message : "";
      throw error;
    }
    return data;
  }

  async function verifyGithubAccess(config) {
    const repoParts = config.repo.split("/");
    const repoEndpoint =
      "/repos/" +
      encodeURIComponent(repoParts[0]) +
      "/" +
      encodeURIComponent(repoParts[1]);

    let repoInfo;
    try {
      repoInfo = await githubFetch(config, repoEndpoint);
    } catch (error) {
      if (error.status === 404) {
        throw syncUserError("找不到这个仓库，或 Token 没有访问权限。请检查仓库名与 Token 权限。");
      }
      throw error;
    }

    if (!repoInfo || repoInfo.private !== true) {
      throw syncUserError("这个仓库不是私有仓库。为避免投递信息被公开，请使用私有仓库。");
    }

    try {
      await githubFetch(
        config,
        repoEndpoint + "/branches/" + encodeURIComponent(config.branch)
      );
    } catch (error) {
      if (error.status === 404) {
        throw syncUserError("仓库中找不到分支「" + config.branch + "」，请检查分支名称。");
      }
      throw error;
    }

    return repoInfo;
  }

  async function fetchRemoteSyncDocument(config) {
    const repoParts = config.repo.split("/");
    const endpoint =
      "/repos/" +
      encodeURIComponent(repoParts[0]) +
      "/" +
      encodeURIComponent(repoParts[1]) +
      "/contents/" +
      encodeGithubPath(config.path) +
      "?ref=" +
      encodeURIComponent(config.branch);

    const file = await githubFetch(config, endpoint, { allow404: true });
    if (!file) return null;
    if (file.type && file.type !== "file") {
      throw syncUserError("数据路径指向的不是文件，请更换数据文件路径。");
    }

    let content = "";
    if (file.encoding === "base64" && file.content) {
      content = decodeBase64Utf8(file.content);
    } else if (file.download_url) {
      const rawResponse = await fetch(file.download_url, {
        headers: {
          Authorization: "Bearer " + config.token,
          Accept: "application/vnd.github.raw"
        },
        cache: "no-store"
      });
      if (!rawResponse.ok) {
        throw syncUserError("无法读取远程数据文件，请检查 Token 权限。");
      }
      content = await rawResponse.text();
    }

    if (!content.trim()) {
      return { sha: file.sha, document: emptySyncDocument() };
    }

    let parsed;
    try {
      parsed = JSON.parse(content.replace(/^\uFEFF/, ""));
    } catch (error) {
      throw syncUserError("远程数据文件不是有效的 JSON，已停止同步以避免覆盖原文件。");
    }
    return { sha: file.sha, document: normalizeSyncDocument(parsed) };
  }

  async function putRemoteSyncDocument(config, documentState, sha) {
    const repoParts = config.repo.split("/");
    const endpoint =
      "/repos/" +
      encodeURIComponent(repoParts[0]) +
      "/" +
      encodeURIComponent(repoParts[1]) +
      "/contents/" +
      encodeGithubPath(config.path);

    const payload = {
      message:
        "chore: sync qiuzhao applications (" +
        documentState.applications.length +
        " records)",
      content: encodeBase64Utf8(
        JSON.stringify(
          Object.assign({ app: "投递簿", version: 2 }, documentState),
          null,
          2
        )
      ),
      branch: config.branch
    };
    if (sha) payload.sha = sha;

    return githubFetch(config, endpoint, { method: "PUT", body: payload });
  }

  function isGithubConflict(error) {
    return Boolean(error && (error.status === 409 || error.status === 422));
  }

  function describeGithubError(error) {
    if (!error) return "GitHub 同步失败，请稍后重试。";
    if (error.isUserFacing) return error.message;
    if (navigator.onLine === false) return "当前处于离线状态，网络恢复后会自动重试。";
    if (error.status === 401) return "Token 无效或已过期，请重新生成并更新 Token。";
    if (error.status === 403) {
      return "Token 权限不足，或 GitHub API 暂时限制了请求。请检查 Contents 写入权限后重试。";
    }
    if (error.status === 404) return "找不到仓库、分支或数据文件，或 Token 没有访问权限。";
    if (error.status === 409 || error.status === 422) {
      return "远程数据刚刚被其他设备更新，请再次点击同步。";
    }
    if (error.status >= 500) return "GitHub 服务暂时不可用，请稍后重试。";
    if (error.name === "TypeError") return "无法连接到 GitHub，请检查网络后重试。";
    return error.message || "GitHub 同步失败，请稍后重试。";
  }

  async function runGithubSync(config, options) {
    const settings = options || {};
    const startChangeVersion = syncState.changeVersion;
    syncState.inFlight = true;
    syncState.status = "syncing";
    syncState.error = "";
    syncState.lastAttemptAt = Date.now();
    renderSyncUi();

    try {
      if (settings.verify) {
        await verifyGithubAccess(config);
      }

      let remoteEntry = await fetchRemoteSyncDocument(config);
      let localDocument = buildLocalSyncDocument();
      let merged = mergeSyncDocuments(
        localDocument,
        remoteEntry ? remoteEntry.document : null
      );
      let localChanged = false;

      if (!isSyncDocumentEqual(localDocument, merged)) {
        applySyncDocument(merged);
        localChanged = true;
        localDocument = merged;
      }

      let uploaded = false;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const remoteDocument = remoteEntry ? remoteEntry.document : null;
        if (remoteDocument && isSyncDocumentEqual(remoteDocument, merged)) break;

        const payload = Object.assign({}, merged, {
          updatedAt: new Date().toISOString()
        });
        try {
          await putRemoteSyncDocument(
            config,
            payload,
            remoteEntry ? remoteEntry.sha : null
          );
          uploaded = true;
          merged = payload;
          state.documentUpdatedAt = payload.updatedAt;
          saveApplications({ touch: false, skipCloudSync: true });
          break;
        } catch (error) {
          if (isGithubConflict(error) && attempt < 2) {
            remoteEntry = await fetchRemoteSyncDocument(config);
            merged = mergeSyncDocuments(
              buildLocalSyncDocument(),
              remoteEntry ? remoteEntry.document : null
            );
            if (!isSyncDocumentEqual(buildLocalSyncDocument(), merged)) {
              applySyncDocument(merged);
              localChanged = true;
            }
            continue;
          }
          throw error;
        }
      }

      const syncedAt = new Date().toISOString();
      config.lastSyncAt = syncedAt;
      syncState.config = config;
      syncState.lastSyncAt = Date.parse(syncedAt);
      storeSyncConfig(config);

      const changedDuringSync = syncState.changeVersion !== startChangeVersion;
      syncState.dirty = changedDuringSync;
      syncState.status = changedDuringSync ? "pending" : "synced";
      syncState.error = "";
      syncState.notifiedError = false;
      return { uploaded: uploaded, localChanged: localChanged };
    } catch (error) {
      syncState.status = navigator.onLine === false ? "offline" : "error";
      syncState.error = describeGithubError(error);
      syncState.dirty = true;
      throw error;
    } finally {
      syncState.inFlight = false;
      renderSyncUi();
    }
  }

  async function syncGithub(options) {
    const settings = options || {};
    const config = syncState.config;

    if (!config) {
      if (settings.manual) openSyncDialog();
      return null;
    }
    if (syncState.syncPromise) {
      syncState.pending = true;
      return syncState.syncPromise;
    }
    if (syncState.inFlight) {
      syncState.pending = true;
      return null;
    }
    if (navigator.onLine === false) {
      syncState.status = "offline";
      syncState.error = "当前处于离线状态，网络恢复后会自动重试。";
      renderSyncUi();
      if (settings.manual) showToast(syncState.error, "error");
      return null;
    }

    if (syncState.timer) {
      window.clearTimeout(syncState.timer);
      syncState.timer = null;
    }
    syncState.pending = false;

    const promise = runGithubSync(config, { verify: false, persistConfig: true });
    syncState.syncPromise = promise;
    try {
      const result = await promise;
      if (settings.manual) {
        showToast(
          result.localChanged
            ? "已同步，并更新了本地记录"
            : "GitHub 同步完成"
        );
      } else if (result.localChanged) {
        showToast("已从 GitHub 同步最新投递记录");
      }
      syncState.notifiedError = false;
      return result;
    } catch (error) {
      if (settings.manual) {
        showToast(describeGithubError(error), "error");
      } else if (!syncState.notifiedError) {
        syncState.notifiedError = true;
        showToast("GitHub 自动同步失败，请打开「数据 → GitHub 云同步」查看原因。", "error");
      }
      return null;
    } finally {
      syncState.syncPromise = null;
      if (syncState.pending) {
        syncState.pending = false;
        window.setTimeout(function () {
          if (syncState.config && syncState.config.autoSync) {
            syncGithub({ reason: "pending" });
          }
        }, 350);
      }
    }
  }

  function scheduleGithubSync(delay) {
    if (!syncState.config || !syncState.config.autoSync) return;
    if (syncState.timer) {
      window.clearTimeout(syncState.timer);
      syncState.timer = null;
    }
    if (syncState.inFlight) {
      syncState.pending = true;
      return;
    }
    if (syncState.status !== "error") syncState.status = "pending";
    renderSyncUi();
    syncState.timer = window.setTimeout(function () {
      syncState.timer = null;
      syncGithub({ reason: "change" });
    }, typeof delay === "number" ? delay : SYNC_DEBOUNCE_MS);
  }

  function onLocalDataChanged() {
    syncState.changeVersion += 1;
    if (!syncState.config) return;
    syncState.dirty = true;
    if (syncState.config.autoSync) {
      scheduleGithubSync();
    } else {
      if (!syncState.inFlight) syncState.status = "pending";
      renderSyncUi();
    }
  }

  function maybeSyncOnFocus() {
    if (!syncState.config || !syncState.config.autoSync) return;
    if (document.visibilityState !== "visible") return;
    if (syncState.inFlight) return;
    if (Date.now() - syncState.lastAttemptAt < SYNC_FOCUS_THROTTLE_MS) return;
    syncGithub({ reason: "focus" });
  }


  /* ---------- Events ---------- */

  document.addEventListener("click", function (event) {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const syncOpen = target.closest("[data-open-sync]");
    if (syncOpen) {
      openSyncDialog();
      return;
    }

    const syncClose = target.closest("[data-close-sync]");
    if (syncClose) {
      closeSyncDialog();
      return;
    }

    const importOpen = target.closest("[data-open-import]");
    if (importOpen) {
      openImportDialog();
      return;
    }

    const importClose = target.closest("[data-close-import]");
    if (importClose) {
      closeImportDialog();
      return;
    }

    const templateButton = target.closest("[data-download-template]");
    if (templateButton) {
      event.preventDefault();
      downloadExcelTemplate();
      return;
    }

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
      if (action === "github-sync") openSyncDialog();
      if (action === "import-excel") openImportDialog();
      if (action === "download-template") downloadExcelTemplate();
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

  refs.importDialog.addEventListener("close", function () {
    resetImportDialog();
    if (!document.querySelector("dialog[open]")) {
      document.body.classList.remove("is-dialog-open");
    }
  });

  refs.syncDialog.addEventListener("close", function () {
    syncState.editing = false;
    syncState.formError = "";
    refs.syncToken.value = "";
    refs.syncToken.type = "password";
    refs.syncTokenToggle.textContent = "显示";
    refs.syncTokenToggle.setAttribute("aria-label", "显示 Token");
    if (!document.querySelector("dialog[open]")) {
      document.body.classList.remove("is-dialog-open");
    }
    renderSyncUi();
  });

  [refs.applicationDialog, refs.confirmDialog, refs.importDialog, refs.syncDialog].forEach((dialog) => {
    dialog.addEventListener("click", function (event) {
      if (event.target !== dialog) return;
      if (dialog === refs.confirmDialog) {
        closeConfirmDialog();
      } else if (dialog === refs.importDialog) {
        closeImportDialog();
      } else if (dialog === refs.syncDialog) {
        closeSyncDialog();
      } else {
        closeApplicationDialog();
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

  refs.excelDropzone.addEventListener("click", function (event) {
    if (event.target.closest("[data-download-template]")) return;
    refs.excelFile.click();
  });

  refs.excelDropzone.addEventListener("dragover", function (event) {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    refs.excelDropzone.classList.add("is-dragover");
  });

  refs.excelDropzone.addEventListener("dragleave", function (event) {
    if (!refs.excelDropzone.contains(event.relatedTarget)) {
      refs.excelDropzone.classList.remove("is-dragover");
    }
  });

  refs.excelDropzone.addEventListener("drop", function (event) {
    event.preventDefault();
    refs.excelDropzone.classList.remove("is-dragover");
    const file =
      event.dataTransfer && event.dataTransfer.files
        ? event.dataTransfer.files[0]
        : null;
    if (file) parseExcelFile(file);
  });

  refs.excelFile.addEventListener("change", function () {
    const file = refs.excelFile.files && refs.excelFile.files[0];
    refs.excelFile.value = "";
    if (file) parseExcelFile(file);
  });

  refs.importReselect.addEventListener("click", function () {
    clearImportError();
    refs.excelFile.click();
  });

  refs.importSkipDuplicates.addEventListener("change", function () {
    importState.skipDuplicates = refs.importSkipDuplicates.checked;
    renderImportResult();
  });

  refs.confirmImport.addEventListener("click", confirmExcelImport);

  refs.syncForm.addEventListener("submit", function (event) {
    event.preventDefault();
    handleSyncSubmit();
  });

  refs.syncForm.addEventListener("keydown", function (event) {
    if (event.key !== "Enter" || event.isComposing) return;
    if (!(event.target instanceof HTMLInputElement)) return;
    event.preventDefault();
    handleSyncSubmit();
  });

  refs.syncForm.addEventListener("input", function (event) {
    const field = event.target.closest(".field");
    if (field) field.classList.remove("has-error");
    if (syncState.formError) {
      syncState.formError = "";
      renderSyncUi();
    }
  });

  refs.syncRepo.addEventListener("input", updateSyncRepoLink);

  refs.syncSubmit.addEventListener("click", handleSyncSubmit);
  refs.syncCancel.addEventListener("click", handleSyncCancel);

  refs.syncNow.addEventListener("click", function () {
    syncGithub({ manual: true });
  });

  refs.syncEdit.addEventListener("click", function () {
    syncState.editing = true;
    fillSyncForm(syncState.config);
    refs.syncHelp.open = false;
    renderSyncUi();
    window.setTimeout(() => refs.syncToken.focus(), 50);
  });

  refs.syncDisconnect.addEventListener("click", function () {
    const confirmed = window.confirm(
      "确定断开这台设备的 GitHub 同步吗？\n云端仓库中的数据不会被删除，本地记录也会保留。"
    );
    if (!confirmed) return;
    try {
      window.localStorage.removeItem(SYNC_CONFIG_KEY);
    } catch (error) {
      /* The in-memory connection is still removed below. */
    }
    if (syncState.timer) {
      window.clearTimeout(syncState.timer);
      syncState.timer = null;
    }
    syncState.config = null;
    syncState.status = "local";
    syncState.error = "";
    syncState.formError = "";
    syncState.dirty = false;
    syncState.lastSyncAt = 0;
    syncState.editing = true;
    fillSyncForm(null);
    renderSyncUi();
    showToast("已断开 GitHub 云同步，本地记录仍然保留");
  });

  refs.syncAuto.addEventListener("change", function () {
    if (!syncState.config) return;
    syncState.config.autoSync = refs.syncAuto.checked;
    storeSyncConfig(syncState.config);
    refs.syncAutoSetup.checked = refs.syncAuto.checked;
    if (!syncState.config.autoSync && syncState.timer) {
      window.clearTimeout(syncState.timer);
      syncState.timer = null;
    }
    if (syncState.config.autoSync) {
      scheduleGithubSync(300);
    }
    renderSyncUi();
  });

  refs.syncTokenToggle.addEventListener("click", function () {
    const showing = refs.syncToken.type === "text";
    refs.syncToken.type = showing ? "password" : "text";
    refs.syncTokenToggle.textContent = showing ? "显示" : "隐藏";
    refs.syncTokenToggle.setAttribute("aria-label", showing ? "显示 Token" : "隐藏 Token");
  });

  window.addEventListener("storage", function (event) {
    if (event.key === STORAGE_KEY) {
      const documentState = loadLocalDocument();
      state.applications = documentState.applications;
      state.deletions = documentState.deletions;
      state.documentUpdatedAt = documentState.updatedAt;
      render();
    }
    if (event.key === SYNC_CONFIG_KEY) {
      syncState.config = loadSyncConfig();
      syncState.lastSyncAt = syncState.config
        ? Date.parse(syncState.config.lastSyncAt) || 0
        : 0;
      syncState.status = syncState.config ? "idle" : "local";
      renderSyncUi();
    }
  });

  window.addEventListener("focus", maybeSyncOnFocus);
  document.addEventListener("visibilitychange", maybeSyncOnFocus);
  window.setInterval(function () {
    if (!syncState.config || !syncState.config.autoSync) return;
    if (document.visibilityState !== "visible") return;
    if (syncState.inFlight || syncState.syncPromise) return;
    if (Date.now() - syncState.lastAttemptAt < 55000) return;
    syncGithub({ reason: "poll" });
  }, 60000);
  window.addEventListener("online", function () {
    if (!syncState.config) return;
    if (syncState.status === "offline") {
      syncState.status = syncState.dirty ? "pending" : "idle";
      syncState.error = "";
      renderSyncUi();
    }
    if (syncState.config.autoSync) {
      syncState.lastAttemptAt = 0;
      syncGithub({ reason: "online" });
    }
  });
  window.addEventListener("offline", function () {
    if (!syncState.config) return;
    syncState.status = "offline";
    syncState.error = "当前处于离线状态，网络恢复后会自动重试。";
    renderSyncUi();
  });

  /* ---------- Initialization ---------- */

  initFormOptions();
  const initialDocument = loadLocalDocument();
  state.applications = initialDocument.applications;
  state.deletions = initialDocument.deletions;
  state.documentUpdatedAt = initialDocument.updatedAt;
  syncState.config = loadSyncConfig();
  syncState.lastSyncAt = syncState.config ? Date.parse(syncState.config.lastSyncAt) || 0 : 0;
  syncState.status = syncState.config ? "idle" : "local";
  if (
    syncState.config &&
    initialDocument.updatedAt &&
    (!syncState.config.lastSyncAt ||
      Date.parse(initialDocument.updatedAt) > Date.parse(syncState.config.lastSyncAt))
  ) {
    syncState.dirty = true;
    syncState.status = "pending";
  }
  try {
    const storedView = window.localStorage.getItem(VIEW_KEY);
    if (storedView === "board" || storedView === "list") state.view = storedView;
  } catch (error) {
    state.view = "list";
  }

  render();
  renderSyncUi();
  if (syncState.config && syncState.config.autoSync) {
    window.setTimeout(() => syncGithub({ reason: "startup" }), 700);
  }

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
