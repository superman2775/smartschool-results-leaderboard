// content.js
console.log("[GradesPanel] content.js loaded on", window.location.href);

const SCHOOL_YEARS = [
  { id: "2025_2026", label: "2025–2026", start: "2025-09-01", end: "2026-08-31" },
  { id: "2024_2025", label: "2024–2025", start: "2024-09-01", end: "2025-08-31" }
];

// VERVANG DIT door jouw echte GitHub Pages URL en origin
const LEADERBOARD_URL = "https://superman2775.github.io/smartschool-results-leaderboard/website/index.html";
const LEADERBOARD_ORIGIN = "https://superman2775.github.io";

function getSubdomain() {
  const host = window.location.hostname;
  return host.split(".")[0];
}

function parsePoints(desc) {
  if (!desc) return null;
  const match = desc.match(/([\d.,]+)\s*\/\s*([\d.,]+)/);
  if (!match) return null;
  const earned = parseFloat(match[1].replace(",", "."));
  const max = parseFloat(match[2].replace(",", "."));
  if (Number.isNaN(earned) || Number.isNaN(max) || max <= 0) return null;
  return { earned, max };
}

async function fetchEvaluations(yearConfig) {
  const sub = getSubdomain();
  const url = `https://${sub}.smartschool.be/results/api/v1/evaluations/?pageNumber=1&itemsOnPage=500000&startDate=${yearConfig.start}&endDate=${yearConfig.end}`;
  console.log("[GradesPanel] fetching", url);

  const res = await fetch(url, {
    credentials: "include",
    headers: { Accept: "application/json" }
  });
  if (!res.ok) throw new Error("API error " + res.status);
  const data = await res.json();
  return Array.isArray(data) ? data : data.items || [];
}

function buildStats(raw, yearConfig) {
  const coursesMap = new Map();

  raw
    .filter(ev => ev.doesCount && ev.courses?.length)
    .forEach(ev => {
      const course = ev.courses[0];
      const key = course.id;
      if (!coursesMap.has(key)) {
        coursesMap.set(key, {
          courseId: course.id,
          courseName: course.name,
          evaluations: [],
          avgPercent: 0
        });
      }
      const c = coursesMap.get(key);

      const graphic = ev.graphic || {};
      const parsed = parsePoints(graphic.description || "");

      const valueIsNumber = typeof graphic.value === "number";
      const valueIsString = typeof graphic.value === "string";
      const valueStr = valueIsString ? graphic.value.trim() : "";

      // string-waarden als "—" of "" nooit als score tellen
      const valueLooksNumber =
        valueIsString &&
        valueStr !== "—" &&
        valueStr !== "" &&
        !Number.isNaN(Number(valueStr));

      // geldig als: echte numerieke value (percentage) én geen text-type
      const hasValue = valueIsNumber && graphic.type !== "text";
      const hasPoints = !!parsed;

      // lege / tekstuele scores (bv. type:"text", value:"—") niet meetellen
      if (!hasValue && !hasPoints) {
        return;
      }

      const percent = hasValue
        ? Number(graphic.value)
        : (parsed.earned / parsed.max) * 100;

      c.evaluations.push({
        id: ev.identifier,
        name: ev.name,
        date: ev.date,
        percent,
        description: graphic.description || "",
        color: graphic.color || null,
        pointsEarned: parsed ? parsed.earned : null,
        pointsMax: parsed ? parsed.max : null
      });
    });

  for (const c of coursesMap.values()) {
    if (!c.evaluations.length) continue;
    c.avgPercent =
      c.evaluations.reduce((s, e) => s + e.percent, 0) / c.evaluations.length;
  }

  const courses = Array.from(coursesMap.values());
  courses.sort((a, b) => b.avgPercent - a.avgPercent);

  const globalAvg = calcGlobalAvg(courses);
  const analysis = calcYearMonthAllTime(raw, yearConfig);

  return {
    yearId: yearConfig.id,
    yearLabel: yearConfig.label,
    courses,
    globalAvg,
    analysis
  };
}

