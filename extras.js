// Хоцролтын бүртгэл (#late) + Сэтгэл мэдрэмжийн статистик (#mood).
// Өгөгдлийг зөвхөн security-definer функцээр (supabase-late-mood.sql) авна:
// нэвтэрсэн админ эсвэл багшийн нийтлэг код зөв байж л уншиж/бичиж чадна.

let X = null; // { supabase, getSession, showToast, escapeHtml }
const esc = s => X.escapeHtml(String(s ?? ""));

export function initExtras(ctx){ X = ctx; }

/* ---------------- нийтлэг туслах ---------------- */
const LS = {
  get(k){ try { return localStorage.getItem(k) || ""; } catch { return ""; } },
};
function staffCode(){ return X.getSession() ? "" : LS.get("iso184_att_code"); }
function staffName(){
  const s = X.getSession();
  return LS.get("iso184_teacher_name") || (s ? s.user.email : "");
}
async function rpc(name, args){
  const { data, error } = await X.supabase.rpc(name, args);
  if(error) throw error;
  return data;
}
function errText(e){
  const m = (e && e.message) || String(e);
  if(/could not find the function|does not exist/i.test(m)) return "Өгөгдлийн сан бэлэн болоогүй байна (SQL ажиллуулаагүй).";
  if(/код буруу/i.test(m)) return "Нэвтрэлтийн хугацаа дууссан эсвэл код солигдсон байна. Зүүн доод талын «Гарах» товчийг дараад дахин нэвтэрнэ үү.";
  return m;
}

const pad = n => String(n).padStart(2, "0");
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const parseYmd = s => { const [y,m,d] = s.split("-").map(Number); return new Date(y, m-1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate()+n); return x; };
const WD = ["Ня","Да","Мя","Лх","Пү","Ба","Бя"];
const MN_MONTH = m => `${m+1}-р сар`;
function fmtDay(d){ return `${d.getFullYear()}.${pad(d.getMonth()+1)}.${pad(d.getDate())} (${WD[d.getDay()]})`; }

// period: "day" | "week" | "month"; anchor: Date
function periodRange(period, anchor){
  const a = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  if(period === "day") return { from:a, to:a, label: fmtDay(a) };
  if(period === "week"){
    const from = addDays(a, -((a.getDay()+6)%7));
    const to = addDays(from, 6);
    return { from, to, label: `${from.getMonth()+1}/${from.getDate()} – ${to.getMonth()+1}/${to.getDate()} (7 хоног)` };
  }
  const from = new Date(a.getFullYear(), a.getMonth(), 1);
  const to = new Date(a.getFullYear(), a.getMonth()+1, 0);
  return { from, to, label: `${a.getFullYear()} оны ${MN_MONTH(a.getMonth())}` };
}
function shiftAnchor(period, anchor, dir){
  if(period === "day") return addDays(anchor, dir);
  if(period === "week") return addDays(anchor, 7*dir);
  return new Date(anchor.getFullYear(), anchor.getMonth()+dir, 1);
}
function daysOf(from, to){ const out=[]; for(let d=new Date(from); d<=to; d=addDays(d,1)) out.push(new Date(d)); return out; }

// Анги эрэмбэлэх: 6А < 6Б < … < 10А < 12Б
const LETTERS = "АБВГДЕЁЖЗИЙКЛМНОӨПРСТУҮФХЦЧШЩЭЮЯ";
function classKey(c){
  const m = /^(\d+)(.*)$/.exec(c || "");
  if(!m) return [999, c];
  const L = m[2].toUpperCase(); const i = LETTERS.indexOf(L[0]);
  return [Number(m[1]), i < 0 ? 99 : i, L];
}
function cmpClass(a, b){
  const A = classKey(a), B = classKey(b);
  for(let i=0;i<3;i++){ if(A[i] < B[i]) return -1; if(A[i] > B[i]) return 1; }
  return 0;
}
// "Овог Нэр" → нэрээр нь (дараа нь овгоор) эрэмбэлнэ
function splitName(full){
  const w = String(full||"").trim().split(/\s+/);
  return w.length > 1 ? { ovog: w[0], ner: w.slice(1).join(" ") } : { ovog: "", ner: w[0] || "" };
}
// Монгол цагаан толгойн дараалал (Ё нь Е-ийн дараа тусдаа үсэг, Ө/Ү нь О/У-ийн дараа)
const MN_ABC = "АБВГДЕЁЖЗИЙКЛМНОӨПРСТУҮФХЦЧШЩЪЫЬЭЮЯ";
function cmpMn(a, b){
  const A = String(a).toUpperCase(), B = String(b).toUpperCase();
  const n = Math.min(A.length, B.length);
  for(let i=0;i<n;i++){
    if(A[i] === B[i]) continue;
    const x = MN_ABC.indexOf(A[i]), y = MN_ABC.indexOf(B[i]);
    if(x >= 0 && y >= 0) return x - y;
    if(x >= 0) return 1;   // тэмдэгт (зураас, зай) үсгээс өмнө
    if(y >= 0) return -1;
    return A.charCodeAt(i) - B.charCodeAt(i);
  }
  return A.length - B.length;
}
function cmpByGivenName(a, b){
  const A = splitName(a), B = splitName(b);
  return cmpMn(A.ner, B.ner) || cmpMn(A.ovog, B.ovog);
}
const gradeOf = c => { const m = /^(\d+)/.exec(c||""); return m ? Number(m[1]) : null; };

