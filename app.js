(function () {
  "use strict";

  var STORAGE_KEY = "workflow_app_v1";
  var SESSION_KEY = "workflow_session_user";

  var STATUS = { TODO: "TODO", IN_PROGRESS: "IN_PROGRESS", DONE: "DONE" };
  var PRIORITY = { LOW: "LOW", MED: "MED", HIGH: "HIGH" };
  var ISSUE_STATUS = { OPEN: "OPEN", IN_PROGRESS: "IN_PROGRESS", RESOLVED: "RESOLVED" };
  var MAX_ATTACHMENT_BYTES = 1024 * 1024;
  var REPEAT = {
    NONE: "NONE",
    WEEKLY: "WEEKLY",
    MONTHLY_DATE: "MONTHLY_DATE",
    MONTHLY_WEEKDAY: "MONTHLY_WEEKDAY",
  };

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function id() {
    return "id_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  function todayISODate() {
    var d = new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function parseISODate(s) {
    if (!s) return null;
    var p = s.split("-").map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  }

  function compareDate(a, b) {
    if (a === b) return 0;
    return a < b ? -1 : 1;
  }

  function addDaysIso(iso, days) {
    var d = parseISODate(iso);
    if (!d || isNaN(d.getTime())) return iso;
    d.setDate(d.getDate() + days);
    return isoFromDate(d);
  }

  function daysBetweenInclusive(startIso, endIso) {
    var a = parseISODate(startIso);
    var b = parseISODate(endIso);
    if (!a || !b || isNaN(a.getTime()) || isNaN(b.getTime())) return 0;
    return Math.round((b - a) / 86400000);
  }

  function computeWeekOrdinalForDom(year, month0, day) {
    var wd = new Date(year, month0, day).getDay();
    var ord = 0;
    for (var d = 1; d <= day; d++) {
      if (new Date(year, month0, d).getDay() === wd) ord++;
    }
    return { weekday: wd, ordinal: ord };
  }

  function nthWeekdayInMonth(year, month0, weekday, ordinal) {
    var d = new Date(year, month0, 1);
    while (d.getMonth() === month0 && d.getDay() !== weekday) {
      d.setDate(d.getDate() + 1);
    }
    if (d.getMonth() !== month0) return null;
    d.setDate(d.getDate() + (ordinal - 1) * 7);
    if (d.getMonth() !== month0) return null;
    return d;
  }

  function scheduleRepeatUntilDate(s) {
    if (s.repeatUntil && String(s.repeatUntil).length >= 10) return s.repeatUntil;
    return addDaysIso(s.startDate, 730);
  }

  function scheduleTouchesDate(s, iso) {
    var until = scheduleRepeatUntilDate(s);
    if (compareDate(iso, until) > 0) return false;
    var rt = s.repeatType || REPEAT.NONE;
    if (rt === REPEAT.NONE || !s.repeatType) {
      return compareDate(iso, s.startDate) >= 0 && compareDate(iso, s.endDate) <= 0;
    }
    if (compareDate(iso, s.startDate) < 0) return false;
    if (rt === REPEAT.WEEKLY) {
      var n = 0;
      while (n < 520) {
        var segStart = addDaysIso(s.startDate, n * 7);
        var segEnd = addDaysIso(s.endDate, n * 7);
        if (compareDate(segStart, until) > 0) break;
        if (compareDate(iso, segStart) >= 0 && compareDate(iso, segEnd) <= 0) return true;
        n++;
      }
      return false;
    }
    if (rt === REPEAT.MONTHLY_DATE) {
      var ds = parseISODate(s.startDate);
      var di = parseISODate(iso);
      if (!ds || !di) return false;
      var last = new Date(di.getFullYear(), di.getMonth() + 1, 0).getDate();
      var targetDay = Math.min(ds.getDate(), last);
      return di.getDate() === targetDay;
    }
    if (rt === REPEAT.MONTHLY_WEEKDAY) {
      var di2 = parseISODate(iso);
      if (!di2) return false;
      var wd = s.repeatWeekday;
      var ord = s.repeatMonthOrdinal;
      if (wd == null || ord == null) {
        var sd0 = parseISODate(s.startDate);
        if (!sd0 || isNaN(sd0.getTime())) return false;
        var m0 = computeWeekOrdinalForDom(sd0.getFullYear(), sd0.getMonth(), sd0.getDate());
        wd = m0.weekday;
        ord = m0.ordinal;
      }
      var t = nthWeekdayInMonth(di2.getFullYear(), di2.getMonth(), wd, ord);
      return t != null && isoFromDate(t) === iso;
    }
    return false;
  }

  function htmlRepeatFields(selected, untilVal) {
    var sel = selected || REPEAT.NONE;
    var u = untilVal || "";
    return (
      "<div><label>반복</label>" +
      '<select class="select-field" name="repeatType">' +
      '<option value="NONE"' +
      (sel === "NONE" ? " selected" : "") +
      ">해당 일정만 (반복 없음)</option>" +
      '<option value="WEEKLY"' +
      (sel === "WEEKLY" ? " selected" : "") +
      ">매주 같은 요일·기간 반복</option>" +
      '<option value="MONTHLY_DATE"' +
      (sel === "MONTHLY_DATE" ? " selected" : "") +
      ">매월 같은 날짜 반복</option>" +
      '<option value="MONTHLY_WEEKDAY"' +
      (sel === "MONTHLY_WEEKDAY" ? " selected" : "") +
      ">매월 같은 순서 요일 반복 (예: 둘째 화요일)</option>" +
      "</select>" +
      '<p class="small muted" style="margin:6px 0 0">시작·종료일이 <b>첫 번째</b> 일정 구간입니다. 반복 종료일 미입력 시 약 2년간 표시됩니다.</p></div>' +
      "<div><label>반복 종료일 (선택)</label>" +
      '<input class="input input-date" type="date" name="repeatUntil" value="' +
      escapeHtml(u) +
      '"/></div>'
    );
  }

  function applyRepeatMetaFromStart(sch, startDate) {
    var d = parseISODate(startDate);
    if (!d || isNaN(d.getTime())) return;
    if (sch.repeatType === REPEAT.MONTHLY_WEEKDAY) {
      var m = computeWeekOrdinalForDom(d.getFullYear(), d.getMonth(), d.getDate());
      sch.repeatWeekday = m.weekday;
      sch.repeatMonthOrdinal = m.ordinal;
    } else {
      sch.repeatWeekday = null;
      sch.repeatMonthOrdinal = null;
    }
  }

  function isOverdueTask(t) {
    if (!t.dueDate || t.status === STATUS.DONE) return false;
    return compareDate(t.dueDate, todayISODate()) < 0;
  }

  function defaultState() {
    return {
      teamName: "디지털L&D센터 TeamFlow",
      meta: { syncedDueCalendar: false },
      users: [
        {
          id: "u_admin",
          name: "박 관리",
          email: "admin@demo.com",
          password: "demo123",
          role: "ADMIN",
          org1: "디지털L&D센터",
          org2: "운영본부",
          org3: "",
          jobTitle: "센터장",
          jobRank: "임원",
        },
        {
          id: "u_kim",
          name: "김 팀원",
          email: "kim@demo.com",
          password: "demo123",
          role: "MEMBER",
          org1: "디지털L&D센터",
          org2: "교육팀",
          org3: "1파트",
          jobTitle: "교육기획",
          jobRank: "책임",
        },
        {
          id: "u_lee",
          name: "이 팀원",
          email: "lee@demo.com",
          password: "demo123",
          role: "MEMBER",
          org1: "디지털L&D센터",
          org2: "교육팀",
          org3: "2파트",
          jobTitle: "운영담당",
          jobRank: "선임",
        },
      ],
      tasks: [],
      schedules: [],
      issues: [],
      comments: [],
      attachments: [],
      activityLogs: [],
    };
  }

  function seedDemoData(s) {
    var t1 = id();
    var t2 = id();
    var t3 = id();
    var today = todayISODate();
    var parts = today.split("-");
    var y = Number(parts[0]);
    var m = Number(parts[1]);
    var d = Number(parts[2]);
    function iso(y0, m0, d0) {
      return (
        y0 +
        "-" +
        String(m0).padStart(2, "0") +
        "-" +
        String(d0).padStart(2, "0")
      );
    }
    var soon = iso(y, m, Math.min(28, d + 3));
    var late = iso(y, m, Math.max(1, d - 5));

    s.tasks = [
      {
        id: t1,
        title: "요구사항 정리",
        description: "기능 정의서와 화면 IA를 맞춥니다.",
        assigneeId: "u_kim",
        status: STATUS.IN_PROGRESS,
        priority: PRIORITY.HIGH,
        dueDate: soon,
        dependsOnTaskId: null,
        createdById: "u_admin",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: t2,
        title: "캘린더 UI 구현",
        description: "월 뷰 및 캘린더 표시",
        assigneeId: "u_lee",
        status: STATUS.TODO,
        priority: PRIORITY.MED,
        dueDate: today,
        dependsOnTaskId: t1,
        createdById: "u_kim",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: t3,
        title: "대시보드 KPI",
        description: "진행률·지연률 카드",
        assigneeId: "u_admin",
        status: STATUS.DONE,
        priority: PRIORITY.LOW,
        dueDate: late,
        dependsOnTaskId: null,
        createdById: "u_admin",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    s.schedules = [
      {
        id: id(),
        title: "스프린트 계획",
        startDate: today,
        endDate: soon,
        relatedTaskId: t1,
        ownerId: "u_kim",
        fromTaskDue: false,
        repeatType: REPEAT.NONE,
        repeatUntil: null,
        repeatWeekday: null,
        repeatMonthOrdinal: null,
        createdAt: new Date().toISOString(),
      },
    ];

    s.issues = [
      {
        id: id(),
        title: "마감일 산정 기준 불명확",
        description: "팀 타임존 기준을 문서에 명시 필요",
        taskId: t1,
        status: ISSUE_STATUS.OPEN,
        priority: PRIORITY.HIGH,
        reporterId: "u_lee",
        createdAt: new Date().toISOString(),
      },
    ];

    s.comments = [
      {
        id: id(),
        taskId: t1,
        userId: "u_kim",
        content: "우선 MVP 범위부터 확정하겠습니다.",
        createdAt: new Date().toISOString(),
      },
    ];

    s.activityLogs = [
      {
        id: id(),
        taskId: t1,
        userId: "u_admin",
        message: "업무가 생성되었습니다.",
        createdAt: new Date().toISOString(),
      },
    ];

    s.tasks.forEach(function (task) {
      syncDueDateScheduleForTask(s, task);
    });
    s.meta = s.meta || {};
    s.meta.syncedDueCalendar = true;
  }

  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        var s = defaultState();
        seedDemoData(s);
        saveState(s);
        return s;
      }
      var parsed = JSON.parse(raw);
      parsed.users.forEach(function (u) {
        if (u.org1 === undefined) u.org1 = "";
        if (u.org2 === undefined) u.org2 = "";
        if (u.org3 === undefined) u.org3 = "";
        if (u.jobTitle === undefined) u.jobTitle = "";
        if (u.jobRank === undefined) u.jobRank = "";
      });
      parsed.schedules.forEach(function (sc) {
        if (!sc.repeatType) sc.repeatType = REPEAT.NONE;
      });
      if (!parsed.meta) parsed.meta = {};
      if (!parsed.meta.syncedDueCalendar) {
        parsed.tasks.forEach(function (t) {
          if (t.dueDate) syncDueDateScheduleForTask(parsed, t);
        });
        parsed.meta.syncedDueCalendar = true;
        saveState(parsed);
      }
      return parsed;
    } catch (e) {
      var fresh = defaultState();
      seedDemoData(fresh);
      return fresh;
    }
  }

  function saveState(s) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  }

  function getSessionUserId() {
    return sessionStorage.getItem(SESSION_KEY);
  }

  function setSessionUserId(uid) {
    sessionStorage.setItem(SESSION_KEY, uid);
  }

  function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
  }

  function getUser(state, uid) {
    return state.users.find(function (u) {
      return u.id === uid;
    });
  }

  function isAdmin(state, uid) {
    var u = getUser(state, uid);
    return u && u.role === "ADMIN";
  }

  function addActivity(state, taskId, userId, message) {
    state.activityLogs.unshift({
      id: id(),
      taskId: taskId,
      userId: userId,
      message: message,
      createdAt: new Date().toISOString(),
    });
  }

  function taskById(state, tid) {
    return state.tasks.find(function (t) {
      return t.id === tid;
    });
  }

  function syncDueDateScheduleForTask(state, task) {
    state.schedules = state.schedules.filter(function (s) {
      return !(s.fromTaskDue === true && s.relatedTaskId === task.id);
    });
    if (!task.dueDate) return;
    state.schedules.push({
      id: id(),
      title: "[마감] " + task.title,
      startDate: task.dueDate,
      endDate: task.dueDate,
      relatedTaskId: task.id,
      ownerId: task.assigneeId,
      fromTaskDue: true,
      repeatType: REPEAT.NONE,
      repeatUntil: null,
      repeatWeekday: null,
      repeatMonthOrdinal: null,
      createdAt: new Date().toISOString(),
    });
  }

  function wouldCreateCycle(state, taskId, newDepId) {
    if (!newDepId) return false;
    if (newDepId === taskId) return true;
    var visited = {};
    function walk(cur) {
      if (visited[cur]) return false;
      visited[cur] = true;
      var t = taskById(state, cur);
      if (!t || !t.dependsOnTaskId) return false;
      if (t.dependsOnTaskId === taskId) return true;
      return walk(t.dependsOnTaskId);
    }
    return walk(newDepId);
  }

  function schedulesOverlap(aStart, aEnd, bStart, bEnd) {
    return compareDate(aStart, bEnd) <= 0 && compareDate(bStart, aEnd) <= 0;
  }

  function findScheduleOverlaps(state, sched, excludeId) {
    var hits = [];
    state.schedules.forEach(function (s) {
      if (excludeId && s.id === excludeId) return;
      if (s.ownerId !== sched.ownerId) return;
      if (schedulesOverlap(sched.startDate, sched.endDate, s.startDate, s.endDate)) {
        hits.push(s);
      }
    });
    return hits;
  }

  function buildScheduleEditorFormHTML(state, s) {
    var ownerOpts = state.users
      .map(function (u) {
        return (
          '<option value="' +
          escapeHtml(u.id) +
          '"' +
          (u.id === s.ownerId ? " selected" : "") +
          ">" +
          escapeHtml(u.name) +
          "</option>"
        );
      })
      .join("");
    var taskOpts =
      '<option value="">(연결 없음)</option>' +
      state.tasks
        .map(function (t) {
          return (
            '<option value="' +
            escapeHtml(t.id) +
            '"' +
            (s.relatedTaskId === t.id ? " selected" : "") +
            ">" +
            escapeHtml(t.title) +
            "</option>"
          );
        })
        .join("");
    var syncHint =
      s.relatedTaskId && taskById(state, s.relatedTaskId)
        ? '<p class="small muted" style="margin-top:0">연결된 업무가 있으면 저장 시 업무의 <b>마감일(종료일)</b>·<b>담당자</b>가 여기 값과 동일하게 맞춰집니다.</p>'
        : '<p class="small muted" style="margin-top:0">관련 업무를 선택하면 위와 같이 업무 페이지에도 반영됩니다.</p>';
    var repeatBlock =
      s.fromTaskDue === true
        ? '<p class="small muted">마감 연동 일정은 <b>반복 없음</b>만 가능합니다.</p><input type="hidden" name="repeatType" value="NONE"/><input type="hidden" name="repeatUntil" value=""/>'
        : htmlRepeatFields(s.repeatType || REPEAT.NONE, s.repeatUntil || "");
    return (
      syncHint +
      '<form id="form-edit-schedule" class="form-grid" style="max-width:100%">' +
      '<input type="hidden" name="scheduleId" value="' +
      escapeHtml(s.id) +
      '"/>' +
      "<div><label>캘린더 제목</label>" +
      '<input class="input" name="title" required value="' +
      escapeHtml(s.title) +
      '"/></div>' +
      "<div><label>시작일</label>" +
      '<input class="input input-date" type="date" name="startDate" required value="' +
      escapeHtml(s.startDate) +
      '"/></div>' +
      "<div><label>종료일</label>" +
      '<input class="input input-date" type="date" name="endDate" required value="' +
      escapeHtml(s.endDate) +
      '"/></div>' +
      "<div><label>담당자</label><select class=\"select-field\" name=\"ownerId\">" +
      ownerOpts +
      "</select></div>" +
      "<div><label>관련 업무</label><select class=\"select-field\" name=\"relatedTaskId\">" +
      taskOpts +
      "</select></div>" +
      repeatBlock +
      '<div class="row">' +
      '<button type="submit" class="btn btn-primary">저장</button>' +
      "</div></form>"
    );
  }

  function parseRoute() {
    var h = (location.hash || "#/dashboard").replace(/^#/, "") || "/dashboard";
    if (h.charAt(0) !== "/") h = "/" + h;
    var raw = h;
    var pathOnly = h.split("?")[0];
    var parts = pathOnly.split("/").filter(Boolean);
    return { parts: parts, raw: raw };
  }

  function navigate(path) {
    var p = String(path || "").replace(/^#/, "");
    if (p.charAt(0) !== "/") p = "/" + p;
    var nextHash = "#" + p;
    if ((location.hash || "") === nextHash) {
      renderApp();
      return;
    }
    location.hash = nextHash;
  }

  function statusLabel(st) {
    if (st === STATUS.TODO) return "To-do";
    if (st === STATUS.IN_PROGRESS) return "In Progress";
    if (st === STATUS.DONE) return "Done";
    return st;
  }

  function priorityLabel(p) {
    if (p === PRIORITY.HIGH) return "높음";
    if (p === PRIORITY.MED) return "보통";
    if (p === PRIORITY.LOW) return "낮음";
    return p;
  }

  function issueStatusLabel(s) {
    if (s === ISSUE_STATUS.OPEN) return "Open";
    if (s === ISSUE_STATUS.IN_PROGRESS) return "In Progress";
    if (s === ISSUE_STATUS.RESOLVED) return "Resolved";
    return s;
  }

  function tagClassForStatus(st) {
    if (st === STATUS.TODO) return "tag tag-todo";
    if (st === STATUS.IN_PROGRESS) return "tag tag-progress";
    return "tag tag-done";
  }

  function tagClassForPriority(p) {
    if (p === PRIORITY.HIGH) return "tag tag-high";
    if (p === PRIORITY.MED) return "tag tag-med";
    return "tag tag-low";
  }

  function renderHeader(state, uid, activePath) {
    var u = getUser(state, uid);
    if (!u) return "";
    var adminLink =
      u.role === "ADMIN"
        ? '<a class="' +
          (activePath.indexOf("/settings") === 0 ? "active" : "") +
          '" href="#/settings">설정</a>'
        : "";
    return (
      '<header class="app-header">' +
      '<div class="brand">' +
      escapeHtml(state.teamName || "TeamFlow") +
      "</div>" +
      '<nav class="nav">' +
      '<a class="' +
      (activePath === "/dashboard" ? "active" : "") +
      '" href="#/dashboard">대시보드</a>' +
      '<a class="' +
      (activePath.indexOf("/tasks") === 0 ? "active" : "") +
      '" href="#/tasks">업무</a>' +
      '<a class="' +
      (activePath.indexOf("/calendar") === 0 ? "active" : "") +
      '" href="#/calendar">캘린더</a>' +
      '<a class="' +
      (activePath.indexOf("/issues") === 0 ? "active" : "") +
      '" href="#/issues">이슈</a>' +
      '<a class="' +
      (activePath.indexOf("/members") === 0 ? "active" : "") +
      '" href="#/members">회원관리</a>' +
      adminLink +
      "</nav>" +
      '<div class="user-pill">' +
      '<span class="badge-role">' +
      (u.role === "ADMIN" ? "Admin" : "Member") +
      "</span>" +
      "<span>" +
      escapeHtml(u.name) +
      "</span>" +
      '<button type="button" class="btn btn-ghost" id="btn-logout">로그아웃</button>' +
      "</div>" +
      "</header>"
    );
  }

  function computeDashboard(state) {
    var tasks = state.tasks;
    var total = tasks.length;
    var done = tasks.filter(function (t) {
      return t.status === STATUS.DONE;
    }).length;
    var delayed = tasks.filter(isOverdueTask);
    var progressPct = total ? Math.round((done / total) * 100) : 0;
    var delayRate = total ? Math.round((delayed.length / total) * 100) : 0;
    var openIssues = state.issues.filter(function (i) {
      return i.status !== ISSUE_STATUS.RESOLVED;
    });
    var todoC = tasks.filter(function (t) {
      return t.status === STATUS.TODO;
    }).length;
    var progC = tasks.filter(function (t) {
      return t.status === STATUS.IN_PROGRESS;
    }).length;
    var highP = tasks.filter(function (t) {
      return t.priority === PRIORITY.HIGH;
    }).length;
    var medP = tasks.filter(function (t) {
      return t.priority === PRIORITY.MED;
    }).length;
    var lowP = tasks.filter(function (t) {
      return t.priority === PRIORITY.LOW;
    }).length;
    return {
      total: total,
      done: done,
      delayed: delayed,
      progressPct: progressPct,
      delayRate: delayRate,
      openIssues: openIssues,
      statusTodo: todoC,
      statusProgress: progC,
      statusDone: done,
      priHigh: highP,
      priMed: medP,
      priLow: lowP,
    };
  }

  function destroyDashboardCharts() {
    if (window.__wfChartInstances && window.__wfChartInstances.length) {
      window.__wfChartInstances.forEach(function (c) {
        try {
          c.destroy();
        } catch (e) {}
      });
    }
    window.__wfChartInstances = [];
  }

  function initDashboardCharts(state) {
    destroyDashboardCharts();
    if (typeof Chart === "undefined") return;
    var m = computeDashboard(state);
    var elS = document.getElementById("chart-status");
    var elP = document.getElementById("chart-priority");
    var textMuted = "#475569";
    var gridCol = "rgba(15, 23, 42, 0.08)";
    if (elS) {
      var c1 = new Chart(elS, {
        type: "doughnut",
        data: {
          labels: ["To-do", "In Progress", "Done"],
          datasets: [
            {
              data: [m.statusTodo, m.statusProgress, m.statusDone],
              backgroundColor: ["#3b82f6", "#f59e0b", "#22c55e"],
              borderWidth: 0,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            title: { display: true, text: "업무 상태 분포", color: textMuted },
            legend: { labels: { color: textMuted } },
          },
        },
      });
      window.__wfChartInstances.push(c1);
    }
    if (elP) {
      var c2 = new Chart(elP, {
        type: "bar",
        data: {
          labels: ["높음", "보통", "낮음"],
          datasets: [
            {
              label: "업무 수",
              data: [m.priHigh, m.priMed, m.priLow],
              backgroundColor: ["#ef4444", "#eab308", "#64748b"],
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            title: { display: true, text: "우선순위별 업무", color: textMuted },
            legend: { display: false },
          },
          scales: {
            x: { ticks: { color: textMuted }, grid: { color: gridCol } },
            y: {
              beginAtZero: true,
              ticks: { color: textMuted, stepSize: 1 },
              grid: { color: gridCol },
            },
          },
        },
      });
      window.__wfChartInstances.push(c2);
    }
  }

  function renderMemberProgressTable(state) {
    var rows = state.users
      .map(function (u) {
        var mine = state.tasks.filter(function (t) {
          return t.assigneeId === u.id;
        });
        var nTodo = mine.filter(function (t) {
          return t.status === STATUS.TODO;
        }).length;
        var nProg = mine.filter(function (t) {
          return t.status === STATUS.IN_PROGRESS;
        }).length;
        var nDone = mine.filter(function (t) {
          return t.status === STATUS.DONE;
        }).length;
        var nTot = mine.length;
        var pct = nTot ? Math.round((nDone / nTot) * 100) : 0;
        var delayedMine = mine.filter(isOverdueTask).length;
        return (
          "<tr><td><b>" +
          escapeHtml(u.name) +
          "</b><div class=\"small muted\">" +
          escapeHtml(u.email) +
          "</div></td><td>" +
          nTot +
          "</td><td>" +
          nTodo +
          "</td><td>" +
          nProg +
          "</td><td>" +
          nDone +
          "</td><td>" +
          (delayedMine ? '<span class="overdue">' + delayedMine + "</span>" : "0") +
          "</td><td style=\"min-width:120px\">" +
          '<div class="member-progress-track" title="완료 비율">' +
          '<div class="member-progress-fill" style="width:' +
          pct +
          '%"></div></div>' +
          '<div class="small muted">' +
          pct +
          "% 완료</div></td></tr>"
        );
      })
      .join("");
    return (
      "<h2>팀원별 업무 추진 현황</h2>" +
      '<p class="sub" style="margin-top:-8px">담당 업무 기준 To-do / 진행중 / 완료·지연 건수와 완료 비율입니다.</p>' +
      '<div class="table-wrap"><table><thead><tr>' +
      "<th>팀원</th><th>담당 총계</th><th>To-do</th><th>In Progress</th><th>Done</th><th>지연</th><th>진행률</th>" +
      "</tr></thead><tbody>" +
      (rows ||
        '<tr><td colspan="7" class="muted">팀원 데이터가 없습니다.</td></tr>') +
      "</tbody></table></div>"
    );
  }

  function renderDashboard(state, uid) {
    var m = computeDashboard(state);
    var wb = weekBoundsContaining(todayISODate());
    var tw = tasksDueInWeekByStatus(state, wb.start, wb.end);
    var scWeek = schedulesInWeek(state, wb.start, wb.end);
    var weekBlock =
      '<div class="card" style="margin-bottom:24px">' +
      '<h2 style="margin-top:0">금주 업무·일정</h2>' +
      '<p class="small muted" style="margin-top:-6px">진행 상태별로 <b>마감일이 금주(' +
      escapeHtml(wb.start) +
      " ~ " +
      escapeHtml(wb.end) +
      ', 월~일)</b>인 업무를 집계합니다. 숫자를 누르면 아래에 해당 금주 업무 목록이 펼쳐집니다. <b>일정</b>은 이번 주 달력에 한 번이라도 표시되는 캘린더 항목 수입니다.</p>' +
      '<div class="week-dash-actions row" style="flex-wrap:wrap;gap:10px;margin-top:14px;align-items:center">' +
      '<span class="small muted" style="margin-right:4px">금주 업무</span>' +
      '<button type="button" class="btn dash-week-task-btn" data-week-st="TODO">To-do <strong>' +
      tw.TODO.length +
      "</strong></button>" +
      '<button type="button" class="btn dash-week-task-btn" data-week-st="IN_PROGRESS">In Progress <strong>' +
      tw.IN_PROGRESS.length +
      "</strong></button>" +
      '<button type="button" class="btn dash-week-task-btn" data-week-st="DONE">Done <strong>' +
      tw.DONE.length +
      "</strong></button>" +
      '<button type="button" class="btn btn-ghost dash-week-task-btn" data-week-st="ALL">전체 <strong>' +
      tw.all.length +
      "</strong></button>" +
      '<span class="small muted" style="margin-left:8px">금주 일정</span>' +
      '<button type="button" class="btn btn-ghost dash-week-sched-btn" data-week-panel="sched">전체 <strong>' +
      scWeek.length +
      "</strong></button>" +
      "</div>" +
      '<div id="dash-week-panel" class="hidden" style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">' +
      '<h3 id="dash-week-panel-title" style="margin:0 0 10px;font-size:1rem"></h3>' +
      '<div id="dash-week-panel-body"></div>' +
      "</div>" +
      "</div>";
    var rowsDelayed = m.delayed
      .slice(0, 8)
      .map(function (t) {
        var assignee = getUser(state, t.assigneeId);
        return (
          "<tr><td><a href=\"#/tasks/" +
          escapeHtml(t.id) +
          '">' +
          escapeHtml(t.title) +
          "</a></td><td>" +
          escapeHtml(assignee ? assignee.name : "-") +
          '</td><td class="overdue">' +
          escapeHtml(t.dueDate) +
          "</td><td><span class=\"" +
          tagClassForStatus(t.status) +
          '">' +
          escapeHtml(statusLabel(t.status)) +
          "</span></td></tr>"
        );
      })
      .join("");

    var rowsIssues = m.openIssues
      .slice(0, 8)
      .map(function (i) {
        var tk = taskById(state, i.taskId);
        return (
          "<tr><td><a href=\"#/tasks/" +
          escapeHtml(i.taskId) +
          '">' +
          escapeHtml(tk ? tk.title : "(삭제된 업무)") +
          "</a></td><td>" +
          escapeHtml(i.title) +
          '</td><td><span class="' +
          tagClassForPriority(i.priority) +
          '">' +
          escapeHtml(priorityLabel(i.priority)) +
          "</span></td><td>" +
          escapeHtml(issueStatusLabel(i.status)) +
          "</td></tr>"
        );
      })
      .join("");

    return (
      "<main>" +
      "<h1>대시보드</h1>" +
      '<p class="sub">팀 전체 진행률, 지연 업무, 주요 이슈를 한눈에 확인합니다.</p>' +
      '<div class="grid-kpi">' +
      '<div class="card card-kpi"><div class="label">업무 진행률</div><div class="val">' +
      m.progressPct +
      "%</div></div>" +
      '<div class="card card-kpi"><div class="label">지연률</div><div class="val">' +
      m.delayRate +
      "%</div></div>" +
      '<div class="card card-kpi"><div class="label">미해결 이슈</div><div class="val">' +
      m.openIssues.length +
      "</div></div>" +
      '<div class="card card-kpi"><div class="label">전체 업무</div><div class="val">' +
      m.total +
      "</div></div>" +
      "</div>" +
      weekBlock +
      (typeof Chart !== "undefined"
        ? '<div class="chart-row">' +
          '<div class="card chart-card"><h3>업무 상태</h3><div class="chart-wrap"><canvas id="chart-status"></canvas></div></div>' +
          '<div class="card chart-card"><h3>우선순위</h3><div class="chart-wrap"><canvas id="chart-priority"></canvas></div></div>' +
          "</div>"
        : '<div class="flash flash-warn">차트 라이브러리를 불러오지 못했습니다. 인터넷 연결 후 새로고침하세요.</div>') +
      '<div class="card" style="margin-bottom:28px">' +
      renderMemberProgressTable(state) +
      "</div>" +
      "<h2>지연 업무</h2>" +
      '<div class="table-wrap"><table><thead><tr><th>업무</th><th>담당자</th><th>마감일</th><th>상태</th></tr></thead><tbody>' +
      (rowsDelayed || '<tr><td colspan="4" class="muted">지연 업무가 없습니다.</td></tr>') +
      "</tbody></table></div>" +
      "<h2>미해결 이슈</h2>" +
      '<div class="table-wrap"><table><thead><tr><th>관련 업무</th><th>이슈</th><th>중요도</th><th>상태</th></tr></thead><tbody>' +
      (rowsIssues || '<tr><td colspan="4" class="muted">미해결 이슈가 없습니다.</td></tr>') +
      "</tbody></table></div>" +
      "</main>"
    );
  }

  function filterTasks(state, f) {
    return state.tasks.filter(function (t) {
      if (f.assignee && t.assigneeId !== f.assignee) return false;
      if (f.status && t.status !== f.status) return false;
      if (f.priority && t.priority !== f.priority) return false;
      return true;
    });
  }

  function renderTasksPage(state, uid, query) {
    var view = query.view || "list";
    var f = {
      assignee: query.assignee || "",
      status: query.status || "",
      priority: query.priority || "",
    };
    var list = filterTasks(state, f);

    var userOptions = state.users
      .map(function (u) {
        return (
          '<option value="' +
          escapeHtml(u.id) +
          '" ' +
          (f.assignee === u.id ? "selected" : "") +
          ">" +
          escapeHtml(u.name) +
          "</option>"
        );
      })
      .join("");

    var controls =
      '<div class="filters">' +
      '<div class="field"><label>담당자</label><select id="flt-assignee"><option value="">전체</option>' +
      userOptions +
      "</select></div>" +
      '<div class="field"><label>상태</label><select id="flt-status">' +
      '<option value="">전체</option>' +
      '<option value="TODO"' +
      (f.status === "TODO" ? " selected" : "") +
      ">To-do</option>" +
      '<option value="IN_PROGRESS"' +
      (f.status === "IN_PROGRESS" ? " selected" : "") +
      ">In Progress</option>" +
      '<option value="DONE"' +
      (f.status === "DONE" ? " selected" : "") +
      ">Done</option>" +
      "</select></div>" +
      '<div class="field"><label>우선순위</label><select id="flt-priority">' +
      '<option value="">전체</option>' +
      '<option value="HIGH"' +
      (f.priority === "HIGH" ? " selected" : "") +
      ">높음</option>" +
      '<option value="MED"' +
      (f.priority === "MED" ? " selected" : "") +
      ">보통</option>" +
      '<option value="LOW"' +
      (f.priority === "LOW" ? " selected" : "") +
      ">낮음</option>" +
      "</select></div>" +
      '<div class="field"><label>보기</label><select id="flt-view">' +
      '<option value="list"' +
      (view === "list" ? " selected" : "") +
      ">리스트</option>" +
      '<option value="kanban"' +
      (view === "kanban" ? " selected" : "") +
      ">칸반</option>" +
      "</select></div>" +
      '<div class="field" style="align-self:flex-end"><button type="button" class="btn btn-primary" id="btn-new-task">새 업무</button></div>' +
      "</div>";

    var body;
    if (view === "kanban") {
      body = renderKanban(state, list);
    } else {
      body = renderTaskTable(state, list);
    }

    return (
      "<main>" +
      "<h1>업무 관리</h1>" +
      '<p class="sub">리스트 또는 칸반으로 상태를 관리합니다. 칸반에서 카드를 끌어 상태를 바꿀 수 있습니다.</p>' +
      controls +
      body +
      "</main>"
    );
  }

  function renderTaskTable(state, tasks) {
    var rows = tasks
      .map(function (t) {
        var assignee = getUser(state, t.assigneeId);
        var dep = t.dependsOnTaskId ? taskById(state, t.dependsOnTaskId) : null;
        var od = isOverdueTask(t) ? ' <span class="overdue">(지연)</span>' : "";
        return (
          "<tr>" +
          '<td><a href="#/tasks/' +
          escapeHtml(t.id) +
          '">' +
          escapeHtml(t.title) +
          "</a>" +
          od +
          "</td>" +
          "<td>" +
          escapeHtml(assignee ? assignee.name : "-") +
          "</td>" +
          "<td>" +
          escapeHtml(t.dueDate || "-") +
          "</td>" +
          '<td><span class="' +
          tagClassForPriority(t.priority) +
          '">' +
          escapeHtml(priorityLabel(t.priority)) +
          "</span></td>" +
          '<td><span class="' +
          tagClassForStatus(t.status) +
          '">' +
          escapeHtml(statusLabel(t.status)) +
          "</span></td>" +
          "<td>" +
          escapeHtml(dep ? dep.title : "-") +
          "</td>" +
          "</tr>"
        );
      })
      .join("");
    return (
      '<div class="table-wrap"><table><thead><tr>' +
      "<th>업무</th><th>담당자</th><th>마감일</th><th>우선순위</th><th>상태</th><th>의존 업무</th>" +
      "</tr></thead><tbody>" +
      (rows || '<tr><td colspan="6" class="muted">표시할 업무가 없습니다.</td></tr>') +
      "</tbody></table></div>"
    );
  }

  function renderKanban(state, tasks) {
    function cardsFor(st) {
      return tasks
        .filter(function (t) {
          return t.status === st;
        })
        .map(function (t) {
          var od = isOverdueTask(t) ? '<div class="overdue small">지연</div>' : "";
          return (
            '<div class="kcard" draggable="true" data-task-id="' +
            escapeHtml(t.id) +
            '">' +
            '<div class="t"><a href="#/tasks/' +
            escapeHtml(t.id) +
            '">' +
            escapeHtml(t.title) +
            "</a></div>" +
            '<div class="small muted">' +
            escapeHtml(priorityLabel(t.priority)) +
            " · " +
            escapeHtml(t.dueDate || "-") +
            "</div>" +
            od +
            "</div>"
          );
        })
        .join("");
    }
    return (
      '<div class="kanban">' +
      '<div class="kcol" data-status="TODO"><h3>To-do</h3><div class="klist" data-drop="TODO">' +
      cardsFor(STATUS.TODO) +
      "</div></div>" +
      '<div class="kcol" data-status="IN_PROGRESS"><h3>In Progress</h3><div class="klist" data-drop="IN_PROGRESS">' +
      cardsFor(STATUS.IN_PROGRESS) +
      "</div></div>" +
      '<div class="kcol" data-status="DONE"><h3>Done</h3><div class="klist" data-drop="DONE">' +
      cardsFor(STATUS.DONE) +
      "</div></div>" +
      "</div>"
    );
  }

  function renderTaskForm(state, uid, taskId) {
    var t = taskId ? taskById(state, taskId) : null;
    if (taskId && !t) {
      return (
        '<main><h1>업무를 찾을 수 없습니다</h1><p class="sub"><a href="#/tasks">목록으로</a></p></main>'
      );
    }
    var isNew = !t;
    var assigneeOptions = state.users
      .map(function (u) {
        var sel = t && t.assigneeId === u.id ? " selected" : "";
        if (isNew && !sel && u.id === uid) sel = " selected";
        return (
          '<option value="' + escapeHtml(u.id) + '"' + sel + ">" + escapeHtml(u.name) + "</option>"
        );
      })
      .join("");
    var depOptions =
      '<option value="">(없음)</option>' +
      state.tasks
        .filter(function (x) {
          return !taskId || x.id !== taskId;
        })
        .map(function (x) {
          var sel = t && t.dependsOnTaskId === x.id ? " selected" : "";
          return (
            '<option value="' +
            escapeHtml(x.id) +
            '"' +
            sel +
            ">" +
            escapeHtml(x.title) +
            "</option>"
          );
        })
        .join("");
    var st = t ? t.status : STATUS.TODO;
    var pr = t ? t.priority : PRIORITY.MED;
    return (
      "<main>" +
      "<h1>" +
      (isNew ? "새 업무" : "업무 수정") +
      "</h1>" +
      '<form id="form-task" class="form-grid">' +
      (isNew ? "" : '<input type="hidden" name="id" value="' + escapeHtml(t.id) + '"/>') +
      "<div><label>업무명</label>" +
      '<input class="input" name="title" required value="' +
      escapeHtml(t ? t.title : "") +
      '"/></div>' +
      "<div><label>설명</label>" +
      '<textarea name="description">' +
      escapeHtml(t ? t.description : "") +
      "</textarea></div>" +
      "<div><label>담당자</label><select name=\"assigneeId\">" +
      assigneeOptions +
      "</select></div>" +
      "<div class=\"due-date-block\"><label>마감일</label>" +
      '<p class="small muted" style="margin:0 0 8px">직접 입력(YYYY-MM-DD), <b>달력</b> 버튼 또는 날짜 칸을 눌러 선택하고, 아래 목록에서 캘린더 일정을 고를 수 있습니다. 저장 시 <b>마감일</b>이 있으면 캘린더에 <b>자동 반영</b>됩니다.</p>' +
      '<input class="input" type="text" name="dueDate" id="dueDateText" placeholder="예: 2026-04-20" value="' +
      escapeHtml(t ? t.dueDate || "" : "") +
      '" pattern="\\d{4}-\\d{2}-\\d{2}" />' +
      '<div class="row due-date-toolbar" style="margin-top:10px">' +
      "<div><label>날짜 선택</label>" +
      '<input class="input input-date" type="date" id="dueDatePicker" aria-label="달력에서 마감일 선택" value="' +
      escapeHtml(t ? t.dueDate || "" : "") +
      '"/></div>' +
      '<button type="button" class="btn" id="btn-due-open-picker" style="align-self:flex-end;margin-top:22px">달력 열기</button>' +
      "</div>" +
      "<div><label>캘린더 일정에서 마감일 가져오기</label>" +
      '<select id="dueScheduleSelect" class="select-field" title="목록에서 일정을 선택하세요">' +
      '<option value="">(선택 안 함)</option>' +
      state.schedules
        .slice()
        .sort(function (a, b) {
          return compareDate(a.endDate, b.endDate);
        })
        .map(function (s) {
          return (
            '<option value="' +
            escapeHtml(s.id) +
            '">' +
            escapeHtml(s.title) +
            " · " +
            escapeHtml(s.startDate) +
            " ~ " +
            escapeHtml(s.endDate) +
            " (마감 " +
            escapeHtml(s.endDate) +
            ")</option>"
          );
        })
        .join("") +
      "</select></div></div>" +
      "<div><label>우선순위</label><select name=\"priority\">" +
      '<option value="HIGH"' +
      (pr === "HIGH" ? " selected" : "") +
      ">높음</option>" +
      '<option value="MED"' +
      (pr === "MED" ? " selected" : "") +
      ">보통</option>" +
      '<option value="LOW"' +
      (pr === "LOW" ? " selected" : "") +
      ">낮음</option>" +
      "</select></div>" +
      "<div><label>상태</label><select name=\"status\">" +
      '<option value="TODO"' +
      (st === "TODO" ? " selected" : "") +
      ">To-do</option>" +
      '<option value="IN_PROGRESS"' +
      (st === "IN_PROGRESS" ? " selected" : "") +
      ">In Progress</option>" +
      '<option value="DONE"' +
      (st === "DONE" ? " selected" : "") +
      ">Done</option>" +
      "</select></div>" +
      "<div><label>의존 업무</label><select name=\"dependsOnTaskId\">" +
      depOptions +
      "</select></div>" +
      '<div class="row">' +
      '<button type="submit" class="btn btn-primary">저장</button>' +
      '<a class="btn btn-ghost" href="#/tasks">취소</a>' +
      (isNew
        ? ""
        : '<button type="button" class="btn btn-danger" id="btn-del-task">삭제</button>') +
      "</div>" +
      "</form>" +
      "</main>"
    );
  }

  function logsForTask(state, taskId) {
    return state.activityLogs.filter(function (l) {
      return l.taskId === taskId;
    });
  }

  function renderTaskDetail(state, uid, taskId) {
    var t = taskById(state, taskId);
    if (!t) {
      return (
        '<main><h1>업무를 찾을 수 없습니다</h1><p class="sub"><a href="#/tasks">목록으로</a></p></main>'
      );
    }
    var assignee = getUser(state, t.assigneeId);
    var dep = t.dependsOnTaskId ? taskById(state, t.dependsOnTaskId) : null;
    var od = isOverdueTask(t)
      ? '<div class="flash flash-warn">마감일 기준 이 업무는 <b>지연</b> 상태입니다.</div>'
      : "";

    var comments = state.comments
      .filter(function (c) {
        return c.taskId === taskId;
      })
      .sort(function (a, b) {
        return a.createdAt < b.createdAt ? -1 : 1;
      })
      .map(function (c) {
        var u = getUser(state, c.userId);
        return (
          '<div class="card" style="margin-bottom:8px">' +
          '<div class="small muted">' +
          escapeHtml(u ? u.name : "?") +
          " · " +
          escapeHtml(c.createdAt.slice(0, 19).replace("T", " ")) +
          "</div>" +
          "<div>" +
          escapeHtml(c.content).replace(/\n/g, "<br/>") +
          "</div>" +
          "</div>"
        );
      })
      .join("");

    var atts = state.attachments
      .filter(function (a) {
        return a.taskId === taskId;
      })
      .map(function (a) {
        return (
          '<div class="card" style="margin-bottom:8px">' +
          '<a href="' +
          escapeHtml(a.dataUrl) +
          '" download="' +
          escapeHtml(a.name) +
          '">' +
          escapeHtml(a.name) +
          "</a>" +
          '<div class="small muted">' +
          escapeHtml(a.createdAt.slice(0, 19)) +
          "</div>" +
          "</div>"
        );
      })
      .join("");

    var timeline = logsForTask(state, taskId)
      .slice()
      .sort(function (a, b) {
        return a.createdAt < b.createdAt ? 1 : -1;
      })
      .map(function (l) {
        var u = getUser(state, l.userId);
        return (
          '<div class="tl-item"><div class="small muted">' +
          escapeHtml(l.createdAt.slice(0, 19).replace("T", " ")) +
          " · " +
          escapeHtml(u ? u.name : "?") +
          "</div><div>" +
          escapeHtml(l.message) +
          "</div></div>"
        );
      })
      .join("");

    var relatedIssues = state.issues
      .filter(function (i) {
        return i.taskId === taskId;
      })
      .map(function (i) {
        return (
          '<div class="row" style="margin-bottom:6px"><a href="#/issues?q=' +
          escapeHtml(i.id) +
          '">' +
          escapeHtml(i.title) +
          "</a> · " +
          escapeHtml(issueStatusLabel(i.status)) +
          "</div>"
        );
      })
      .join("");

    return (
      "<main>" +
      '<div class="row" style="justify-content:space-between;width:100%">' +
      "<div>" +
      "<h1>" +
      escapeHtml(t.title) +
      "</h1>" +
      '<p class="sub"><a href="#/tasks">← 업무 목록</a> · <a href="#/tasks/' +
      escapeHtml(t.id) +
      '/edit">수정</a></p>' +
      "</div>" +
      "</div>" +
      od +
      '<div class="split">' +
      '<div class="card">' +
      "<h2 style=\"margin-top:0\">업무 정보</h2>" +
      '<p class="small muted">설명</p><p>' +
      escapeHtml(t.description || "-").replace(/\n/g, "<br/>") +
      "</p>" +
      '<p class="small muted">담당자</p><p>' +
      escapeHtml(assignee ? assignee.name : "-") +
      "</p>" +
      '<p class="small muted">마감일</p><p>' +
      escapeHtml(t.dueDate || "-") +
      "</p>" +
      '<p class="small muted">우선순위</p><p><span class="' +
      tagClassForPriority(t.priority) +
      '">' +
      escapeHtml(priorityLabel(t.priority)) +
      "</span></p>" +
      '<p class="small muted">상태</p><p><span class="' +
      tagClassForStatus(t.status) +
      '">' +
      escapeHtml(statusLabel(t.status)) +
      "</span></p>" +
      '<p class="small muted">의존 업무</p><p>' +
      (dep
        ? '<a href="#/tasks/' + escapeHtml(dep.id) + '">' + escapeHtml(dep.title) + "</a>"
        : "-") +
      "</p>" +
      "<h2>관련 이슈</h2>" +
      (relatedIssues || '<p class="muted">연결된 이슈가 없습니다.</p>') +
      "</div>" +
      '<div class="card">' +
      "<h2 style=\"margin-top:0\">댓글</h2>" +
      (comments || '<p class="muted">댓글이 없습니다.</p>') +
      '<form id="form-comment" style="margin-top:12px">' +
      '<textarea name="content" placeholder="댓글을 입력하세요" required></textarea>' +
      '<div style="margin-top:8px"><button type="submit" class="btn btn-primary">등록</button></div>' +
      "</form>" +
      "<h2>파일 첨부</h2>" +
      '<form id="form-attach" style="margin-top:8px">' +
      '<input type="file" name="file" />' +
      '<div style="margin-top:8px"><button type="submit" class="btn">업로드</button></div>' +
      '<p class="small muted">최대 약 1MB까지 첨부 가능합니다. 데이터는 브라우저에만 저장됩니다.</p>' +
      "</form>" +
      (atts || '<p class="muted">첨부파일이 없습니다.</p>') +
      "<h2>변경 이력</h2>" +
      '<div class="timeline">' +
      (timeline || '<p class="muted">이력이 없습니다.</p>') +
      "</div>" +
      "</div>" +
      "</div>" +
      "</main>"
    );
  }

  var calYear;
  var calMonth;

  function monthMatrix(y, m0) {
    var first = new Date(y, m0, 1);
    var startDow = first.getDay();
    var start = new Date(y, m0, 1 - startDow);
    var cells = [];
    for (var i = 0; i < 42; i++) {
      var d = new Date(start);
      d.setDate(start.getDate() + i);
      cells.push(d);
    }
    return cells;
  }

  function isoFromDate(d) {
    return (
      d.getFullYear() +
      "-" +
      String(d.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(d.getDate()).padStart(2, "0")
    );
  }

  /** 이번 주 월요일~일요일 (로컬 기준), 기준일이 속한 주 */
  function weekBoundsContaining(isoDate) {
    var d = parseISODate(isoDate);
    if (!d || isNaN(d.getTime())) {
      var n = new Date();
      d = new Date(n.getFullYear(), n.getMonth(), n.getDate());
    } else {
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }
    var day = d.getDay();
    var monOffset = (day + 6) % 7;
    var mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() - monOffset);
    var sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6);
    return { start: isoFromDate(mon), end: isoFromDate(sun) };
  }

  function scheduleOccursInWeekRange(s, weekStart, weekEnd) {
    var d = weekStart;
    while (compareDate(d, weekEnd) <= 0) {
      if (scheduleTouchesDate(s, d)) return true;
      d = addDaysIso(d, 1);
    }
    return false;
  }

  function tasksDueInWeekByStatus(state, weekStart, weekEnd) {
    var inWeek = state.tasks.filter(function (t) {
      if (!t.dueDate) return false;
      return compareDate(t.dueDate, weekStart) >= 0 && compareDate(t.dueDate, weekEnd) <= 0;
    });
    return {
      all: inWeek,
      TODO: inWeek.filter(function (t) {
        return t.status === STATUS.TODO;
      }),
      IN_PROGRESS: inWeek.filter(function (t) {
        return t.status === STATUS.IN_PROGRESS;
      }),
      DONE: inWeek.filter(function (t) {
        return t.status === STATUS.DONE;
      }),
    };
  }

  function schedulesInWeek(state, weekStart, weekEnd) {
    var out = [];
    state.schedules.forEach(function (s) {
      if (scheduleOccursInWeekRange(s, weekStart, weekEnd)) out.push(s);
    });
    return out;
  }

  function dayHasSchedule(state, iso, ownerFilter) {
    return state.schedules.filter(function (s) {
      if (ownerFilter && s.ownerId !== ownerFilter) return false;
      return scheduleTouchesDate(s, iso);
    });
  }

  function renderCalendar(state, uid, flash) {
    var now = new Date();
    if (typeof calYear !== "number") calYear = now.getFullYear();
    if (typeof calMonth !== "number") calMonth = now.getMonth();
    var y = calYear;
    var m0 = calMonth;
    var title = y + "년 " + (m0 + 1) + "월";
    var cells = monthMatrix(y, m0);
    var weeks = [];
    for (var r = 0; r < 6; r++) {
      var row = [];
      for (var c = 0; c < 7; c++) {
        row.push(cells[r * 7 + c]);
      }
      weeks.push(row);
    }
    var today = todayISODate();
    var cellHtml = weeks
      .map(function (week) {
        return (
          '<div class="cal-grid" style="margin-bottom:4px">' +
          week
            .map(function (d) {
              var iso = isoFromDate(d);
              var inMonth = d.getMonth() === m0;
              var evs = dayHasSchedule(state, iso, "");
              var evHtml = evs
                .map(function (s) {
                  var ow = getUser(state, s.ownerId);
                  var onm = ow ? ow.name : "?";
                  return (
                    '<div class="cal-ev" data-schedule-id="' +
                    escapeHtml(s.id) +
                    '" title="' +
                    escapeHtml(s.title + " · " + onm) +
                    '">' +
                    escapeHtml(s.title) +
                    '<span class="cal-ev-owner">' +
                    escapeHtml(onm) +
                    "</span></div>"
                  );
                })
                .join("");
              return (
                '<div class="cal-cell cal-day-pick' +
                (inMonth ? "" : " out") +
                '" data-pick-date="' +
                escapeHtml(iso) +
                '">' +
                '<div class="num">' +
                d.getDate() +
                (iso === today ? ' <span class="tag tag-progress">오늘</span>' : "") +
                "</div>" +
                evHtml +
                "</div>"
              );
            })
            .join("") +
          "</div>"
        );
      })
      .join("");

    var taskOpts =
      '<option value="">(연결 없음)</option>' +
      state.tasks
        .map(function (t) {
          return (
            '<option value="' +
            escapeHtml(t.id) +
            '">' +
            escapeHtml(t.title) +
            "</option>"
          );
        })
        .join("");
    var ownerOpts = state.users
      .map(function (u) {
        var sel = u.id === uid ? " selected" : "";
        return (
          '<option value="' + escapeHtml(u.id) + '"' + sel + ">" + escapeHtml(u.name) + "</option>"
        );
      })
      .join("");

    return (
      "<main>" +
      "<h1>캘린더</h1>" +
      '<p class="sub">날짜 칸을 누르면 팝업에서 해당 날짜로 일정을 등록할 수 있습니다. 기존 일정을 누르면 아래에서 수정할 수 있습니다. 관련 업무를 선택하면 저장 시 업무의 마감일·담당자에도 반영됩니다.</p>' +
      (flash ? '<div class="flash flash-warn">' + flash + "</div>" : "") +
      '<div class="cal-head">' +
      "<h2 style=\"margin:0\">" +
      escapeHtml(title) +
      "</h2>" +
      '<div class="row">' +
      '<button type="button" class="btn" id="cal-prev">이전</button>' +
      '<button type="button" class="btn" id="cal-today">오늘</button>' +
      '<button type="button" class="btn" id="cal-next">다음</button>' +
      "</div></div>" +
      '<div class="cal-grid">' +
      ["일", "월", "화", "수", "목", "금", "토"]
        .map(function (d) {
          return '<div class="cal-dow">' + d + "</div>";
        })
        .join("") +
      "</div>" +
      cellHtml +
      '<div class="row" style="margin-top:18px">' +
      '<button type="button" class="btn btn-primary" id="btn-cal-open-new">새 일정 등록</button>' +
      "</div>" +
      '<div id="overlay-cal-new" class="modal-overlay hidden" aria-hidden="true">' +
      '<div class="modal-dialog card" role="dialog" aria-modal="true" aria-labelledby="cal-new-title">' +
      '<div class="modal-dialog-head">' +
      '<h2 id="cal-new-title" style="margin:0">새 일정 등록</h2>' +
      '<button type="button" class="btn btn-ghost" id="btn-cal-new-close">닫기</button>' +
      "</div>" +
      '<form id="form-schedule" class="form-grid">' +
      "<div><label>캘린더 제목</label><input class=\"input\" name=\"title\" required /></div>" +
      "<div><label>시작일</label><input class=\"input input-date\" type=\"date\" name=\"startDate\" id=\"new-startDate\" required /></div>" +
      "<div><label>종료일</label><input class=\"input input-date\" type=\"date\" name=\"endDate\" id=\"new-endDate\" required /></div>" +
      "<div><label>담당자(겹침 검사 기준)</label><select class=\"select-field\" name=\"ownerId\" id=\"new-ownerId\">" +
      ownerOpts +
      "</select></div>" +
      "<div><label>관련 업무</label><select class=\"select-field\" name=\"relatedTaskId\">" +
      taskOpts +
      "</select></div>" +
      htmlRepeatFields(REPEAT.NONE, "") +
      '<div class="row">' +
      '<button type="submit" class="btn btn-primary">등록</button>' +
      "</div></form></div></div>" +
      '<div id="overlay-cal-day" class="modal-overlay hidden" aria-hidden="true">' +
      '<div class="modal-dialog card" role="dialog" aria-modal="true">' +
      '<div class="modal-dialog-head">' +
      "<h2 style=\"margin:0\">선택한 날짜에 일정 등록</h2>" +
      '<button type="button" class="btn btn-ghost" id="btn-close-cal-day">닫기</button>' +
      "</div>" +
      '<p class="small muted" id="cal-day-modal-hint"></p>' +
      '<form id="form-schedule-pick" class="form-grid">' +
      "<div><label>캘린더 제목</label><input class=\"input\" name=\"title\" required placeholder=\"일정 제목\" /></div>" +
      "<div><label>시작일</label><input class=\"input input-date\" type=\"date\" name=\"startDate\" id=\"pick-startDate\" required /></div>" +
      "<div><label>종료일</label><input class=\"input input-date\" type=\"date\" name=\"endDate\" id=\"pick-endDate\" required /></div>" +
      "<div><label>담당자</label><select class=\"select-field\" name=\"ownerId\" id=\"pick-ownerId\">" +
      ownerOpts +
      "</select></div>" +
      "<div><label>관련 업무</label><select class=\"select-field\" name=\"relatedTaskId\">" +
      taskOpts +
      "</select></div>" +
      htmlRepeatFields(REPEAT.NONE, "") +
      '<div class="row">' +
      '<button type="submit" class="btn btn-primary">등록</button>' +
      "</div></form></div></div>" +
      '<div id="schedule-modal" class="card hidden" style="margin-top:20px">' +
      "<h2 style=\"margin-top:0\">일정 편집</h2>" +
      '<div id="schedule-modal-body"></div>' +
      '<div class="row" style="margin-top:10px">' +
      '<button type="button" class="btn btn-danger" id="btn-del-schedule">삭제</button>' +
      '<button type="button" class="btn btn-ghost" id="btn-close-schedule">닫기</button>' +
      "</div></div>" +
      "</main>"
    );
  }

  function renderIssuesPage(state, uid, highlightId) {
    var rows = state.issues
      .slice()
      .sort(function (a, b) {
        var ar = a.status === ISSUE_STATUS.RESOLVED;
        var br = b.status === ISSUE_STATUS.RESOLVED;
        if (ar !== br) return ar ? 1 : -1;
        return a.createdAt < b.createdAt ? 1 : -1;
      })
      .map(function (i) {
        var tk = taskById(state, i.taskId);
        var rep = getUser(state, i.reporterId);
        var unresolved = i.status !== ISSUE_STATUS.RESOLVED;
        var rowClass = unresolved && i.priority === PRIORITY.HIGH ? ' style="background:rgba(248,113,113,0.06)"' : "";
        var hl = highlightId === i.id ? ' style="outline:2px solid var(--accent)"' : rowClass;
        return (
          "<tr" +
          hl +
          ">" +
          "<td>" +
          escapeHtml(i.title) +
          (unresolved ? ' <span class="tag tag-high">미해결</span>' : "") +
          "</td>" +
          "<td>" +
          escapeHtml(tk ? tk.title : "-") +
          "</td>" +
          '<td><span class="' +
          tagClassForPriority(i.priority) +
          '">' +
          escapeHtml(priorityLabel(i.priority)) +
          "</span></td>" +
          "<td>" +
          escapeHtml(issueStatusLabel(i.status)) +
          "</td>" +
          "<td>" +
          escapeHtml(rep ? rep.name : "-") +
          "</td>" +
          '<td><a href="#/tasks/' +
          escapeHtml(i.taskId) +
          '">업무 보기</a> ' +
          '<button type="button" class="btn btn-ghost issue-st" data-issue-id="' +
          escapeHtml(i.id) +
          '" data-next="IN_PROGRESS" style="padding:4px 8px;font-size:0.75rem">진행</button> ' +
          '<button type="button" class="btn btn-ghost issue-st" data-issue-id="' +
          escapeHtml(i.id) +
          '" data-next="RESOLVED" style="padding:4px 8px;font-size:0.75rem">해결</button></td>' +
          "</tr>"
        );
      })
      .join("");

    var taskSelect = state.tasks
      .map(function (t) {
        return (
          '<option value="' +
          escapeHtml(t.id) +
          '">' +
          escapeHtml(t.title) +
          "</option>"
        );
      })
      .join("");

    return (
      "<main>" +
      "<h1>이슈 관리</h1>" +
      '<p class="sub">업무와 연결해 중요도와 해결 상태를 추적합니다.</p>' +
      '<div class="card" style="margin-bottom:16px">' +
      "<h2 style=\"margin-top:0\">이슈 등록</h2>" +
      '<form id="form-issue" class="form-grid">' +
      "<div><label>제목</label><input class=\"input\" name=\"title\" required /></div>" +
      "<div><label>내용</label><textarea name=\"description\"></textarea></div>" +
      "<div><label>관련 업무</label><select name=\"taskId\" required>" +
      taskSelect +
      "</select></div>" +
      "<div><label>중요도</label><select name=\"priority\">" +
      '<option value="HIGH">높음</option><option value="MED" selected>보통</option><option value="LOW">낮음</option>' +
      "</select></div>" +
      "<div><label>상태</label><select name=\"status\">" +
      '<option value="OPEN" selected>Open</option>' +
      '<option value="IN_PROGRESS">In Progress</option>' +
      '<option value="RESOLVED">Resolved</option>' +
      "</select></div>" +
      '<button type="submit" class="btn btn-primary">등록</button>' +
      "</form></div>" +
      '<div class="table-wrap"><table><thead><tr>' +
      "<th>이슈</th><th>관련 업무</th><th>중요도</th><th>상태</th><th>보고자</th><th></th>" +
      "</tr></thead><tbody>" +
      (rows || '<tr><td colspan="6" class="muted">이슈가 없습니다.</td></tr>') +
      "</tbody></table></div>" +
      "</main>"
    );
  }

  function renderSettings(state, uid) {
    if (!isAdmin(state, uid)) {
      return '<main><h1>권한 없음</h1><p class="sub">관리자만 접근할 수 있습니다.</p></main>';
    }
    return (
      "<main>" +
      "<h1>설정</h1>" +
      '<p class="sub">데모 데이터를 초기화하거나 시드 예제를 다시 불러옵니다.</p>' +
      '<div class="card">' +
      '<p class="small muted">주의: 아래 작업은 이 브라우저에 저장된 데이터에만 적용됩니다.</p>' +
      '<div class="row" style="margin-top:12px">' +
      '<button type="button" class="btn btn-primary" id="btn-reseed">예제 데이터로 재설정</button>' +
      '<button type="button" class="btn btn-danger" id="btn-wipe">전체 삭제 후 빈 팀</button>' +
      "</div></div>" +
      "</main>"
    );
  }

  function countAdmins(state) {
    return state.users.filter(function (u) {
      return u.role === "ADMIN";
    }).length;
  }

  function parseCsvLineSimple(line) {
    return line.split(",").map(function (c) {
      return String(c)
        .replace(/^\s+|\s+$/g, "")
        .replace(/^"|"$/g, "");
    });
  }

  function downloadMemberTemplateCsv() {
    var bom = "\uFEFF";
    var body =
      "이름,이메일,비밀번호,역할,조직1,조직2,조직3,직책,직급\n" +
      "홍길동,hong@example.com,temp123,MEMBER,디지털L&D센터,교육팀,1파트,팀장,책임\n";
    var blob = new Blob([bom + body], { type: "text/csv;charset=utf-8;" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "TeamFlow_회원등록_양식.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }

  function importUsersFromCsvText(st, text) {
    var lines = text.split(/\r?\n/).map(function (ln) {
      return ln.replace(/^\uFEFF/, "");
    });
    var added = 0;
    var errs = [];
    var startIdx = 0;
    if (lines.length && /이름\s*,/i.test(String(lines[0]).trim())) {
      startIdx = 1;
    }
    for (var i = startIdx; i < lines.length; i++) {
      var raw = lines[i].trim();
      if (!raw) continue;
      var p = parseCsvLineSimple(raw);
      while (p.length < 9) p.push("");
      var name = (p[0] || "").trim();
      var email = (p[1] || "").trim().toLowerCase();
      var pw = (p[2] || "").trim();
      var roleStr = ((p[3] || "MEMBER") + "").toUpperCase();
      var role = roleStr === "ADMIN" ? "ADMIN" : "MEMBER";
      var org1 = (p[4] || "").trim();
      var org2 = (p[5] || "").trim();
      var org3 = (p[6] || "").trim();
      var jobTitle = (p[7] || "").trim();
      var jobRank = (p[8] || "").trim();
      if (!name || !email) {
        errs.push("이름/이메일 누락 행");
        continue;
      }
      if (!pw) {
        errs.push("비밀번호 없음: " + email);
        continue;
      }
      if (
        st.users.some(function (u) {
          return u.email.toLowerCase() === email;
        })
      ) {
        errs.push("중복 이메일: " + email);
        continue;
      }
      st.users.push({
        id: id(),
        name: name,
        email: email,
        password: pw,
        role: role,
        org1: org1,
        org2: org2,
        org3: org3,
        jobTitle: jobTitle,
        jobRank: jobRank,
      });
      added++;
    }
    return { added: added, errs: errs };
  }

  function memberListSearchHaystack(u) {
    return [
      u.name,
      u.org1,
      u.org2,
      u.org3,
      u.jobTitle,
      u.jobRank,
    ]
      .map(function (x) {
        return String(x == null ? "" : x).trim();
      })
      .join(" ")
      .toLowerCase();
  }

  function renderMembersPage(state, uid) {
    var admin = isAdmin(state, uid);
    var rows = state.users
      .map(function (u) {
        var roleCell = admin
          ? '<select class="select-field member-role" data-user-id="' +
            escapeHtml(u.id) +
            '" style="max-width:160px;padding:6px 8px">' +
            '<option value="MEMBER"' +
            (u.role === "MEMBER" ? " selected" : "") +
            ">Member</option>" +
            '<option value="ADMIN"' +
            (u.role === "ADMIN" ? " selected" : "") +
            ">Admin</option>" +
            "</select>"
          : '<span class="tag">' +
            escapeHtml(u.role === "ADMIN" ? "Admin" : "Member") +
            "</span>";
        var actions = admin
          ? '<button type="button" class="btn btn-ghost member-pw" data-user-id="' +
            escapeHtml(u.id) +
            '" style="padding:4px 10px;font-size:0.8rem">비밀번호</button> ' +
            (u.id === uid
              ? '<span class="muted small">본인</span>'
              : '<button type="button" class="btn btn-danger member-del" data-user-id="' +
                escapeHtml(u.id) +
                '" style="padding:4px 10px;font-size:0.8rem">삭제</button>')
          : '<span class="muted">—</span>';
        var hay = memberListSearchHaystack(u);
        return (
          '<tr class="member-row" data-search-haystack="' +
          escapeHtml(hay) +
          '"><td>' +
          escapeHtml(u.name) +
          "</td><td>" +
          escapeHtml(u.email) +
          "</td><td class=\"small\">" +
          escapeHtml(u.org1 || "") +
          "</td><td class=\"small\">" +
          escapeHtml(u.org2 || "") +
          "</td><td class=\"small\">" +
          escapeHtml(u.org3 || "") +
          "</td><td class=\"small\">" +
          escapeHtml(u.jobTitle || "") +
          "</td><td class=\"small\">" +
          escapeHtml(u.jobRank || "") +
          "</td><td>" +
          roleCell +
          "</td><td>" +
          actions +
          "</td></tr>"
        );
      })
      .join("");

    var bulkCsv = admin
      ? '<div class="card" style="margin-bottom:20px">' +
        "<h2 style=\"margin-top:0\">엑셀(CSV) 일괄 등록</h2>" +
        '<p class="small muted">엑셀에서 작성 후 <b>다른 이름으로 저장 → CSV UTF-8</b>으로 저장한 뒤 업로드하세요. 셀에 쉼표(,)가 들어가면 열이 어긋날 수 있습니다.</p>' +
        '<div class="row" style="margin-top:10px;align-items:center;flex-wrap:wrap;gap:10px">' +
        '<button type="button" class="btn" id="btn-dl-member-csv">양식 다운로드 (CSV)</button>' +
        '<input type="file" id="file-member-csv" accept=".csv,text/csv,.txt" style="max-width:220px" />' +
        '<button type="button" class="btn btn-primary" id="btn-upload-member-csv">선택 파일 업로드</button>' +
        "</div></div>"
      : "";

    var addForm = admin
      ? '<div class="card" style="margin-bottom:20px">' +
        "<h2 style=\"margin-top:0\">회원 추가 (개별)</h2>" +
        '<form id="form-add-member" class="form-grid">' +
        "<div><label>이름</label><input class=\"input\" name=\"name\" required autocomplete=\"name\" /></div>" +
        "<div><label>이메일</label><input class=\"input\" type=\"email\" name=\"email\" required autocomplete=\"off\" /></div>" +
        "<div><label>비밀번호</label><input class=\"input\" type=\"password\" name=\"password\" required autocomplete=\"new-password\" /></div>" +
        "<div><label>역할</label><select class=\"select-field\" name=\"role\"><option value=\"MEMBER\">Member</option><option value=\"ADMIN\">Admin</option></select></div>" +
        "<div><label>조직1 (상위)</label><input class=\"input\" name=\"org1\" placeholder=\"예: 디지털L&D센터\" autocomplete=\"organization\" /></div>" +
        "<div><label>조직2</label><input class=\"input\" name=\"org2\" placeholder=\"예: 교육팀\" /></div>" +
        "<div><label>조직3</label><input class=\"input\" name=\"org3\" placeholder=\"예: 1파트\" /></div>" +
        "<div><label>직책</label><input class=\"input\" name=\"jobTitle\" placeholder=\"예: 팀장\" autocomplete=\"organization-title\" /></div>" +
        "<div><label>직급</label><input class=\"input\" name=\"jobRank\" placeholder=\"예: 책임\" /></div>" +
        '<button type="submit" class="btn btn-primary">추가</button>' +
        "</form></div>"
      : '<p class="sub muted">회원 목록은 읽기 전용입니다. 등록·수정은 관리자만 가능합니다.</p>';

    return (
      "<main>" +
      "<h1>회원관리</h1>" +
      '<p class="sub">조직(상위→하위: 조직1·2·3), 직책·직급과 계정을 관리합니다. CSV로 일괄 등록할 수 있습니다.</p>' +
      bulkCsv +
      addForm +
      '<div class="card" style="margin-bottom:16px;padding:14px 16px">' +
      "<label for=\"member-list-search\" style=\"display:block;margin-bottom:8px;font-weight:600\">회원 검색</label>" +
      '<input type="search" id="member-list-search" class="input" placeholder="성명, 조직1·2·3, 직책, 직급으로 검색" autocomplete="off" style="max-width:420px" />' +
      '<p class="small muted" style="margin:8px 0 0">입력한 글자가 위 항목 중 하나에 포함되면 표시됩니다.</p>' +
      "</div>" +
      '<div class="table-wrap"><table><thead><tr>' +
      "<th>이름</th><th>이메일</th><th>조직1</th><th>조직2</th><th>조직3</th><th>직책</th><th>직급</th><th>역할</th><th>작업</th>" +
      "</tr></thead><tbody>" +
      rows +
      "</tbody></table></div>" +
      "</main>"
    );
  }

  function renderLogin(msg) {
    return (
      '<div class="login-wrap">' +
      '<div class="card login-card">' +
      "<h1>TeamFlow</h1>" +
      '<p class="sub">디지털L&amp;D센터 · 이메일과 비밀번호로 접속합니다.</p>' +
      (msg ? '<div class="flash flash-error">' + escapeHtml(msg) + "</div>" : "") +
      '<form id="form-login" class="form-grid">' +
      "<div><label>이메일</label>" +
      '<input class="input" name="email" autocomplete="username" required /></div>' +
      "<div><label>비밀번호</label>" +
      '<input class="input" type="password" name="password" autocomplete="current-password" required /></div>' +
      '<button type="submit" class="btn btn-primary" style="max-width:200px">로그인</button>' +
      "</form>" +
      '<p class="small muted" style="margin-top:16px">admin@demo.com / kim@demo.com / lee@demo.com</p>' +
      "</div></div>"
    );
  }

  function parseQuery(qs) {
    var o = {};
    if (!qs) return o;
    qs.split("&").forEach(function (part) {
      var i = part.indexOf("=");
      if (i === -1) return;
      var k = decodeURIComponent(part.slice(0, i));
      var v = decodeURIComponent(part.slice(i + 1));
      o[k] = v;
    });
    return o;
  }

  var calendarFlash = "";

  function renderApp() {
    var state = loadState();
    var route = parseRoute();
    var parts = route.parts;
    var path = "/" + parts.join("/");
    var uid = getSessionUserId();
    var app = document.getElementById("app");

    if (!uid && path !== "/login") {
      location.hash = "#/login";
      return;
    }

    if (path === "/login") {
      if (uid) {
        location.hash = "#/dashboard";
        return;
      }
      app.innerHTML = renderLogin("");
      wireLogin(state);
      return;
    }

    if (!getUser(state, uid)) {
      clearSession();
      location.hash = "#/login";
      return;
    }

    var active = path;
    if (active.indexOf("/tasks/") === 0 && active.endsWith("/edit")) active = "/tasks";
    var header = renderHeader(state, uid, active);
    var main = "";

    if (path === "/dashboard" || path === "" || path === "/") {
      main = renderDashboard(state, uid);
    } else if (path === "/tasks") {
      var q = parseQuery(route.raw.split("?")[1] || "");
      main = renderTasksPage(state, uid, q);
    } else if (path === "/tasks/new") {
      main = renderTaskForm(state, uid, null);
    } else if (parts[0] === "tasks" && parts[1] && parts[2] === "edit") {
      main = renderTaskForm(state, uid, parts[1]);
    } else if (parts[0] === "tasks" && parts[1]) {
      main = renderTaskDetail(state, uid, parts[1]);
    } else if (path.indexOf("/calendar") === 0) {
      main = renderCalendar(state, uid, calendarFlash);
      calendarFlash = "";
    } else if (path.indexOf("/issues") === 0) {
      var iq = parseQuery(route.raw.split("?")[1] || "");
      main = renderIssuesPage(state, uid, iq.q || "");
    } else if (path.indexOf("/members") === 0) {
      main = renderMembersPage(state, uid);
    } else if (path.indexOf("/settings") === 0) {
      main = renderSettings(state, uid);
    } else {
      main = "<main><h1>404</h1><p class=\"sub\"><a href=\"#/dashboard\">대시보드</a></p></main>";
    }

    app.innerHTML = header + main;
    wireCommon(state, uid);
    wireRouteSpecific(state, uid, path, parts, route.raw);
  }

  function wireLogin(state) {
    var form = document.getElementById("form-login");
    if (!form) return;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var fd = new FormData(form);
      var email = String(fd.get("email") || "").trim();
      var password = String(fd.get("password") || "");
      var u = state.users.find(function (x) {
        return x.email === email && x.password === password;
      });
      if (!u) {
        document.getElementById("app").innerHTML = renderLogin("이메일 또는 비밀번호가 올바르지 않습니다.");
        wireLogin(loadState());
        return;
      }
      setSessionUserId(u.id);
      location.hash = "#/dashboard";
    });
  }

  function wireCommon(state, uid) {
    var lo = document.getElementById("btn-logout");
    if (lo) {
      lo.addEventListener("click", function () {
        clearSession();
        location.hash = "#/login";
      });
    }
  }

  function wireDashboardWeekDetail() {
    var panel = document.getElementById("dash-week-panel");
    var pTitle = document.getElementById("dash-week-panel-title");
    var pBody = document.getElementById("dash-week-panel-body");
    if (!panel || !pTitle || !pBody) return;
    var lastKey = null;
    function hidePanel() {
      panel.classList.add("hidden");
      pBody.innerHTML = "";
      pTitle.textContent = "";
      lastKey = null;
    }
    function showPanel(key, title, html) {
      lastKey = key;
      pTitle.textContent = title;
      pBody.innerHTML = html;
      panel.classList.remove("hidden");
    }
    function togglePanel(key, title, html) {
      if (lastKey === key) {
        hidePanel();
        return;
      }
      showPanel(key, title, html);
    }
    document.querySelectorAll(".dash-week-task-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var statusKey = btn.getAttribute("data-week-st");
        var st = loadState();
        var wb = weekBoundsContaining(todayISODate());
        var tw = tasksDueInWeekByStatus(st, wb.start, wb.end);
        var list =
          statusKey === "ALL"
            ? tw.all
            : statusKey === "TODO"
              ? tw.TODO
              : statusKey === "IN_PROGRESS"
                ? tw.IN_PROGRESS
                : tw.DONE;
        var label =
          statusKey === "ALL"
            ? "전체"
            : statusKey === "TODO"
              ? "To-do"
              : statusKey === "IN_PROGRESS"
                ? "In Progress"
                : "Done";
        var html = renderTaskTable(st, list);
        togglePanel(
          "t:" + statusKey,
          "금주 업무 (" + wb.start + " ~ " + wb.end + ") — " + label + " " + list.length + "건",
          html
        );
      });
    });
    var sb = document.querySelector(".dash-week-sched-btn");
    if (sb) {
      sb.addEventListener("click", function () {
        var st = loadState();
        var wb = weekBoundsContaining(todayISODate());
        var list = schedulesInWeek(st, wb.start, wb.end);
        var rows = list
          .map(function (sch) {
            var ow = getUser(st, sch.ownerId);
            var range =
              sch.startDate === sch.endDate
                ? sch.startDate
                : sch.startDate + " ~ " + sch.endDate;
            return (
              "<tr><td>" +
              escapeHtml(sch.title) +
              "</td><td>" +
              escapeHtml(range) +
              "</td><td>" +
              escapeHtml(ow ? ow.name : "-") +
              "</td></tr>"
            );
          })
          .join("");
        var html =
          '<div class="table-wrap"><table><thead><tr><th>일정</th><th>기간(시작~종료)</th><th>담당</th></tr></thead><tbody>' +
          (rows ||
            '<tr><td colspan="3" class="muted">금주에 표시되는 일정이 없습니다.</td></tr>') +
          "</tbody></table></div>";
        togglePanel(
          "sched",
          "금주 캘린더 일정 (" + wb.start + " ~ " + wb.end + ") " + list.length + "건",
          html
        );
      });
    }
  }

  function wireRouteSpecific(state, uid, path, parts, raw) {
    destroyDashboardCharts();

    if (path === "/dashboard" || path === "" || path === "/") {
      setTimeout(function () {
        initDashboardCharts(loadState());
      }, 0);
      wireDashboardWeekDetail();
    }

    if (path === "/tasks") {
      function applyFilters() {
        var a = document.getElementById("flt-assignee").value;
        var s = document.getElementById("flt-status").value;
        var p = document.getElementById("flt-priority").value;
        var v = document.getElementById("flt-view").value;
        var qs =
          "?" +
          [
            a ? "assignee=" + encodeURIComponent(a) : "",
            s ? "status=" + encodeURIComponent(s) : "",
            p ? "priority=" + encodeURIComponent(p) : "",
            v ? "view=" + encodeURIComponent(v) : "",
          ]
            .filter(Boolean)
            .join("&");
        navigate("/tasks" + qs);
      }
      ["flt-assignee", "flt-status", "flt-priority", "flt-view"].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.addEventListener("change", applyFilters);
      });
      var btn = document.getElementById("btn-new-task");
      if (btn) btn.addEventListener("click", function () {
        navigate("/tasks/new");
      });
      wireKanbanDnD(state, uid);
    }

    if (path === "/tasks/new" || (parts[0] === "tasks" && parts[2] === "edit")) {
      var dueTextEl = document.getElementById("dueDateText");
      var duePickerEl = document.getElementById("dueDatePicker");
      var dueSchedEl = document.getElementById("dueScheduleSelect");
      if (duePickerEl && dueTextEl) {
        duePickerEl.addEventListener("change", function () {
          if (duePickerEl.value) dueTextEl.value = duePickerEl.value;
        });
      }
      if (dueSchedEl && dueTextEl) {
        function applyScheduleToDue() {
          var sid = dueSchedEl.value;
          if (!sid) return;
          var st0 = loadState();
          var sch = st0.schedules.find(function (x) {
            return x.id === sid;
          });
          if (sch) {
            dueTextEl.value = sch.endDate;
            if (duePickerEl) duePickerEl.value = sch.endDate;
          }
        }
        dueSchedEl.addEventListener("change", applyScheduleToDue);
        dueSchedEl.addEventListener("input", applyScheduleToDue);
        dueSchedEl.addEventListener("click", function () {
          dueSchedEl.focus();
        });
      }
      var btnDuePick = document.getElementById("btn-due-open-picker");
      if (btnDuePick && duePickerEl) {
        btnDuePick.addEventListener("click", function () {
          try {
            if (typeof duePickerEl.showPicker === "function") {
              duePickerEl.showPicker();
            } else {
              duePickerEl.focus();
            }
          } catch (err) {
            duePickerEl.focus();
          }
        });
      }
      var ft = document.getElementById("form-task");
      if (ft) {
        ft.addEventListener("submit", function (e) {
          e.preventDefault();
          var st = loadState();
          var f = new FormData(ft);
          var title = String(f.get("title") || "").trim();
          var description = String(f.get("description") || "");
          var assigneeId = String(f.get("assigneeId") || "");
          var dueDate = String(f.get("dueDate") || "").trim();
          if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
            alert("마감일은 YYYY-MM-DD 형식으로 입력하거나 달력·캘린더에서 선택하세요.");
            return;
          }
          dueDate = dueDate || "";
          var priority = String(f.get("priority") || "MED");
          var status = String(f.get("status") || "TODO");
          var dependsOnTaskId = String(f.get("dependsOnTaskId") || "") || null;
          var existingId = String(f.get("id") || "");
          if (dependsOnTaskId && wouldCreateCycle(st, existingId || "new", dependsOnTaskId)) {
            alert("의존성이 순환을 만듭니다. 다른 업무를 선택하세요.");
            return;
          }
          if (existingId) {
            var t = taskById(st, existingId);
            if (!t) return;
            var before = JSON.stringify({
              status: t.status,
              assigneeId: t.assigneeId,
              priority: t.priority,
              dueDate: t.dueDate,
            });
            t.title = title;
            t.description = description;
            t.assigneeId = assigneeId;
            t.dueDate = dueDate || null;
            t.priority = priority;
            t.status = status;
            t.dependsOnTaskId = dependsOnTaskId;
            t.updatedAt = new Date().toISOString();
            var after = JSON.stringify({
              status: t.status,
              assigneeId: t.assigneeId,
              priority: t.priority,
              dueDate: t.dueDate,
            });
            if (before !== after) {
              addActivity(st, t.id, uid, "업무가 수정되었습니다. (상태/담당/우선순위/마감 등)");
            }
            syncDueDateScheduleForTask(st, t);
            saveState(st);
            navigate("/tasks/" + t.id);
          } else {
            var tid = id();
            if (dependsOnTaskId && wouldCreateCycle(st, tid, dependsOnTaskId)) {
              alert("의존성이 순환을 만듭니다.");
              return;
            }
            st.tasks.push({
              id: tid,
              title: title,
              description: description,
              assigneeId: assigneeId,
              status: status,
              priority: priority,
              dueDate: dueDate || null,
              dependsOnTaskId: dependsOnTaskId,
              createdById: uid,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            });
            addActivity(st, tid, uid, "업무가 생성되었습니다.");
            var tNew = taskById(st, tid);
            if (tNew) syncDueDateScheduleForTask(st, tNew);
            saveState(st);
            navigate("/tasks/" + tid);
          }
        });
      }
      var del = document.getElementById("btn-del-task");
      if (del) {
        del.addEventListener("click", function () {
          if (!confirm("이 업무를 삭제할까요? 관련 댓글·첨부·이력도 함께 삭제됩니다.")) return;
          var st = loadState();
          var tid = String(new FormData(ft).get("id") || "");
          st.tasks = st.tasks.filter(function (x) {
            return x.id !== tid;
          });
          st.tasks.forEach(function (x) {
            if (x.dependsOnTaskId === tid) x.dependsOnTaskId = null;
          });
          st.comments = st.comments.filter(function (c) {
            return c.taskId !== tid;
          });
          st.attachments = st.attachments.filter(function (a) {
            return a.taskId !== tid;
          });
          st.activityLogs = st.activityLogs.filter(function (l) {
            return l.taskId !== tid;
          });
          st.issues = st.issues.filter(function (i) {
            return i.taskId !== tid;
          });
          st.schedules = st.schedules.filter(function (s) {
            return !(s.fromTaskDue === true && s.relatedTaskId === tid);
          });
          st.schedules.forEach(function (s) {
            if (s.relatedTaskId === tid) s.relatedTaskId = null;
          });
          saveState(st);
          navigate("/tasks");
        });
      }
    }

    if (parts[0] === "tasks" && parts[1] && !parts[2]) {
      var fc = document.getElementById("form-comment");
      if (fc) {
        fc.addEventListener("submit", function (e) {
          e.preventDefault();
          var st = loadState();
          var f = new FormData(fc);
          var content = String(f.get("content") || "").trim();
          if (!content) return;
          st.comments.push({
            id: id(),
            taskId: parts[1],
            userId: uid,
            content: content,
            createdAt: new Date().toISOString(),
          });
          addActivity(st, parts[1], uid, "댓글이 등록되었습니다.");
          saveState(st);
          navigate("/tasks/" + parts[1]);
        });
      }
      var fa = document.getElementById("form-attach");
      if (fa) {
        fa.addEventListener("submit", function (e) {
          e.preventDefault();
          var inp = fa.querySelector('input[type="file"]');
          var file = inp.files && inp.files[0];
          if (!file) return;
          if (file.size > MAX_ATTACHMENT_BYTES) {
            alert("파일이 너무 큽니다. 1MB 이하로 선택하세요.");
            return;
          }
          var reader = new FileReader();
          reader.onload = function () {
            var st = loadState();
            st.attachments.push({
              id: id(),
              taskId: parts[1],
              userId: uid,
              name: file.name,
              dataUrl: reader.result,
              createdAt: new Date().toISOString(),
            });
            addActivity(st, parts[1], uid, "파일이 첨부되었습니다: " + file.name);
            saveState(st);
            navigate("/tasks/" + parts[1]);
          };
          reader.readAsDataURL(file);
        });
      }
    }

    if (path.indexOf("/calendar") === 0) {
      document.getElementById("cal-prev").addEventListener("click", function () {
        calMonth--;
        if (calMonth < 0) {
          calMonth = 11;
          calYear--;
        }
        navigate("/calendar");
      });
      document.getElementById("cal-next").addEventListener("click", function () {
        calMonth++;
        if (calMonth > 11) {
          calMonth = 0;
          calYear++;
        }
        navigate("/calendar");
      });
      document.getElementById("cal-today").addEventListener("click", function () {
        var n = new Date();
        calYear = n.getFullYear();
        calMonth = n.getMonth();
        navigate("/calendar");
      });
      function pushScheduleWithOverlapCheck(st, sched) {
        var ov = findScheduleOverlaps(st, sched, null);
        if (ov.length) {
          var names = ov.map(function (x) {
            return x.title;
          }).join(", ");
          if (!confirm("같은 담당자의 캘린더 항목과 기간이 겹칩니다: " + names + "\n그래도 등록할까요?")) return false;
        }
        st.schedules.push(sched);
        saveState(st);
        return true;
      }
      function syncLinkedTaskFromSchedule(st, relatedTaskId, endDate, ownerId) {
        if (!relatedTaskId) return;
        var tsk = taskById(st, relatedTaskId);
        if (!tsk) return;
        tsk.dueDate = endDate;
        tsk.assigneeId = ownerId;
        tsk.updatedAt = new Date().toISOString();
      }
      var overlayNew = document.getElementById("overlay-cal-new");
      var overlayDay = document.getElementById("overlay-cal-day");
      function attachOverlayBackdropClose(ov) {
        if (!ov) return;
        ov.addEventListener("click", function (e) {
          if (e.target === ov) ov.classList.add("hidden");
        });
      }
      attachOverlayBackdropClose(overlayNew);
      attachOverlayBackdropClose(overlayDay);
      var fs = document.getElementById("form-schedule");
      var btnOpenNew = document.getElementById("btn-cal-open-new");
      var btnNewClose = document.getElementById("btn-cal-new-close");
      if (btnOpenNew && overlayNew && fs) {
        btnOpenNew.addEventListener("click", function () {
          fs.reset();
          var tiso = todayISODate();
          var ns = document.getElementById("new-startDate");
          var ne = document.getElementById("new-endDate");
          var no = document.getElementById("new-ownerId");
          if (ns) ns.value = tiso;
          if (ne) ne.value = tiso;
          if (no) no.value = uid;
          overlayNew.classList.remove("hidden");
        });
      }
      if (btnNewClose && overlayNew) {
        btnNewClose.addEventListener("click", function () {
          overlayNew.classList.add("hidden");
        });
      }
      if (fs) {
        fs.addEventListener("submit", function (e) {
          e.preventDefault();
          var st = loadState();
          var f = new FormData(fs);
          var title = String(f.get("title") || "").trim();
          var startDate = String(f.get("startDate") || "");
          var endDate = String(f.get("endDate") || "");
          var ownerId = String(f.get("ownerId") || "");
          var relatedTaskId = String(f.get("relatedTaskId") || "") || null;
          if (compareDate(startDate, endDate) > 0) {
            alert("종료일이 시작일보다 빠릅니다.");
            return;
          }
          var repeatType = String(f.get("repeatType") || REPEAT.NONE);
          var repeatUntil = String(f.get("repeatUntil") || "").trim() || null;
          var sched = {
            id: id(),
            title: title,
            startDate: startDate,
            endDate: endDate,
            relatedTaskId: relatedTaskId,
            ownerId: ownerId,
            fromTaskDue: false,
            repeatType: repeatType,
            repeatUntil: repeatUntil,
            repeatWeekday: null,
            repeatMonthOrdinal: null,
            createdAt: new Date().toISOString(),
          };
          applyRepeatMetaFromStart(sched, startDate);
          syncLinkedTaskFromSchedule(st, relatedTaskId, endDate, ownerId);
          if (!pushScheduleWithOverlapCheck(st, sched)) return;
          fs.reset();
          if (overlayNew) overlayNew.classList.add("hidden");
          navigate("/calendar");
        });
      }
      var fPick = document.getElementById("form-schedule-pick");
      if (fPick) {
        fPick.addEventListener("submit", function (e) {
          e.preventDefault();
          var st = loadState();
          var f = new FormData(fPick);
          var title = String(f.get("title") || "").trim();
          var startDate = String(f.get("startDate") || "");
          var endDate = String(f.get("endDate") || "");
          var ownerId = String(f.get("ownerId") || "");
          var relatedTaskId = String(f.get("relatedTaskId") || "") || null;
          if (compareDate(startDate, endDate) > 0) {
            alert("종료일이 시작일보다 빠릅니다.");
            return;
          }
          var repeatType2 = String(f.get("repeatType") || REPEAT.NONE);
          var repeatUntil2 = String(f.get("repeatUntil") || "").trim() || null;
          var sched = {
            id: id(),
            title: title,
            startDate: startDate,
            endDate: endDate,
            relatedTaskId: relatedTaskId,
            ownerId: ownerId,
            fromTaskDue: false,
            repeatType: repeatType2,
            repeatUntil: repeatUntil2,
            repeatWeekday: null,
            repeatMonthOrdinal: null,
            createdAt: new Date().toISOString(),
          };
          applyRepeatMetaFromStart(sched, startDate);
          syncLinkedTaskFromSchedule(st, relatedTaskId, endDate, ownerId);
          if (!pushScheduleWithOverlapCheck(st, sched)) return;
          fPick.reset();
          if (overlayDay) overlayDay.classList.add("hidden");
          navigate("/calendar");
        });
      }
      var dayHint = document.getElementById("cal-day-modal-hint");
      document.querySelectorAll(".cal-day-pick").forEach(function (cell) {
        cell.addEventListener("click", function (e) {
          if (e.target.closest(".cal-ev")) return;
          var iso = cell.getAttribute("data-pick-date");
          if (!iso || !overlayDay) return;
          if (dayHint) {
            dayHint.textContent =
              "선택한 날짜: " + iso + " (시작·종료일을 조정할 수 있습니다)";
          }
          var ps = document.getElementById("pick-startDate");
          var pe = document.getElementById("pick-endDate");
          var po = document.getElementById("pick-ownerId");
          if (ps) ps.value = iso;
          if (pe) pe.value = iso;
          if (po) po.value = uid;
          if (fPick) fPick.reset();
          if (ps) ps.value = iso;
          if (pe) pe.value = iso;
          if (po) po.value = uid;
          overlayDay.classList.remove("hidden");
        });
      });
      var btnCloseDay = document.getElementById("btn-close-cal-day");
      if (btnCloseDay && overlayDay) {
        btnCloseDay.addEventListener("click", function () {
          overlayDay.classList.add("hidden");
        });
      }
      var modal = document.getElementById("schedule-modal");
      var modalBody = document.getElementById("schedule-modal-body");
      document.querySelectorAll(".cal-ev").forEach(function (el) {
        el.addEventListener("click", function (e) {
          e.stopPropagation();
          var sid = el.getAttribute("data-schedule-id");
          var st = loadState();
          var s = st.schedules.find(function (x) {
            return x.id === sid;
          });
          if (!s) return;
          var tk = s.relatedTaskId ? taskById(st, s.relatedTaskId) : null;
          var ow = getUser(st, s.ownerId);
          var autoNote =
            s.fromTaskDue === true
              ? '<p class="small flash flash-ok" style="margin-bottom:10px">이 일정은 업무 <b>마감일</b>과 연동됩니다. 저장하면 업무 페이지의 마감일·담당자도 함께 바뀝니다.</p>'
              : "";
          var taskLink = tk
            ? '<p class="small">연결 업무: <a href="#/tasks/' +
              escapeHtml(tk.id) +
              '">' +
              escapeHtml(tk.title) +
              '</a> · <a href="#/tasks/' +
              escapeHtml(tk.id) +
              '/edit">업무 수정</a></p>'
            : "";
          modalBody.innerHTML =
            autoNote +
            "<p class=\"small muted\"><b>담당:</b> " +
            escapeHtml(ow ? ow.name : "-") +
            "</p>" +
            taskLink +
            buildScheduleEditorFormHTML(st, s);
          if (modal) {
            modal.classList.remove("hidden");
            modal.dataset.scheduleId = sid;
            modal.scrollIntoView({ behavior: "smooth", block: "nearest" });
          }
          var editForm = document.getElementById("form-edit-schedule");
          if (editForm) {
            editForm.addEventListener("submit", function onEditSched(ev) {
              ev.preventDefault();
              var st2 = loadState();
              var sf = new FormData(editForm);
              var sid2 = String(sf.get("scheduleId") || "");
              var sch = st2.schedules.find(function (x) {
                return x.id === sid2;
              });
              if (!sch) return;
              var title = String(sf.get("title") || "").trim();
              var startDate = String(sf.get("startDate") || "");
              var endDate = String(sf.get("endDate") || "");
              var ownerId = String(sf.get("ownerId") || "");
              var relatedTaskId = String(sf.get("relatedTaskId") || "") || null;
              if (compareDate(startDate, endDate) > 0) {
                alert("종료일이 시작일보다 빠릅니다.");
                return;
              }
              var probe = {
                startDate: startDate,
                endDate: endDate,
                ownerId: ownerId,
              };
              var ov = findScheduleOverlaps(st2, probe, sid2);
              if (ov.length) {
                var names = ov.map(function (x) {
                  return x.title;
                }).join(", ");
                if (
                  !confirm(
                    "같은 담당자의 다른 일정과 겹칩니다: " +
                      names +
                      "\n그래도 저장할까요?"
                  )
                )
                  return;
              }
              var oldRel = sch.relatedTaskId;
              var wasFromDue = sch.fromTaskDue === true;

              sch.startDate = startDate;
              sch.endDate = endDate;
              sch.ownerId = ownerId;
              sch.relatedTaskId = relatedTaskId;
              if (!relatedTaskId) {
                sch.fromTaskDue = false;
              } else if (relatedTaskId !== oldRel) {
                sch.fromTaskDue = false;
              }

              sch.repeatType = String(sf.get("repeatType") || REPEAT.NONE);
              sch.repeatUntil = String(sf.get("repeatUntil") || "").trim() || null;
              if (!sch.fromTaskDue) {
                applyRepeatMetaFromStart(sch, sch.startDate);
              } else {
                sch.repeatType = REPEAT.NONE;
                sch.repeatUntil = null;
                sch.repeatWeekday = null;
                sch.repeatMonthOrdinal = null;
              }

              var tsk = relatedTaskId ? taskById(st2, relatedTaskId) : null;
              if (wasFromDue && sch.fromTaskDue && tsk) {
                var stripped = title.replace(/^\[마감\]\s*/i, "").trim();
                if (stripped) tsk.title = stripped;
                sch.title = "[마감] " + tsk.title;
                tsk.dueDate = endDate;
                tsk.assigneeId = ownerId;
                tsk.updatedAt = new Date().toISOString();
              } else {
                sch.title = title;
                if (tsk) {
                  tsk.dueDate = endDate;
                  tsk.assigneeId = ownerId;
                  tsk.updatedAt = new Date().toISOString();
                }
              }
              saveState(st2);
              if (modal) modal.classList.add("hidden");
              navigate("/calendar");
            });
          }
        });
      });
      var close = document.getElementById("btn-close-schedule");
      if (close && modal) {
        close.addEventListener("click", function () {
          modal.classList.add("hidden");
        });
      }
      var delS = document.getElementById("btn-del-schedule");
      if (delS && modal) {
        delS.addEventListener("click", function () {
          var sid = modal.dataset.scheduleId;
          if (!sid || !confirm("이 캘린더 항목을 삭제할까요?")) return;
          var st = loadState();
          st.schedules = st.schedules.filter(function (x) {
            return x.id !== sid;
          });
          saveState(st);
          modal.classList.add("hidden");
          navigate("/calendar");
        });
      }
    }

    if (path.indexOf("/issues") === 0) {
      var fi = document.getElementById("form-issue");
      if (fi) {
        fi.addEventListener("submit", function (e) {
          e.preventDefault();
          var st = loadState();
          var f = new FormData(fi);
          st.issues.push({
            id: id(),
            title: String(f.get("title") || "").trim(),
            description: String(f.get("description") || ""),
            taskId: String(f.get("taskId") || ""),
            status: String(f.get("status") || "OPEN"),
            priority: String(f.get("priority") || "MED"),
            reporterId: uid,
            createdAt: new Date().toISOString(),
          });
          saveState(st);
          fi.reset();
          navigate("/issues");
        });
      }
      document.querySelectorAll(".issue-st").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var iid = btn.getAttribute("data-issue-id");
          var next = btn.getAttribute("data-next");
          var st = loadState();
          var iss = st.issues.find(function (x) {
            return x.id === iid;
          });
          if (!iss) return;
          if (iss.status === next) return;
          iss.status = next;
          saveState(st);
          navigate("/issues");
        });
      });
    }

    if (path.indexOf("/members") === 0) {
      var fam = document.getElementById("form-add-member");
      if (fam) {
        fam.addEventListener("submit", function (e) {
          e.preventDefault();
          var st = loadState();
          var f = new FormData(fam);
          var email = String(f.get("email") || "").trim().toLowerCase();
          if (st.users.some(function (u) {
            return u.email.toLowerCase() === email;
          })) {
            alert("이미 사용 중인 이메일입니다.");
            return;
          }
          st.users.push({
            id: id(),
            name: String(f.get("name") || "").trim(),
            email: email,
            password: String(f.get("password") || ""),
            role: String(f.get("role") || "MEMBER") === "ADMIN" ? "ADMIN" : "MEMBER",
            org1: String(f.get("org1") || "").trim(),
            org2: String(f.get("org2") || "").trim(),
            org3: String(f.get("org3") || "").trim(),
            jobTitle: String(f.get("jobTitle") || "").trim(),
            jobRank: String(f.get("jobRank") || "").trim(),
          });
          saveState(st);
          fam.reset();
          navigate("/members");
        });
      }
      var memberSearchIn = document.getElementById("member-list-search");
      if (memberSearchIn) {
        function applyMemberListSearch() {
          var q = String(memberSearchIn.value || "")
            .trim()
            .toLowerCase();
          document.querySelectorAll("tr.member-row").forEach(function (tr) {
            var hay = String(tr.getAttribute("data-search-haystack") || "").toLowerCase();
            tr.style.display = !q || hay.indexOf(q) !== -1 ? "" : "none";
          });
        }
        memberSearchIn.addEventListener("input", applyMemberListSearch);
      }
      var btnDlCsv = document.getElementById("btn-dl-member-csv");
      if (btnDlCsv) {
        btnDlCsv.addEventListener("click", function () {
          downloadMemberTemplateCsv();
        });
      }
      var btnUpCsv = document.getElementById("btn-upload-member-csv");
      var fileCsv = document.getElementById("file-member-csv");
      if (btnUpCsv && fileCsv) {
        btnUpCsv.addEventListener("click", function () {
          if (!fileCsv.files || !fileCsv.files[0]) {
            alert("CSV 파일을 먼저 선택하세요.");
            return;
          }
          var file = fileCsv.files[0];
          var reader = new FileReader();
          reader.onload = function () {
            var st = loadState();
            var res = importUsersFromCsvText(st, String(reader.result || ""));
            saveState(st);
            var msg =
              res.added +
              "명이 등록되었습니다." +
              (res.errs.length ? "\n\n건너뜀/오류:\n" + res.errs.slice(0, 15).join("\n") : "");
            alert(msg);
            navigate("/members");
          };
          reader.readAsText(file, "UTF-8");
        });
      }
      document.querySelectorAll(".member-role").forEach(function (sel) {
        sel.addEventListener("change", function () {
          var userId = sel.getAttribute("data-user-id");
          var newRole = sel.value;
          var st = loadState();
          var u = getUser(st, userId);
          if (!u) return;
          var prev = u.role;
          u.role = newRole;
          if (countAdmins(st) < 1) {
            u.role = prev;
            alert("관리자는 최소 1명이어야 합니다.");
            renderApp();
            return;
          }
          saveState(st);
          navigate("/members");
        });
      });
      document.querySelectorAll(".member-del").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var victimId = btn.getAttribute("data-user-id");
          if (!confirm("이 회원을 삭제할까요? 담당 업무·캘린더 담당은 다른 관리자(또는 첫 번째 계정)로 옮깁니다.")) return;
          var st = loadState();
          var victim = getUser(st, victimId);
          if (!victim) return;
          if (victim.role === "ADMIN" && countAdmins(st) <= 1) {
            alert("마지막 관리자는 삭제할 수 없습니다.");
            return;
          }
          var replacement = st.users.find(function (u) {
            return u.role === "ADMIN" && u.id !== victimId;
          });
          if (!replacement) {
            replacement = st.users.find(function (u) {
              return u.id !== victimId;
            });
          }
          if (!replacement) {
            alert("삭제할 수 없습니다.");
            return;
          }
          var repId = replacement.id;
          st.tasks.forEach(function (t) {
            if (t.assigneeId === victimId) t.assigneeId = repId;
            if (t.createdById === victimId) t.createdById = repId;
          });
          st.schedules.forEach(function (s) {
            if (s.ownerId === victimId) s.ownerId = repId;
          });
          st.issues.forEach(function (i) {
            if (i.reporterId === victimId) i.reporterId = repId;
          });
          st.comments.forEach(function (c) {
            if (c.userId === victimId) c.userId = repId;
          });
          st.attachments.forEach(function (a) {
            if (a.userId === victimId) a.userId = repId;
          });
          st.activityLogs.forEach(function (l) {
            if (l.userId === victimId) l.userId = repId;
          });
          st.users = st.users.filter(function (u) {
            return u.id !== victimId;
          });
          saveState(st);
          navigate("/members");
        });
      });
      document.querySelectorAll(".member-pw").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var userId = btn.getAttribute("data-user-id");
          var pw = prompt("새 비밀번호를 입력하세요:");
          if (pw == null || pw === "") return;
          var st = loadState();
          var u = getUser(st, userId);
          if (!u) return;
          u.password = pw;
          saveState(st);
          alert("비밀번호가 변경되었습니다.");
          navigate("/members");
        });
      });
    }

    if (path.indexOf("/settings") === 0) {
      var rs = document.getElementById("btn-reseed");
      if (rs)
        rs.addEventListener("click", function () {
          if (!confirm("예제 데이터로 덮어쓸까요?")) return;
          var st = defaultState();
          seedDemoData(st);
          saveState(st);
          navigate("/dashboard");
        });
      var wp = document.getElementById("btn-wipe");
      if (wp)
        wp.addEventListener("click", function () {
          if (!confirm("모든 업무/캘린더/이슈/댓글/첨부/이력을 삭제합니다. 계속할까요?")) return;
          var st = defaultState();
          st.tasks = [];
          st.schedules = [];
          st.issues = [];
          st.comments = [];
          st.attachments = [];
          st.activityLogs = [];
          saveState(st);
          navigate("/dashboard");
        });
    }
  }

  function wireKanbanDnD(state, uid) {
    var dragId = null;
    document.querySelectorAll(".kcard").forEach(function (card) {
      card.addEventListener("dragstart", function (e) {
        dragId = card.getAttribute("data-task-id");
        card.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
      });
      card.addEventListener("dragend", function () {
        card.classList.remove("dragging");
        dragId = null;
      });
    });
    document.querySelectorAll(".klist").forEach(function (zone) {
      zone.addEventListener("dragover", function (e) {
        e.preventDefault();
      });
      zone.addEventListener("drop", function (e) {
        e.preventDefault();
        var newStatus = zone.getAttribute("data-drop");
        if (!dragId || !newStatus) return;
        var st = loadState();
        var t = taskById(st, dragId);
        if (!t) return;
        if (t.status !== newStatus) {
          t.status = newStatus;
          t.updatedAt = new Date().toISOString();
          addActivity(st, t.id, uid, "상태가 " + statusLabel(newStatus) + "(으)로 변경되었습니다.");
          saveState(st);
        }
        var hq =
          location.hash.indexOf("?") >= 0
            ? location.hash.slice(location.hash.indexOf("?") + 1)
            : "";
        var q = parseQuery(hq);
        navigate(
          "/tasks?" +
            [
              q.assignee ? "assignee=" + encodeURIComponent(q.assignee) : "",
              q.status ? "status=" + encodeURIComponent(q.status) : "",
              q.priority ? "priority=" + encodeURIComponent(q.priority) : "",
              "view=kanban",
            ]
              .filter(Boolean)
              .join("&")
        );
      });
    });
  }

  window.addEventListener("hashchange", renderApp);
  window.addEventListener("DOMContentLoaded", function () {
    if (!location.hash || location.hash === "#") {
      location.hash = getSessionUserId() ? "#/dashboard" : "#/login";
    }
    renderApp();
  });
})();