// globaal gemiddelde punt-gebaseerd, met hoge precisie
function calcGlobalAvg(courses) {
  let totalEarned = 0;
  let totalMax = 0;

  courses.forEach(c => {
    (c.evaluations || []).forEach(e => {
      if (e.pointsEarned != null && e.pointsMax != null) {
        totalEarned += e.pointsEarned;
        totalMax += e.pointsMax;
      } else {
        totalEarned += e.percent;
        totalMax += 100;
      }
    });
  });

  if (totalMax === 0) return 0;
  return (totalEarned / totalMax) * 100;
}

function calcYearMonthAllTime(raw, yearConfig, now = new Date()) {
  let yearSum = 0, yearMax = 0;
  let monthSum = 0, monthMax = 0;
  let allSum = 0, allMax = 0;

  const thisYear = now.getFullYear();
  const thisMonth = now.getMonth();

  raw
    .filter(ev => ev.doesCount && ev.courses?.length)
    .forEach(ev => {
      const graphic = ev.graphic || {};
      const parsed = parsePoints(graphic.description || "");

      const valueIsNumber = typeof graphic.value === "number";
      const valueIsString = typeof graphic.value === "string";
      const valueStr = valueIsString ? graphic.value.trim() : "";

      const valueLooksNumber =
        valueIsString &&
        valueStr !== "—" &&
        valueStr !== "" &&
        !Number.isNaN(Number(valueStr));

      const hasValue = valueIsNumber && graphic.type !== "text";
      const hasPoints = !!parsed;

      if (!hasValue && !hasPoints) {
        return;
      }

      const earned = hasPoints ? parsed.earned : Number(graphic.value);
      const max = hasPoints ? parsed.max : 100;

      allSum += earned;
      allMax += max;

      const d = new Date(ev.date);
      if (
        d >= new Date(yearConfig.start + "T00:00:00") &&
        d <= new Date(yearConfig.end + "T23:59:59")
      ) {
        yearSum += earned;
        yearMax += max;
      }

      if (d.getFullYear() === thisYear && d.getMonth() === thisMonth) {
        monthSum += earned;
        monthMax += max;
      }
    });

  return {
    yearPercent: yearMax > 0 ? (yearSum / yearMax) * 100 : 0,
    monthPercent: monthMax > 0 ? (monthSum / monthMax) * 100 : 0,
    allTimePercent: allMax > 0 ? (allSum / allMax) * 100 : 0
  };
}

// compacte leaderboard-data
function buildLeaderboardPayload(stats) {
  const courses = (stats.courses || []).map(c => ({
    id: c.courseId,
    name: c.courseName,
    avgPercent: Number(c.avgPercent.toFixed(2)),
    evaluations: (c.evaluations || []).map(e => ({
      id: e.id,
      name: e.name,
      date: e.date,
      percent: Number(e.percent.toFixed(2)),
      color: e.color || null,
      description: e.description || ""
    }))
  }));

  return {
    yearId: stats.yearId,
    yearLabel: stats.yearLabel,
    globalAvg: Number(stats.globalAvg.toFixed(2)),
    courses
  };
}