function periodBar(st, onChange, extraHtml = ""){
  return `<div class="ex-toolbar">
    <div class="ex-seg" role="tablist">
      ${[["day","Өдөр"],["week","7 хоног"],["month","Сар"]].map(([k,l])=>
        `<button type="button" class="${st.period===k?"on":""}" data-period="${k}">${l}</button>`).join("")}
    </div>
    <div class="ex-nav">
      <button type="button" class="icon-btn" data-shift="-1" title="Өмнөх">◀</button>
      <span class="ex-range">${esc(periodRange(st.period, st.anchor).label)}</span>
      <button type="button" class="icon-btn" data-shift="1" title="Дараах">▶</button>
      <button type="button" class="btn-ghost ex-today" data-today>Өнөөдөр</button>
    </div>
    ${extraHtml}
  </div>`;
}
function wirePeriodBar(root, st, onChange){
  root.querySelectorAll("[data-period]").forEach(b=> b.onclick = ()=>{ st.period = b.dataset.period; onChange(); });
  root.querySelectorAll("[data-shift]").forEach(b=> b.onclick = ()=>{ st.anchor = shiftAnchor(st.period, st.anchor, Number(b.dataset.shift)); onChange(); });
  const t = root.querySelector("[data-today]"); if(t) t.onclick = ()=>{ st.anchor = new Date(); onChange(); };
}

function kpi(label, value, sub = ""){
  return `<div class="ex-kpi"><div class="ex-kpi-label">${esc(label)}</div><div class="ex-kpi-value">${value}</div>${sub?`<div class="ex-kpi-sub">${sub}</div>`:""}</div>`;
}

// Босоо багана график (нэг цуврал → тайлбар хэрэггүй, гарчиг нэрлэнэ)
function vbars(items, { fmt = v => v, color = "var(--accent)", max = null, empty = "Өгөгдөл алга" } = {}){
  if(!items.length || items.every(i => !i.value)) return `<div class="ex-empty">${esc(empty)}</div>`;
  const top = max ?? Math.max(...items.map(i => i.value || 0), 1);
  const showVals = items.length <= 16;
  return `<div class="ex-vbars" style="--n:${items.length}">
    ${items.map(i=>{
      const h = i.value ? Math.max(3, (i.value/top)*100) : 0;
      return `<div class="ex-vbar" tabindex="0" data-tip="${esc(i.tip ?? `${i.label}: ${fmt(i.value)}`)}">
        <div class="ex-vbar-track">${showVals && i.value ? `<span class="ex-vbar-val" style="bottom:${h}%">${esc(fmt(i.value))}</span>` : ""}
          <div class="ex-vbar-fill" style="height:${h}%;background:${i.color || color}"></div></div>
        <div class="ex-vbar-label">${esc(i.label)}</div>
      </div>`;
    }).join("")}
  </div>`;
}
// Хэвтээ багана (жагсаалт)
function hbars(items, { fmt = v => v, color = "var(--accent)", empty = "Өгөгдөл алга" } = {}){
  if(!items.length) return `<div class="ex-empty">${esc(empty)}</div>`;
  const top = Math.max(...items.map(i => i.value || 0), 1);
  return `<div class="ex-hbars">${items.map(i=>`
    <div class="ex-hbar" tabindex="0" data-tip="${esc(i.tip ?? `${i.label}: ${fmt(i.value)}`)}">
      <span class="ex-hbar-label">${i.labelHtml ?? esc(i.label)}</span>
      <span class="ex-hbar-track"><span class="ex-hbar-fill" style="width:${(i.value/top)*100}%;background:${i.color || color}"></span></span>
      <span class="ex-hbar-val">${esc(fmt(i.value))}${i.extra ? ` <small>${esc(i.extra)}</small>` : ""}</span>
    </div>`).join("")}</div>`;
}