function ensureStyles() {
  if (document.getElementById("grades-panel-styles")) return;
  const style = document.createElement("style");
  style.id = "grades-panel-styles";
  style.textContent = `
    #gradesPanel {
      box-sizing: border-box;
      font-family: Open Sans, Helvetica Neue, helvetica, sans-serif;
      position: fixed;
      left: 0;
      right: 0;
      top: 48px;
      bottom: 0;
      z-index: 50;
      background: #0b1020;
      color: #f5f5f5;
      padding: 10px 16px 12px;
      border-top: 1px solid rgba(0,0,0,0.2);
      box-shadow: 0 4px 12px rgba(0,0,0,0.25);
      overflow-y: auto;
    }
    #gradesPanel[hidden] { display: none; }

    #gradesPanel h2 {
      margin: 0 0 6px;
      font-size: 1.15rem;
      letter-spacing: 0.02em;
    }
    #gradesPanel .grades-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 6px;
    }
    #gradesPanel .badge {
      display: inline-flex;
      align-items: center;
      padding: 2px 8px;
      font-size: 0.75rem;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,0.2);
      background: rgba(0,0,0,0.15);
    }
    #gradesPanel .badge span {
      margin-left: 4px;
      font-weight: 600;
    }
    #gradesPanel .badge--good { background: rgba(46,204,113,0.16); border-color: rgba(46,204,113,0.7); }
    #gradesPanel .badge--ok { background: rgba(241,196,15,0.16); border-color: rgba(241,196,15,0.7); }
    #gradesPanel .badge--bad { background: rgba(231,76,60,0.16); border-color: rgba(231,76,60,0.7); }

    #gradesPanel .global-bar-wrapper {
      margin-bottom: 8px;
    }
    #gradesPanel .global-bar-label {
      font-size: 0.8rem;
      display: flex;
      justify-content: spaceBetween;
      margin-bottom: 2px;
      opacity: 0.9;
    }
    #gradesPanel .global-bar {
      position: relative;
      width: 100%;
      height: 8px;
      border-radius: 999px;
      background: rgba(255,255,255,0.08);
      overflow: hidden;
    }
    #gradesPanel .global-bar-fill {
      position: absolute;
      top: 0;
      left: 0;
      height: 100%;
      border-radius: 999px;
      background: linear-gradient(90deg, #e74c3c, #f1c40f, #2ecc71);
      transform-origin: left center;
    }

    #gradesPanel .grades-analysis {
      font-size: 0.8rem;
      margin-bottom: 8px;
      opacity: 0.9;
    }
    #gradesPanel .grades-analysis span {
      margin-right: 12px;
    }
    #gradesPanel .grades-controls {
      margin-bottom: 10px;
    }
    #gradesPanel .grades-controls button {
      font: inherit;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,0.2);
      background: rgba(255,255,255,0.05);
      color: #fff;
      padding: 4px 10px;
      cursor: pointer;
      font-size: 0.8rem;
    }

    #gradesPanel .leaderboard-wrapper {
      margin-bottom: 10px;
    }
    #gradesPanel .leaderboard-wrapper button {
      font: inherit;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,0.2);
      background: rgba(255,255,255,0.08);
      color: #fff;
      padding: 4px 10px;
      cursor: pointer;
      font-size: 0.8rem;
    }

    #gradesPanel .courses-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 8px;
    }
    #gradesPanel .course {
      border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.1);
      padding: 8px 10px;
      background: linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.01));
    }
    #gradesPanel .course-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      font-size: 0.9rem;
      margin-bottom: 6px;
    }
    #gradesPanel .course-name {
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    #gradesPanel .course-avg {
      font-size: 0.85rem;
      padding: 2px 8px;
      border-radius: 999px;
      border: 1px solid rgba(255,255,255,0.25);
      background: rgba(0,0,0,0.25);
    }
    #gradesPanel .course-avg--good { background: rgba(46,204,113,0.25); border-color: rgba(46,204,113,0.85); }
    #gradesPanel .course-avg--ok { background: rgba(241,196,15,0.25); border-color: rgba(241,196,15,0.85); }
    #gradesPanel .course-avg--bad { background: rgba(231,76,60,0.25); border-color: rgba(231,76,60,0.85); }
    #gradesPanel .course-body {
      font-size: 0.78rem;
      max-height: 180px;
      overflow: auto;
    }
    #gradesPanel .course-body ul {
      padding-left: 14px;
      margin: 0;
    }
    #gradesPanel .course-body li {
      margin-bottom: 2px;
      display: flex;
      align-items: center;
    }
    #gradesPanel .course-body li span.dot {
      margin-right: 7px;
      font-size: 3rem;
    }
  `;
  document.head.appendChild(style);
}

function gradeClass(p) {
  if (p >= 80) return "good";
  if (p >= 60) return "ok";
  return "bad";
}

function renderPanel(container, data) {
  if (!data || !Array.isArray(data.courses) || data.courses.length === 0) {
    container.innerHTML = `<p style="color:#ff8080">Geen punten gevonden voor dit schooljaar.</p>`;
    return;
  }

  container.innerHTML = "";

  const header = document.createElement("div");
  header.className = "grades-header";

  const title = document.createElement("h2");
  title.textContent = `Punten (${data.yearLabel || "schooljaar"})`;
  header.appendChild(title);

  const globalBase = typeof data.globalAvg === "number" ? data.globalAvg : 0;
  const globalBadge = document.createElement("div");
  const cls = gradeClass(globalBase);
  globalBadge.className = `badge badge--${cls}`;
  globalBadge.innerHTML = `Globaal<span>${globalBase.toFixed(2)}%</span>`;
  header.appendChild(globalBadge);

  container.appendChild(header);

  const barWrapper = document.createElement("div");
  barWrapper.className = "global-bar-wrapper";

  const barLabel = document.createElement("div");
  barLabel.className = "global-bar-label";
  barLabel.innerHTML = `<span>0%</span><span>${globalBase.toFixed(2)}%</span><span>100%</span>`;
  barWrapper.appendChild(barLabel);

  const bar = document.createElement("div");
  bar.className = "global-bar";
  const fill = document.createElement("div");
  fill.className = "global-bar-fill";
  const clamped = Math.max(0, Math.min(100, globalBase));
  fill.style.width = `${clamped}%`;
  bar.appendChild(fill);
  barWrapper.appendChild(bar);

  container.appendChild(barWrapper);

  const a = data.analysis || {};
  if (
    typeof a.yearPercent === "number" ||
    typeof a.monthPercent === "number" ||
    typeof a.allTimePercent === "number"
  ) {
    const analysis = document.createElement("div");
    analysis.className = "grades-analysis";
    const y = typeof a.yearPercent === "number" ? a.yearPercent : 0;
    const m = typeof a.monthPercent === "number" ? a.monthPercent : 0;
    const all = typeof a.allTimePercent === "number" ? a.allTimePercent : 0;
    analysis.innerHTML =
      `<span>Dit jaar: ${y.toFixed(1)}%</span>` +
      `<span>Deze maand: ${m.toFixed(1)}%</span>` +
      `<span>All‑time: ${all.toFixed(1)}%</span>`;
    container.appendChild(analysis);
  }

  const controls = document.createElement("div");
  controls.className = "grades-controls";
  const refreshBtn = document.createElement("button");
  refreshBtn.textContent = "Refresh resultaten";
  refreshBtn.addEventListener("click", () => {
    refreshData(container);
  });
  controls.appendChild(refreshBtn);
  container.appendChild(controls);

  // Leaderboard-wrapper
  const leaderboardWrapper = document.createElement("div");
  leaderboardWrapper.className = "leaderboard-wrapper";

  const leaderboardToggle = document.createElement("button");
  leaderboardToggle.textContent = "Toon leaderboard";

  const iframeContainer = document.createElement("div");
  iframeContainer.style.marginTop = "6px";
  iframeContainer.style.borderRadius = "8px";
  iframeContainer.style.overflow = "hidden";
  iframeContainer.style.border = "1px solid rgba(255,255,255,0.2)";
  iframeContainer.style.display = "none";
  iframeContainer.style.height = "260px";

  const iframe = document.createElement("iframe");
  iframe.src = LEADERBOARD_URL;
  iframe.style.width = "100%";
  iframe.style.height = "100%";
  iframe.style.border = "0";
  iframe.referrerPolicy = "no-referrer";

  iframeContainer.appendChild(iframe);

  leaderboardToggle.addEventListener("click", () => {
    const visible = iframeContainer.style.display !== "none";
    if (visible) {
      iframeContainer.style.display = "none";
      leaderboardToggle.textContent = "Toon leaderboard";
    } else {
      iframeContainer.style.display = "block";
      leaderboardToggle.textContent = "Verberg leaderboard";
      const payload = buildLeaderboardPayload(data);
      iframe.contentWindow.postMessage(
        {
          type: "smartschool-leaderboard-data",
          payload
        },
        LEADERBOARD_ORIGIN
      );
    }
  });

  leaderboardWrapper.appendChild(leaderboardToggle);
  leaderboardWrapper.appendChild(iframeContainer);
  container.appendChild(leaderboardWrapper);

  // Vakken-grid
  const grid = document.createElement("div");
  grid.className = "courses-grid";

  const colorMap = {
    green: "#80dba6",
    yellow: "#f1c40f",
    red: "#e74c3c",
    olive: "#3aa10b",
    steel: "#95a5a6",
    orange: "#e67e22"
  };

  data.courses.forEach(c => {
    const div = document.createElement("div");
    div.className = "course";

    const header = document.createElement("div");
    header.className = "course-header";

    const nameSpan = document.createElement("span");
    nameSpan.className = "course-name";
    nameSpan.textContent = c.courseName || "Onbekend vak";

    const avgBase = typeof c.avgPercent === "number" ? c.avgPercent : 0;
    const cl = gradeClass(avgBase);
    const avgSpan = document.createElement("span");
    avgSpan.className = `course-avg course-avg--${cl}`;
    avgSpan.textContent = `${avgBase.toFixed(1)}%`;

    header.appendChild(nameSpan);
    header.appendChild(avgSpan);
    div.appendChild(header);

    const body = document.createElement("div");
    body.className = "course-body";
    const list = document.createElement("ul");
    (c.evaluations || []).forEach(e => {
      const li = document.createElement("li");

      const dot = document.createElement("span");
      dot.className = "dot";
      dot.textContent = "●";

      const rawColor = e.color;
      dot.style.color = colorMap[rawColor] || "#CCCCCC";

      const text = document.createElement("span");
      text.textContent = `${e.name}: ${e.percent}% (${e.description})`;

      li.appendChild(dot);
      li.appendChild(text);
      list.appendChild(li);
    });
    body.appendChild(list);
    div.appendChild(body);

    grid.appendChild(div);
  });

  container.appendChild(grid);
}