function downloadCsv(filename, header, rows){
  const q = v => { const s = String(v ?? ""); return /[",\n;]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s; };
  const csv = "﻿" + [header, ...rows].map(r => r.map(q).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type:"text/csv;charset=utf-8" }));
  a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

/* ================= ХОЦРОЛТ ================= */
const late = {
  tab: "entry",          // "entry" | "stats"
  date: ymd(new Date()), // бүртгэх огноо
  cls: "",               // сонгосон анги
  roster: null,          // [{id,class_name,full_name}]
  rosterErr: "",
  dayRows: [],           // сонгосон огнооны бүртгэлүүд
  draft: {},             // { "нэр": {minutes, reason} }
  st: { period:"week", anchor:new Date(), filter:"" },
  statRows: null, statErr: "", statKey: "",
  busy: false,
};
const REASONS = ["", "Унтаж хоцорсон", "Замын түгжрэл", "Өвчтэй", "Гэр бүлийн шалтгаан", "Шалтгаангүй"];

async function loadRoster(force){
  if(late.roster && !force) return;
  try { late.roster = await rpc("students_list", { code_input: staffCode() }); late.rosterErr = ""; }
  catch(e){ late.roster = []; late.rosterErr = errText(e); }
}
async function loadDay(){
  try { late.dayRows = await rpc("late_list", { code_input: staffCode(), p_from: late.date, p_to: late.date }); }
  catch(e){ late.dayRows = []; X.showToast("Хоцролт ачаалахад алдаа: " + errText(e), true); }
}

export async function renderLate(){
  const root = document.getElementById("late-view");
  root.innerHTML = `<div class="topbar"><div class="crumbs"><span>⏰ Хоцролтын бүртгэл</span></div>
      <div class="ex-seg ex-seg-lg">
        <button type="button" class="${late.tab==="entry"?"on":""}" data-tab="entry">Бүртгэх</button>
        <button type="button" class="${late.tab==="stats"?"on":""}" data-tab="stats">Статистик</button>
      </div></div>
    <div id="late-body"><div class="ex-empty">Ачаалж байна…</div></div>`;
  root.querySelectorAll("[data-tab]").forEach(b=> b.onclick = ()=>{ late.tab = b.dataset.tab; renderLate(); });
  await loadRoster();
  if(late.tab === "entry") await renderLateEntry(); else await renderLateStats();
}

async function renderLateEntry(){
  const body = document.getElementById("late-body");
  if(late.rosterErr){ body.innerHTML = `<div class="registry-panel ex-err">${esc(late.rosterErr)}</div>`; return; }
  await loadDay();
  const classes = [...new Set(late.roster.map(s=>s.class_name))].sort(cmpClass);
  const byGrade = {};
  classes.forEach(c => (byGrade[gradeOf(c)] ||= []).push(c));
  const dayCount = c => late.dayRows.filter(r=>r.class_name===c).length;

  const chips = Object.keys(byGrade).sort((a,b)=>a-b).map(g=>`
    <div class="ex-grade-row"><span class="ex-grade-label">${g}-р анги</span>
      <div class="ex-chips">${byGrade[g].map(c=>{ const n = dayCount(c);
        return `<button type="button" class="ex-chip ${late.cls===c?"on":""}" data-cls="${esc(c)}">${esc(c)}${n?`<span class="ex-chip-n">${n}</span>`:""}</button>`; }).join("")}</div>
    </div>`).join("");

  body.innerHTML = `
    <div class="registry-panel ex-entry-head">
      <label class="ex-field"><span>Огноо</span><input type="date" id="late-date" value="${late.date}" max="${ymd(new Date())}"></label>
      <div class="ex-hint">Ангиа сонгоод хоцорсон сурагчийн хажууд <b>хэдэн минут</b> хоцорсныг бичээд «Хадгалах» дарна.</div>
    </div>
    <div class="registry-panel">${chips || `<div class="ex-empty">Сурагчдын жагсаалт хоосон байна.</div>`}</div>
    <div id="late-class"></div>`;
  body.querySelector("#late-date").onchange = e => { late.date = e.target.value || ymd(new Date()); late.draft = {}; renderLateEntry(); };
  body.querySelectorAll("[data-cls]").forEach(b=> b.onclick = ()=>{
    if(Object.keys(late.draft).length && late.cls !== b.dataset.cls && !confirm("Хадгалаагүй өөрчлөлт устах уу?")) return;
    late.cls = b.dataset.cls; late.draft = {}; renderLateEntry();
    setTimeout(()=> document.getElementById("late-class")?.scrollIntoView({ behavior:"smooth", block:"start" }), 50);
  });
  renderLateClass();
}

function renderLateClass(){
  const box = document.getElementById("late-class");
  if(!box) return;
  if(!late.cls){ box.innerHTML = ""; return; }
  const students = late.roster.filter(s=>s.class_name===late.cls).sort((a,b)=>cmpByGivenName(a.full_name, b.full_name));
  const saved = late.dayRows.filter(r=>r.class_name===late.cls);
  const me = staffName(); const admin = !!X.getSession();
  const rows = students.map((s, i)=>{
    const done = saved.filter(r=>r.student_name===s.full_name);
    const d = late.draft[s.full_name] || {};
    return `<div class="ex-stu ${done.length?"done":""} ${d.minutes?"marked":""}">
      <span class="ex-stu-no">${i+1}</span>
      <span class="ex-stu-name"><span>${(n=>`${n.ovog?`<span class="ex-ovog">${esc(n.ovog)}</span> `:""}<b>${esc(n.ner)}</b>`)(splitName(s.full_name))}</span>
        ${done.map(r=>`<span class="ex-saved">✓ ${r.minutes_late ?? 0} мин${r.reason?` · ${esc(r.reason)}`:""}
          ${(admin || (r.recorded_by && r.recorded_by===me)) ? `<button type="button" class="ex-x" title="Устгах" data-del="${r.id}">✕</button>` : ""}</span>`).join("")}
      </span>
      <span class="ex-stu-in">
        <input type="number" inputmode="numeric" min="1" max="600" placeholder="мин" value="${d.minutes ?? ""}" data-min="${esc(s.full_name)}" aria-label="${esc(s.full_name)} хэдэн минут хоцорсон">
        <select data-reason="${esc(s.full_name)}" aria-label="Шалтгаан" ${d.minutes?"":"hidden"}>
          ${REASONS.map(r=>`<option value="${esc(r)}" ${r===(d.reason||"")?"selected":""}>${r?esc(r):"Шалтгаан…"}</option>`).join("")}
        </select>
      </span>
    </div>`;
  }).join("");
  const n = Object.values(late.draft).filter(d=>d.minutes>0).length;
  box.innerHTML = `<div class="registry-panel">
      <div class="ex-class-head"><h3>${esc(late.cls)} анги · ${students.length} сурагч</h3>
        <span class="ex-hint">${fmtDay(parseYmd(late.date))}${saved.length?` · өмнө нь ${saved.length} бүртгэсэн`:""}</span></div>
      <div class="ex-stu-list">${rows}</div>
    </div>
    <div class="ex-savebar ${n?"show":""}">
      <span><b>${n}</b> сурагч хоцорсон гэж тэмдэглэсэн</span>
      <button type="button" class="btn-ghost" id="late-clear">Цэвэрлэх</button>
      <button type="button" class="btn-primary" id="late-save" ${n&&!late.busy?"":"disabled"}>Хадгалах</button>
    </div>`;
  box.querySelectorAll("[data-min]").forEach(inp=>{
    inp.oninput = ()=>{
      const name = inp.dataset.min; const v = parseInt(inp.value, 10);
      if(v > 0) late.draft[name] = { ...(late.draft[name]||{}), minutes: Math.min(v, 600) };
      else delete late.draft[name];
      const row = inp.closest(".ex-stu"); row.classList.toggle("marked", v > 0);
      row.querySelector("select").hidden = !(v > 0);
      const cnt = Object.values(late.draft).filter(d=>d.minutes>0).length;
      box.querySelector(".ex-savebar").classList.toggle("show", cnt > 0);
      box.querySelector(".ex-savebar b").textContent = cnt;
      box.querySelector("#late-save").disabled = !cnt || late.busy;
    };
    inp.onkeydown = e=>{ if(e.key==="Enter"){ const all=[...box.querySelectorAll("[data-min]")]; const nx=all[all.indexOf(inp)+1]; if(nx) nx.focus(); } };
  });
  box.querySelectorAll("[data-reason]").forEach(sel=> sel.onchange = ()=>{
    const d = late.draft[sel.dataset.reason]; if(d) d.reason = sel.value;
  });
  box.querySelectorAll("[data-del]").forEach(b=> b.onclick = ()=> deleteLate(Number(b.dataset.del)));
  box.querySelector("#late-clear").onclick = ()=>{ late.draft = {}; renderLateClass(); };
  box.querySelector("#late-save").onclick = saveLate;
}

async function saveLate(){
  const rows = Object.entries(late.draft).filter(([,d])=>d.minutes>0)
    .map(([student, d])=>({ student, minutes: d.minutes, reason: d.reason || "" }));
  if(!rows.length) return;
  late.busy = true; document.getElementById("late-save").disabled = true;
  try {
    const n = await rpc("late_add_batch", { code_input: staffCode(), p_date: late.date, p_class: late.cls, p_rows: rows, p_by: staffName() });
    X.showToast(`${n} сурагчийн хоцролт хадгалагдлаа.`);
    late.draft = {}; late.statKey = "";
  } catch(e){ X.showToast("Хадгалахад алдаа: " + errText(e), true); }
  late.busy = false;
  renderLateEntry();
}
async function deleteLate(id){
  if(!confirm("Энэ бүртгэлийг устгах уу?")) return;
  try {
    const ok = await rpc("late_delete", { code_input: staffCode(), p_id: id, p_by: staffName() });
    if(!ok){ X.showToast("Зөвхөн өөрийн бүртгэсэн мөрийг устгана.", true); return; }
    late.statKey = "";
    if(late.tab === "entry") renderLateEntry(); else renderLateStats();
  } catch(e){ X.showToast("Устгахад алдаа: " + errText(e), true); }
}

async function renderLateStats(){
  const body = document.getElementById("late-body");
  const st = late.st;
  const R = periodRange(st.period, st.anchor);
  const key = `${st.period}|${ymd(R.from)}|${ymd(R.to)}`;
  if(late.statKey !== key){
    body.innerHTML = `<div class="ex-empty">Ачаалж байна…</div>`;
    try { late.statRows = await rpc("late_list", { code_input: staffCode(), p_from: ymd(R.from), p_to: ymd(R.to) }); late.statErr = ""; }
    catch(e){ late.statRows = []; late.statErr = errText(e); }
    late.statKey = key;
  }
  const classes = [...new Set((late.roster||[]).map(s=>s.class_name).concat(late.statRows.map(r=>r.class_name)))].sort(cmpClass);
  const grades = [...new Set(classes.map(gradeOf))].filter(Boolean).sort((a,b)=>a-b);
  const f = st.filter;
  const rows = late.statRows.filter(r => !f || (f.startsWith("g:") ? String(gradeOf(r.class_name)) === f.slice(2) : r.class_name === f));
  const filterSel = `<select class="ex-select" id="late-filter" aria-label="Анги шүүх">
      <option value="">Бүх анги</option>
      ${grades.map(g=>`<option value="g:${g}" ${f===`g:${g}`?"selected":""}>${g}-р анги (бүгд)</option>`).join("")}
      ${classes.map(c=>`<option value="${esc(c)}" ${f===c?"selected":""}>${esc(c)}</option>`).join("")}
    </select>
    <button type="button" class="btn-ghost" id="late-csv">⬇ Excel (CSV)</button>`;

  const total = rows.length;
  const uniq = new Set(rows.map(r=>r.class_name+"|"+r.student_name)).size;
  const mins = rows.map(r=>r.minutes_late||0);
  const sumMin = mins.reduce((a,b)=>a+b,0);
  const avg = total ? Math.round(sumMin/total) : 0;
  const byClass = {}; rows.forEach(r=>{ const o = byClass[r.class_name] ||= { n:0, m:0 }; o.n++; o.m += r.minutes_late||0; });
  const topClass = Object.entries(byClass).sort((a,b)=>b[1].n-a[1].n)[0];

  // Гол график: өдөр → ангиар, 7 хоног/сар → өдөр бүрээр
  let chartTitle, chart;
  if(st.period === "day"){
    chartTitle = "Ангиар хоцролтын тоо";
    const items = Object.entries(byClass).sort((a,b)=>cmpClass(a[0],b[0])).map(([c,o])=>({ label:c, value:o.n, tip:`${c}: ${o.n} сурагч, нийт ${o.m} мин` }));
    chart = vbars(items, { empty:"Энэ өдөр хоцролт бүртгэгдээгүй байна" });
  } else {
    chartTitle = "Өдөр бүрийн хоцролтын тоо";
    const days = daysOf(R.from, R.to);
    const items = days.map(d=>{ const k = ymd(d); const rs = rows.filter(r=>r.late_date===k);
      return { label: st.period==="week" ? `${WD[d.getDay()]} ${d.getDate()}` : String(d.getDate()), value: rs.length,
        tip:`${fmtDay(d)}: ${rs.length} хоцролт${rs.length?`, нийт ${rs.reduce((a,r)=>a+(r.minutes_late||0),0)} мин`:""}` }; });
    chart = vbars(items, { empty:"Энэ хугацаанд хоцролт бүртгэгдээгүй байна" });
  }

  const classItems = Object.entries(byClass).sort((a,b)=>b[1].n-a[1].n || cmpClass(a[0],b[0]))
    .map(([c,o])=>({ label:c, value:o.n, extra:`${o.m} мин`, tip:`${c}: ${o.n} удаа, нийт ${o.m} мин` }));

  const byStu = {}; rows.forEach(r=>{ const k = r.class_name+"|"+r.student_name; const o = byStu[k] ||= { c:r.class_name, s:r.student_name, n:0, m:0 }; o.n++; o.m += r.minutes_late||0; });
  const repeat = Object.values(byStu).filter(o=>o.n>=2).sort((a,b)=>b.n-a.n || b.m-a.m);

  const me = staffName(); const admin = !!X.getSession();
  body.innerHTML = periodBar(st, null, filterSel) + (late.statErr ? `<div class="registry-panel ex-err">${esc(late.statErr)}</div>` : `
    <div class="ex-kpis">
      ${kpi("Нийт хоцролт", total)}
      ${kpi("Хоцорсон сурагч", uniq)}
      ${kpi("Дундаж", `${avg}<small> мин</small>`, total?`нийт ${sumMin} мин`:"")}
      ${kpi("Хамгийн их хоцролттой анги", topClass ? esc(topClass[0]) : "—", topClass ? `${topClass[1].n} удаа` : "")}
    </div>
    <div class="registry-panel"><h3>${chartTitle}</h3>${chart}</div>
    <div class="registry-layout" style="margin-top:20px">
      <div class="registry-panel"><h3>Ангиар</h3>${hbars(classItems, { empty:"Хоцролт алга" })}</div>
      <div class="registry-panel"><h3>Давтан хоцорсон сурагчид <small class="ex-hint">(2+ удаа)</small></h3>
        ${repeat.length ? hbars(repeat.slice(0,30).map(o=>({ label:`${o.s}`, labelHtml:`${esc(o.s)} <small class="ex-hint">${esc(o.c)}</small>`, value:o.n, extra:`${o.m} мин`, tip:`${o.s} (${o.c}): ${o.n} удаа, нийт ${o.m} мин` })), { color:"var(--folder)" })
          : `<div class="ex-empty">Давтан хоцорсон сурагч алга</div>`}</div>
    </div>
    <div class="registry-panel" style="margin-top:20px"><h3>Дэлгэрэнгүй жагсаалт <small class="ex-hint">(${total})</small></h3>
      ${total ? `<div class="ex-table-wrap"><table class="ex-table"><thead><tr><th>Огноо</th><th>Анги</th><th>Сурагч</th><th class="num">Минут</th><th>Шалтгаан</th><th>Бүртгэсэн</th><th></th></tr></thead><tbody>
        ${rows.slice(0,1000).map(r=>`<tr><td class="mono">${esc(r.late_date)}</td><td>${esc(r.class_name)}</td><td>${esc(r.student_name)}</td>
          <td class="num mono">${r.minutes_late ?? ""}</td><td>${esc(r.reason||"")}</td><td class="ex-hint">${esc(r.recorded_by||"")}</td>
          <td>${(admin || (r.recorded_by && r.recorded_by===me)) ? `<button type="button" class="icon-btn danger" title="Устгах" data-del="${r.id}">✕</button>` : ""}</td></tr>`).join("")}
      </tbody></table></div>` : `<div class="ex-empty">Бүртгэл алга</div>`}
    </div>`);
  wirePeriodBar(body, st, renderLateStats);
  const fs = body.querySelector("#late-filter"); if(fs) fs.onchange = ()=>{ st.filter = fs.value; renderLateStats(); };
  const cb = body.querySelector("#late-csv"); if(cb) cb.onclick = ()=> downloadCsv(`hotsrolt_${ymd(R.from)}_${ymd(R.to)}.csv`,
    ["Огноо","Анги","Сурагч","Хоцорсон минут","Шалтгаан","Бүртгэсэн"],
    rows.map(r=>[r.late_date, r.class_name, r.student_name, r.minutes_late ?? "", r.reason || "", r.recorded_by || ""]));
  body.querySelectorAll("[data-del]").forEach(b=> b.onclick = ()=> deleteLate(Number(b.dataset.del)));
}

/* ================= СЭТГЭЛ МЭДРЭМЖ ================= */
export const MOODS = [
  { v:1, e:"😢", t:"Маш муу",    c:"#C2410C" },
  { v:2, e:"🙁", t:"Муу",        c:"#E8894A" },
  { v:3, e:"😐", t:"Дунд зэрэг", c:"#9AA59D" },
  { v:4, e:"🙂", t:"Сайн",       c:"#5FB27A" },
  { v:5, e:"😁", t:"Маш сайхан", c:"#1E7A3B" },
];
const moodOf = v => MOODS.find(m=>m.v===Math.round(v)) || MOODS[2];

const mood = { st:{ period:"week", anchor:new Date(), filter:"" }, rows:null, err:"", key:"" };

function moodUrl(){ return new URL("mood.html", location.href).href.split("#")[0]; }

export async function renderMood(){
  const root = document.getElementById("mood-view");
  const st = mood.st;
  const R = periodRange(st.period, st.anchor);
  const key = `${st.period}|${ymd(R.from)}|${ymd(R.to)}`;
  if(mood.key !== key){
    root.innerHTML = `<div class="topbar"><div class="crumbs"><span>💬 Daily School Well-being Check-in</span></div></div><div class="ex-empty">Ачаалж байна…</div>`;
    try { mood.rows = await rpc("mood_list", { code_input: staffCode(), p_from: ymd(R.from), p_to: ymd(R.to) }); mood.err = ""; }
    catch(e){ mood.rows = []; mood.err = errText(e); }
    mood.key = key;
  }
  const f = st.filter;
  const classes = [...new Set(mood.rows.map(r=>r.class_name))].sort(cmpClass);
  const rows = mood.rows.filter(r => !f || (f.startsWith("g:") ? String(r.grade) === f.slice(2) : r.class_name === f));
  const filterSel = `<select class="ex-select" id="mood-filter" aria-label="Анги шүүх">
      <option value="">6–12-р анги (бүгд)</option>
      ${[6,7,8,9,10,11,12].map(g=>`<option value="g:${g}" ${f===`g:${g}`?"selected":""}>${g}-р анги</option>`).join("")}
      ${classes.map(c=>`<option value="${esc(c)}" ${f===c?"selected":""}>${esc(c)}</option>`).join("")}
    </select>
    <button type="button" class="btn-ghost" id="mood-csv">⬇ Excel (CSV)</button>`;

  const n = rows.length;
  const avg = n ? rows.reduce((a,r)=>a+r.mood,0)/n : 0;
  const pct = k => n ? Math.round(rows.filter(r=>k(r.mood)).length*100/n) : 0;
  const dist = MOODS.slice().reverse().map(m=>{ const c = rows.filter(r=>r.mood===m.v).length;
    return { label:`${m.v} ${m.t}`, labelHtml:`<span class="ex-emoji">${m.e}</span> ${m.v} ${m.t}`, value:c, color:m.c, extra: n?`${Math.round(c*100/n)}%`:"", tip:`${m.t}: ${c} (${n?Math.round(c*100/n):0}%)` }; });

  let trendTitle, trend;
  if(st.period === "day"){
    trendTitle = "Ангиар дундаж сэтгэл санаа (1–5)";
    const by = {}; rows.forEach(r=>{ (by[r.class_name] ||= []).push(r.mood); });
    trend = vbars(Object.keys(by).sort(cmpClass).map(c=>{ const a = by[c].reduce((x,y)=>x+y,0)/by[c].length;
      return { label:c, value:+a.toFixed(1), color:moodOf(a).c, tip:`${c}: дундаж ${a.toFixed(1)} · ${by[c].length} хариулт` }; }),
      { max:5, fmt:v=>v.toFixed(1), empty:"Энэ өдөр хариулт ирээгүй байна" });
  } else {
    trendTitle = "Өдөр бүрийн дундаж сэтгэл санаа (1–5)";
    trend = vbars(daysOf(R.from, R.to).map(d=>{ const k = ymd(d); const rs = rows.filter(r=>r.entry_date===k);
      const a = rs.length ? rs.reduce((x,r)=>x+r.mood,0)/rs.length : 0;
      return { label: st.period==="week" ? `${WD[d.getDay()]} ${d.getDate()}` : String(d.getDate()), value: rs.length ? +a.toFixed(1) : 0,
        color: rs.length ? moodOf(a).c : undefined, tip: rs.length ? `${fmtDay(d)}: дундаж ${a.toFixed(1)} · ${rs.length} хариулт` : `${fmtDay(d)}: хариулт алга` }; }),
      { max:5, fmt:v=>v.toFixed(1), empty:"Энэ хугацаанд хариулт ирээгүй байна" });
  }

  // 1. Анги: хариултын тоо + дундаж сэтгэл санаа
  const byClass = {}; rows.forEach(r=>{ (byClass[r.class_name] ||= []).push(r.mood); });
  const classItems = Object.keys(byClass).sort(cmpClass).map(c=>{ const a = byClass[c].reduce((x,y)=>x+y,0)/byClass[c].length;
    return { label:c, value:byClass[c].length, color:moodOf(a).c, extra:`дундаж ${a.toFixed(1)}`, tip:`${c}: ${byClass[c].length} хариулт · дундаж ${a.toFixed(1)}` }; });

  // 3, 4. Сонголтууд — асуулгын дарааллаар, сонгоогүй нь 0
  const tagCount = {}; rows.forEach(r=> (r.tags||[]).forEach(t=> tagCount[t] = (tagCount[t]||0)+1));
  const optItems = (list, neg) => list.map(([v, t])=>{ const c = tagCount[v] || 0;
    return { label:t, value:c, extra: n?`${Math.round(c*100/n)}%`:"", color: neg && v !== NO_WORRY ? "#E8894A" : "var(--accent)", tip:`${t}: ${c} сурагч` }; });
  const posItems = optItems(Q3_OPTIONS, false);
  const negItems = optItems(Q4_OPTIONS, true);
  // өмнөх хувилбарын сонголтууд (хуучин хариултад байвал л харуулна)
  const known = new Set([...Q3_OPTIONS, ...Q4_OPTIONS].map(x=>x[0]));
  const oldItems = Object.entries(tagCount).filter(([t])=>!known.has(t)).sort((x,y)=>y[1]-x[1])
    .map(([t,c])=>({ label:t, value:c, extra: n?`${Math.round(c*100/n)}%`:"", color: NEG_TAGS.includes(t) ? "#E8894A" : "var(--accent)" }));

  // 5. Мэдрэмжийн хүч
  const withLvl = rows.filter(r=>r.intensity);
  const lvlItems = LEVELS.map(l=>{ const c = withLvl.filter(r=>r.intensity===l.v).length;
    return { label:`${l.v} — ${l.t}`, value:c, extra: withLvl.length?`${Math.round(c*100/withLvl.length)}%`:"", color:"var(--accent)" }; });
  const comments = rows.filter(r=>r.comment).slice(0, 80);
  const q = (title, body, note = "") => `<div class="registry-panel" style="margin-top:20px"><h3>${esc(title)}${note ? ` <small class="ex-hint">${esc(note)}</small>` : ""}</h3>${body}</div>`;

  root.innerHTML = `<div class="topbar"><div class="crumbs"><span>💬 Daily School Well-being Check-in</span></div></div>
    <div class="registry-panel ex-qr-panel">
      <canvas id="mood-qr" width="132" height="132" aria-label="Сурагчдын бөглөх хуудасны QR"></canvas>
      <div class="ex-qr-info">
        <h3>Сурагчид энэ QR-ыг уншуулж бөглөнө</h3>
        <p class="ex-hint">6–12-р ангийн сурагч өдөрт нэг удаа, <b>нэргүйгээр</b> өнөөдөр сургууль дээр ямар санагдаж байгаагаа бөглөнө. Багшийн код хэрэггүй.</p>
        <div class="ex-url mono">${esc(moodUrl())}</div>
        <div class="actions"><button type="button" class="btn-ghost" id="mood-copy">🔗 Холбоос хуулах</button>
          <button type="button" class="btn-ghost" id="mood-qr-png">🖼️ QR татах (PNG)</button>
          <a class="btn-ghost" href="${esc(moodUrl())}" target="_blank" rel="noopener">↗ Хуудсыг нээх</a></div>
      </div>
    </div>
    ${periodBar(st, null, filterSel)}
    ${mood.err ? `<div class="registry-panel ex-err">${esc(mood.err)}</div>` : `
    <div class="ex-kpis">
      ${kpi("Хариулт", n)}
      ${kpi("Дундаж сэтгэл санаа", n ? `<span class="ex-emoji">${moodOf(avg).e}</span> ${avg.toFixed(1)}<small> / 5</small>` : "—", n ? moodOf(avg).t : "")}
      ${kpi("Сайн (4–5)", `${pct(v=>v>=4)}<small>%</small>`)}
      ${kpi("Муу (1–2)", `${pct(v=>v<=2)}<small>%</small>`)}
    </div>
    ${q("1. Чи аль ангид сурдаг вэ?", hbars(classItems, { empty:"Хариулт алга" }), "(анги бүрээс хэдэн сурагч бөглөсөн)")}
    <div class="registry-layout" style="margin-top:20px">
      <div class="registry-panel"><h3>2. Өнөөдрийн сэтгэл санаа ямар байна вэ?</h3>${hbars(dist, { empty:"Хариулт алга" })}</div>
      <div class="registry-panel"><h3>${trendTitle}</h3>${trend}</div>
    </div>
    ${q("3. Өнөөдөр сургууль дээр чамд юу хамгийн сайхан мэдрэмж төрүүлсэн бэ?", hbars(posItems), "(олон хариулт сонгож болно)")}
    ${q("4. Өнөөдөр чамд юу санаа зовоосон эсвэл таагүй мэдрэмж төрүүлсэн бэ?", hbars(negItems), "(олон хариулт сонгож болно)")}
    ${q("5. Өнөөдрийн чиний мэдрэмж хэр хүчтэй байна вэ?", hbars(lvlItems), withLvl.length ? `(${withLvl.length} сурагч хариулсан)` : "")}
    ${q("6. Өнөөдөр сургууль дээр чамд хамгийн их хэрэгтэй байгаа зүйл юу вэ?",
      comments.length ? `<div class="ex-comments">${comments.map(r=>`<div class="ex-comment">
          <span class="ex-emoji" title="${esc(moodOf(r.mood).t)}">${moodOf(r.mood).e}</span>
          <div><div>${esc(r.comment)}</div><div class="ex-hint">${esc(r.class_name)} · ${esc(r.entry_date)}</div></div></div>`).join("")}</div>`
        : `<div class="ex-empty">Бичсэн хариулт алга</div>`, `(${comments.length})`)}
    ${oldItems.length ? q("Өмнөх асуулгын сонголтууд", hbars(oldItems), "(шинэ асуулга гарахаас өмнөх хариултууд)") : ""}`}`;
  wirePeriodBar(root, st, renderMood);
  const fs = root.querySelector("#mood-filter"); if(fs) fs.onchange = ()=>{ st.filter = fs.value; renderMood(); };
  const cb = root.querySelector("#mood-csv"); if(cb) cb.onclick = ()=> downloadCsv(`setgel_medremj_${ymd(R.from)}_${ymd(R.to)}.csv`,
    ["Огноо","Анги","Үнэлгээ (1-5)","Мэдрэмж","Хүч (1-4)","Сонголтууд","Хамгийн их хэрэгтэй зүйл"],
    rows.map(r=>[r.entry_date, r.class_name, r.mood, moodOf(r.mood).t, r.intensity ?? "", (r.tags||[]).join("; "), r.comment || ""]));
  drawMoodQr();
  root.querySelector("#mood-copy").onclick = async ()=>{
    try { await navigator.clipboard.writeText(moodUrl()); X.showToast("Холбоос хуулагдлаа."); }
    catch { prompt("Холбоосыг хуулна уу:", moodUrl()); }
  };
  root.querySelector("#mood-qr-png").onclick = ()=>{
    const big = drawMoodQr(1024, true);
    const a = document.createElement("a"); a.href = big.toDataURL("image/png"); a.download = "setgel-medremj-qr.png"; a.click();
  };
}

function drawMoodQr(size = 132, offscreen = false){
  const canvas = offscreen ? document.createElement("canvas") : document.getElementById("mood-qr");
  if(!canvas || !window.qrcode) return canvas;
  const qr = window.qrcode(0, "M"); qr.addData(moodUrl()); qr.make();
  const n = qr.getModuleCount(), quiet = 2, cells = n + quiet*2;
  const dpr = offscreen ? 1 : Math.max(window.devicePixelRatio || 1, 2);
  canvas.width = size*dpr; canvas.height = size*dpr;
  if(!offscreen){ canvas.style.width = size+"px"; canvas.style.height = size+"px"; }
  const ctx = canvas.getContext("2d"); ctx.setTransform(dpr,0,0,dpr,0,0);
  const cell = size / cells;
  ctx.fillStyle = "#fff"; ctx.fillRect(0,0,size,size); ctx.fillStyle = "#155A2C";
  for(let r=0;r<n;r++) for(let c=0;c<n;c++) if(qr.isDark(r,c))
    ctx.fillRect(Math.floor((c+quiet)*cell), Math.floor((r+quiet)*cell), Math.ceil(cell), Math.ceil(cell));
  return canvas;
}

// mood.html-тэй ижил сонголтууд (сөрөг нь өнгөөр ялгагдана)
export const POS_TAGS = ["Найз нөхөдтэйгөө сайхан харилцсан", "Багш нар намайг ойлгож, дэмжсэн", "Хичээлээ ойлгож, амжилттай суралцсан",
  "Өөрийн чадвар, амжилтыг мэдэрсэн", "Анги хамт олондоо хүлээн зөвшөөрөгдсөн", "Сонирхолтой үйл ажиллагаанд оролцсон",
  "Сургууль дээр тайван, аюулгүй байсан", "Өнөөдөр онцгой сайхан зүйл тохиолдсон", "Өөр зүйл (сайхан)",
  // өмнөх хувилбарын сонголтууд
  "Найз нөхөдтэйгээ сайхан", "Багш нар дэмжсэн", "Хичээл сонирхолтой", "Анги танхим цэвэрхэн", "Аюулгүй санагдсан"];
export const NEG_TAGS = ["Хичээлийн ачаалал их байсан", "Шалгалт, үнэлгээ, дүнгийн талаар санаа зовсон", "Найз нөхөдтэй холбоотой асуудал гарсан",
  "Үл ойлголцол, маргаан, гадуурхалт мэдэрсэн", "Багштай харилцахад таагүй байсан", "Анги, сургуулийн орчинд тав тухгүй байсан",
  "Ядарсан, нойр дутуу байсан", "Хувийн асуудалд санаа зовсон", "Өнөөдөр онцгой таагүй зүйл тохиолдсон", "Өөр зүйл (санаа зовсон)",
  // өмнөх хувилбарын сонголтууд
  "Хичээлийн ачаалал их", "Ядарсан, нойр дутуу", "Дээрэлхэлт, доромжлол", "Анги хүйтэн/бүгчим", "Ариун цэврийн өрөө", "Хоол, цайны газар", "Чимээ шуугиан их"];
export const NO_WORRY = "Юу ч санаа зовоогоогүй";
// [хадгалагдах утга, харагдах бичвэр] — mood.html-ийн 3, 4-р асуулттай яг ижил дараалал
const Q3_OPTIONS = POS_TAGS.slice(0, 8).map(t=>[t,t]).concat([["Өөр зүйл (сайхан)", "Өөр зүйл"]]);
const Q4_OPTIONS = NEG_TAGS.slice(0, 9).map(t=>[t,t]).concat([[NO_WORRY, NO_WORRY], ["Өөр зүйл (санаа зовсон)", "Өөр зүйл"]]);
export const LEVELS = [ { v:1, t:"Бага зэрэг" }, { v:2, t:"Дунд зэрэг" }, { v:3, t:"Нэлээд хүчтэй" }, { v:4, t:"Маш хүчтэй" } ];