async function loadFromStorage() {
  return new Promise(resolve => {
    chrome.storage.local.get(["gradesData"], data => {
      resolve(data.gradesData || null);
    });
  });
}

async function refreshData(container) {
  try {
    const year = SCHOOL_YEARS[0];
    const evals = await fetchEvaluations(year);
    const stats = buildStats(evals, year);
    chrome.storage.local.set({ gradesData: stats }, () => {
      console.log("[GradesPanel] refreshed gradesData", stats);
      renderPanel(container, stats);
    });
  } catch (e) {
    console.error("[GradesPanel] refresh error", e);
    container.innerHTML = `<p style="color:#ff8080">Kon punten niet laden. Controleer of je ingelogd bent in Smartschool.</p>`;
  }
}

function createPanelBelowTopnav() {
  const topnav = document.querySelector("nav.topnav");
  if (!topnav) {
    console.log("[GradesPanel] no topnav found");
    return null;
  }

  ensureStyles();

  let panel = document.getElementById("gradesPanel");
  if (!panel) {
    panel = document.createElement("div");
    panel.id = "gradesPanel";
    panel.setAttribute("hidden", "hidden");
    topnav.insertAdjacentElement("afterend", panel);
  }

  if (!document.querySelector(".js-btn-grades")) {
    const wrapper = document.createElement("div");
    wrapper.className = "topnav__btn-wrapper";

    const btn = document.createElement("button");
    btn.className = "js-btn-grades topnav__btn";
    btn.type = "button";
    btn.textContent = "Results";
    btn.setAttribute("aria-haspopup", "true");
    btn.setAttribute("aria-expanded", "false");

    btn.addEventListener("click", async () => {
      const isHidden = panel.hasAttribute("hidden");
      if (isHidden) {
        btn.setAttribute("aria-expanded", "true");
        panel.removeAttribute("hidden");
        const data = await loadFromStorage();
        if (data) {
          renderPanel(panel, data);
        } else {
          panel.textContent = "Punten worden geladen...";
          await refreshData(panel);
        }
      } else {
        btn.setAttribute("aria-expanded", "false");
        panel.setAttribute("hidden", "hidden");
      }
    });

    wrapper.appendChild(btn);

    const coursesWrapper = document.querySelector("[data-courses]");
    if (coursesWrapper && coursesWrapper.parentNode === topnav) {
      topnav.insertBefore(wrapper, coursesWrapper);
    } else {
      topnav.appendChild(wrapper);
    }
  }

  return panel;
}

// init
(function init() {
  const panel = createPanelBelowTopnav();
  if (!panel) return;

  loadFromStorage().then(data => {
    if (data) {
      console.log("[GradesPanel] using stored gradesData");
    } else {
      refreshData(panel);
    }
  });
})();
