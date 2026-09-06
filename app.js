import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY, VIEW_PASSCODE } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const BUCKET = "files";

let folders = [];
let files = [];
let qrItems = [];
let calState = null;
let session = null;

const MN_MONTHS = ["1-Р САР","2-Р САР","3-Р САР","4-Р САР","5-Р САР","6-Р САР","7-Р САР","8-Р САР","9-Р САР","10-Р САР","11-Р САР","12-Р САР"];
const MN_DAYS = ["ДА","МЯ","ЛХ","ПҮ","БА","БЯ","НЯ"];
const CAL_MONTH_MASCOTS = Array.from({length:12}, (_,i)=> `./assets/calendar/month-mascot-${String(i+1).padStart(2,"0")}.png`);

const TYPE_META = {
  doc:{bg:"#2B579A",label:"W"}, docx:{bg:"#2B579A",label:"W"},
  xls:{bg:"#1D6F42",label:"X"}, xlsx:{bg:"#1D6F42",label:"X"},
  ppt:{bg:"#D24726",label:"P"}, pptx:{bg:"#D24726",label:"P"},
  pdf:{bg:"#B3261E",label:"PDF"},
  png:{bg:"#7C4DFF",label:"IMG"}, jpg:{bg:"#7C4DFF",label:"IMG"}, jpeg:{bg:"#7C4DFF",label:"IMG"},
  gif:{bg:"#7C4DFF",label:"IMG"}, webp:{bg:"#7C4DFF",label:"IMG"}, svg:{bg:"#7C4DFF",label:"IMG"},
  drawio:{bg:"#F08705",label:"⬡"},
  txt:{bg:"#546E7A",label:"TXT"}, md:{bg:"#546E7A",label:"MD"}
};
function typeMeta(ext){ return TYPE_META[ext] || {bg:"#8A8578",label:(ext||"?").slice(0,3).toUpperCase()}; }
function extOf(name){ const m=/\.([a-z0-9]+)$/i.exec(name||""); return m ? m[1].toLowerCase() : ""; }
function mimeFor(ext){
  const map={png:"image/png",jpg:"image/jpeg",jpeg:"image/jpeg",gif:"image/gif",webp:"image/webp",svg:"image/svg+xml",
    pdf:"application/pdf",
    doc:"application/msword", docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls:"application/vnd.ms-excel", xlsx:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt:"application/vnd.ms-powerpoint", pptx:"application/vnd.openxmlformats-officedocument.presentationml.presentation",
    drawio:"application/xml", txt:"text/plain", md:"text/markdown"};
  return map[ext] || "application/octet-stream";
}
function fmtSize(b){
  if(b==null) return "—";
  if(b<1024) return b+" B";
  if(b<1024*1024) return (b/1024).toFixed(1)+" KB";
  return (b/1024/1024).toFixed(1)+" MB";
}
function fmtDate(iso){
  try{ return new Date(iso).toLocaleDateString("mn-MN",{year:"numeric",month:"short",day:"numeric"}); }
  catch(e){ return iso || ""; }
}
function uid(){ return crypto.randomUUID(); }
function escapeHtml(s){ return (s||"").replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function publicUrlFor(path){ return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl; }

/* ---------------- toast ---------------- */
function showToast(msg, isError){
  let t = document.getElementById("toast");
  if(!t){ t = document.createElement("div"); t.id="toast"; document.body.appendChild(t); }
  t.textContent = msg;
  t.className = "toast" + (isError ? " toast-error" : "");
  t.style.display = "block";
  clearTimeout(t._timer);
  t._timer = setTimeout(()=>{ t.style.display="none"; }, 8000);
}

/* ---------------- data ---------------- */
async function loadData(){
  const [{ data: f1, error: e1 }, { data: f2, error: e2 }] = await Promise.all([
    supabase.from("folders").select("*").order("created_at", { ascending:true }),
    supabase.from("files").select("*").order("added_at", { ascending:false }),
  ]);
  if(e1) { showToast("Фолдер ачаалахад алдаа: " + e1.message, true); return; }
  if(e2) { showToast("Файл ачаалахад алдаа: " + e2.message, true); return; }
  folders = f1 || [];
  files = f2 || [];
  render();
}
async function loadQrItems(){
  const { data, error } = await supabase.from("qr_items").select("*").order("position", { ascending:true });
  if(error){ showToast("QR ачаалахад алдаа: " + error.message, true); return; }
  qrItems = data || [];
  render();
}
async function loadCalendarState(){
  const { data, error } = await supabase.from("calendar_state").select("*").eq("id","main").maybeSingle();
  if(error){ showToast("Хуанли ачаалахад алдаа: " + error.message, true); return; }
  if(data){
    calState = { startYear: data.start_year, categories: data.categories, events: data.events };
    render();
    return;
  }
  if(session){ await seedCalendarState(); }
  render();
}
// Анхны ангилал/бичлэгүүдийг эх HTML-ээс задалсан статик JSON-оос уншиж,
// хүснэгт хоосон үед (зөвхөн 1 удаа) админ орж ирэхэд нь автоматаар бөглөнө —
// хэт урт SQL мөр гараар хуулахад тасардаг асуудлаас зайлсхийсэн.
async function seedCalendarState(){
  try{
    const seed = await (await fetch("./assets/calendar/seed-state.json")).json();
    calState = seed;
    const { error } = await supabase.from("calendar_state").insert({
      id: "main", start_year: seed.startYear, categories: seed.categories, events: seed.events,
    });
    if(error){ showToast("Хуанли эхлүүлэхэд алдаа: " + error.message, true); }
  }catch(e){ showToast("Хуанли эхлүүлэхэд алдаа: " + e.message, true); }
}
async function saveCalendarState(){
  const note = document.getElementById("cal-save-note");
  note.hidden = false;
  note.textContent = "Хадгалж байна…";
  const { error } = await supabase.from("calendar_state").update({
    start_year: calState.startYear, categories: calState.categories, events: calState.events,
    updated_at: new Date().toISOString(),
  }).eq("id","main");
  if(error){ note.textContent = "Алдаа гарлаа"; showToast("Хуанли хадгалахад алдаа: " + error.message, true); return; }
  note.textContent = "Хадгалагдсан";
}
function folderById(id){ return folders.find(x=>x.id===id); }
function childFolders(id){ return folders.filter(x=>x.parent_id===id); }
function filesIn(id){ return files.filter(x=>x.folder_id===id); }
function fileById(id){ return files.find(x=>x.id===id); }
function qrItemById(id){ return qrItems.find(x=>x.id===id); }
function breadcrumbChain(id){
  const chain=[]; let cur=folderById(id);
  while(cur){ chain.unshift(cur); cur = cur.parent_id ? folderById(cur.parent_id) : null; }
  return chain;
}
function topFolders(){ return childFolders("root"); }

/* ---------------- boot ---------------- */
async function boot(){
  const { data: { session: s } } = await supabase.auth.getSession();
  session = s;
  supabase.auth.onAuthStateChange((_evt, s2)=>{ session = s2; updateAdminUI(); });

  wireStaticEvents();

  if(localStorage.getItem("iso184_unlocked") === "1") showApp();

  await Promise.all([loadData(), loadQrItems(), loadCalendarState()]);
  updateAdminUI();

  supabase
    .channel("public:drive-changes")
    .on("postgres_changes", { event:"*", schema:"public", table:"files" }, loadData)
    .on("postgres_changes", { event:"*", schema:"public", table:"folders" }, loadData)
    .on("postgres_changes", { event:"*", schema:"public", table:"qr_items" }, loadQrItems)
    .on("postgres_changes", { event:"*", schema:"public", table:"calendar_state" }, loadCalendarState)
    .subscribe();

  window.addEventListener("hashchange", render);
}

function tryUnlock(){
  const v = document.getElementById("gate-input").value.trim();
  if(v && v === VIEW_PASSCODE){
    localStorage.setItem("iso184_unlocked", "1");
    showApp();
  } else {
    document.getElementById("gate-err").textContent = "Код буруу байна. Дахин оролдоно уу.";
  }
}
function showApp(){
  document.getElementById("gate").style.display = "none";
  document.getElementById("app").classList.add("show");
  if(!location.hash) location.hash = "#f=root";
  renderSidebar();
  render();
}

/* ---------------- admin auth ---------------- */
function updateAdminUI(){
  const statusEl = document.getElementById("admin-status");
  const btn = document.getElementById("admin-btn");
  if(session){
    statusEl.textContent = "Админ: " + session.user.email;
    btn.textContent = "Гарах";
  } else {
    statusEl.textContent = "Зочин горим";
    btn.textContent = "Админ нэвтрэх";
  }
  render();
}
async function adminLogin(){
  const email = document.getElementById("admin-email").value.trim();
  const password = document.getElementById("admin-password").value;
  const statusEl = document.getElementById("admin-login-status");
  statusEl.textContent = "Нэвтэрч байна…";
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if(error){ statusEl.textContent = "Алдаа: " + error.message; return; }
  statusEl.textContent = "";
  closeModal("modal-admin");
}

/* ---------------- routing helpers ---------------- */
function isQrRoute(){ return location.hash === "#qr"; }
function isCalendarRoute(){ return location.hash === "#calendar"; }
function currentFolderId(){
  const m = /f=([^&]+)/.exec(location.hash);
  return m ? decodeURIComponent(m[1]) : "root";
}
function currentFileId(){
  const m = /file=([^&]+)/.exec(location.hash);
  return m ? decodeURIComponent(m[1]) : null;
}

/* ---------------- rendering ---------------- */
function renderSidebar(){
  document.getElementById("side-folders").innerHTML = topFolders().map(f=>
    `<a href="#f=${encodeURIComponent(f.id)}" class="side-link" data-nav="${f.id}">📂 ${escapeHtml(f.name)}</a>`
  ).join("");
}

function render(){
  if(!document.getElementById("app").classList.contains("show")) return;

  const qrRoute = isQrRoute();
  const calRoute = isCalendarRoute();
  document.getElementById("folder-view").hidden = qrRoute || calRoute;
  document.getElementById("qr-view").hidden = !qrRoute;
  document.getElementById("calendar-view").hidden = !calRoute;

  renderSidebar();

  if(calRoute){
    document.querySelectorAll(".side-link").forEach(a=>a.classList.toggle("active", a.dataset.nav==="calendar"));
    document.getElementById("viewer").classList.remove("show");
    renderCalendar();
    return;
  }

  if(qrRoute){
    document.querySelectorAll(".side-link").forEach(a=>a.classList.toggle("active", a.dataset.nav==="qr"));
    document.getElementById("viewer").classList.remove("show");
    renderQrGrid();
    return;
  }

  const fileId = currentFileId();
  const viewerEl = document.getElementById("viewer");
  if(fileId){ openViewer(fileId); viewerEl.classList.add("show"); }
  else { viewerEl.classList.remove("show"); }

  const folderId = currentFolderId();
  const folder = folderById(folderId) || folderById("root");
  if(!folder) return;

  document.querySelectorAll(".side-link").forEach(a=>a.classList.toggle("active", a.dataset.nav===folder.id));

  const chain = breadcrumbChain(folder.id);
  document.getElementById("crumbs").innerHTML = chain.map((f,i)=>{
    const label = f.id==="root" ? "Нүүр" : escapeHtml(f.name);
    const isLast = i===chain.length-1;
    return (i>0?'<span class="sep">/</span>':'') + (isLast ? `<span>${label}</span>` : `<a href="#f=${encodeURIComponent(f.id)}">${label}</a>`);
  }).join("");

  const q = (document.getElementById("search-input").value || "").toLowerCase();
  let subFolders = childFolders(folder.id);
  let subFiles = filesIn(folder.id);
  if(q){
    subFolders = subFolders.filter(f=>f.name.toLowerCase().includes(q));
    subFiles = subFiles.filter(f=>f.name.toLowerCase().includes(q));
  }

  const listing = document.getElementById("listing");
  const isAdmin = !!session;
  document.getElementById("admin-actions").hidden = !isAdmin;

  if(subFolders.length===0 && subFiles.length===0){
    listing.innerHTML = `<div class="empty">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>
      <div>Энд файл, фолдер алга байна.</div>
    </div>`;
    return;
  }

  let rows = "";
  subFolders.forEach(f=>{
    rows += `<tr>
      <td colspan="3">
        <div class="row-name" data-open-folder="${f.id}">
          <div class="badge" style="background:var(--folder-soft);color:var(--folder);font-size:16px;">📁</div>
          <span class="label">${escapeHtml(f.name)}</span>
        </div>
      </td>
      <td></td>
      <td></td>
    </tr>`;
  });
  subFiles.forEach(f=>{
    const meta = typeMeta(f.ext);
    rows += `<tr>
      <td colspan="2">
        <div class="row-name" data-open-file="${f.id}">
          <div class="badge" style="background:${meta.bg}">${meta.label}</div>
          <span class="label">${escapeHtml(f.name)}</span>
        </div>
      </td>
      <td class="dim mono">${fmtDate(f.added_at)}</td>
      <td class="dim mono">${fmtSize(f.size)}</td>
      <td>
        ${isAdmin ? `<div class="row-actions">
          <button class="icon-btn" title="Нэр солих" data-rename="${f.id}">✎</button>
          <button class="icon-btn danger" title="Устгах" data-delete="${f.id}">✕</button>
        </div>` : ``}
      </td>
    </tr>`;
  });

  listing.innerHTML = `<table><thead><tr>
    <th colspan="2">Нэр</th><th>Огноо</th><th>Хэмжээ</th><th></th>
  </tr></thead><tbody>${rows}</tbody></table>`;

  listing.querySelectorAll("[data-open-folder]").forEach(el=>
    el.addEventListener("click", ()=>{ location.hash = "f=" + encodeURIComponent(el.dataset.openFolder); }));
  listing.querySelectorAll("[data-open-file]").forEach(el=>
    el.addEventListener("click", ()=>{ location.hash = "file=" + encodeURIComponent(el.dataset.openFile); }));
  listing.querySelectorAll("[data-rename]").forEach(el=>
    el.addEventListener("click", (e)=>{ e.stopPropagation(); openRename("file", el.dataset.rename); }));
  listing.querySelectorAll("[data-delete]").forEach(el=>
    el.addEventListener("click", (e)=>{ e.stopPropagation(); deleteFile(el.dataset.delete); }));
}

function renderQrGrid(){
  const isAdmin = !!session;
  document.getElementById("qr-admin-actions").hidden = !isAdmin;
  const grid = document.getElementById("qr-grid");
  if(qrItems.length===0){
    grid.innerHTML = `<div class="empty">QR код алга байна.</div>`;
    return;
  }
  grid.innerHTML = qrItems.map(item=>{
    const imgUrl = publicUrlFor(item.storage_path);
    return `<div class="qr-card" data-qr-id="${item.id}" draggable="${isAdmin}">
      ${isAdmin ? `<div class="qr-actions">
        <button class="icon-btn" title="Нэр солих" data-qr-rename="${item.id}">✎</button>
        <button class="icon-btn danger" title="Устгах" data-qr-delete="${item.id}">✕</button>
      </div>` : ``}
      <img src="${imgUrl}" alt="${escapeHtml(item.name)}" />
      <div class="qr-name">${escapeHtml(item.name)}</div>
    </div>`;
  }).join("");
  grid.querySelectorAll("[data-qr-rename]").forEach(el=>
    el.addEventListener("click", ()=> openRename("qr", el.dataset.qrRename)));
  grid.querySelectorAll("[data-qr-delete]").forEach(el=>
    el.addEventListener("click", ()=> deleteQrItem(el.dataset.qrDelete)));
  if(isAdmin) wireQrDrag(grid);
}

let qrDragId = null;
function wireQrDrag(grid){
  grid.querySelectorAll(".qr-card").forEach(card=>{
    card.addEventListener("dragstart", ()=>{ qrDragId = card.dataset.qrId; card.classList.add("qr-dragging"); });
    card.addEventListener("dragend", ()=>{ card.classList.remove("qr-dragging"); });
    card.addEventListener("dragover", (e)=>{ e.preventDefault(); });
    card.addEventListener("drop", (e)=>{
      e.preventDefault();
      const targetId = card.dataset.qrId;
      if(!qrDragId || qrDragId===targetId) return;
      reorderQrItems(qrDragId, targetId);
      qrDragId = null;
    });
  });
}

async function reorderQrItems(sourceId, targetId){
  const fromIdx = qrItems.findIndex(x=>x.id===sourceId);
  const toIdx = qrItems.findIndex(x=>x.id===targetId);
  if(fromIdx===-1 || toIdx===-1) return;
  const reordered = [...qrItems];
  const [moved] = reordered.splice(fromIdx,1);
  reordered.splice(toIdx,0,moved);
  qrItems = reordered;
  render();
  const results = await Promise.all(
    qrItems.map((item,i)=> supabase.from("qr_items").update({ position:i }).eq("id", item.id))
  );
  const failed = results.find(r=>r.error);
  if(failed){ showToast("Дараалал хадгалахад алдаа: " + failed.error.message, true); }
}

/* ---------------- calendar (Хуанли) ---------------- */
function calMonthSequence(startYear){
  const seq = [];
  for(let i=8;i<20;i++){
    const m = i % 12;
    const y = startYear + Math.floor(i/12);
    seq.push({month:m, year:y});
  }
  return seq;
}
function calDaysInMonth(y,m){ return new Date(y, m+1, 0).getDate(); }
function calFirstWeekdayMon0(y,m){ let d = new Date(y,m,1).getDay(); return (d+6)%7; }
function calKeyOf(y,m,d){ return `${y}-${m}-${d}`; }

// Collapses the same task repeated on consecutive days into a single row
// with a day range, tracking each (title, category) pair independently so
// interleaved tasks from different categories on the same days still group correctly.
function calGroupConsecutiveEvents(monthEvents){
  const sorted = [...monthEvents].sort((a,b)=> a.d-b.d);
  const active = new Map();
  const finished = [];
  for(const {d, ev} of sorted){
    const key = ev.title + '||' + ev.catId;
    const grp = active.get(key);
    if(grp && d === grp.endDay+1){
      grp.endDay = d;
      grp.ids.push({d, id: ev.id});
    } else {
      if(grp) finished.push(grp);
      active.set(key, {title: ev.title, catId: ev.catId, startDay: d, endDay: d, ids: [{d, id: ev.id}]});
    }
  }
  active.forEach(g=> finished.push(g));
  finished.sort((a,b)=> a.startDay - b.startDay);
  return finished;
}

// Builds a small absolutely-positioned swatch grid so a day with several
// activities shows each category as its own tidy block instead of blending colors.
function calBuildQuadrantSwatches(cats){
  const wrap = document.createElement('div');
  wrap.className = 'cal-swatches';
  const list = cats.slice(0,4);
  const mk = (color)=>{ const s=document.createElement('span'); s.style.background=color; return s; };

  if(list.length===1){
    wrap.style.gridTemplateColumns = '1fr';
    wrap.style.gridTemplateRows = '1fr';
    wrap.appendChild(mk(list[0].color));
  } else if(list.length===2){
    wrap.style.gridTemplateColumns = '1fr 1fr';
    wrap.style.gridTemplateRows = '1fr';
    list.forEach(c=>wrap.appendChild(mk(c.color)));
  } else if(list.length===3){
    wrap.style.gridTemplateColumns = '1fr 1fr';
    wrap.style.gridTemplateRows = '1fr 1fr';
    wrap.appendChild(mk(list[0].color));
    wrap.appendChild(mk(list[1].color));
    const bottom = mk(list[2].color);
    bottom.style.gridColumn = '1 / span 2';
    wrap.appendChild(bottom);
  } else {
    wrap.style.gridTemplateColumns = '1fr 1fr';
    wrap.style.gridTemplateRows = '1fr 1fr';
    list.forEach(c=>wrap.appendChild(mk(c.color)));
  }
  return wrap;
}

function renderCalendar(){
  if(!calState){
    document.getElementById("cal-months-grid").innerHTML = `<div class="empty">Ачааллаж байна…</div>`;
    return;
  }
  const isAdmin = !!session;
  document.getElementById("cal-year-big").textContent = `${calState.startYear}–${calState.startYear+1}`;
  document.getElementById("cal-year-row").hidden = !isAdmin;
  document.getElementById("cal-year-input").value = calState.startYear;
  document.getElementById("cal-add-category-btn").hidden = !isAdmin;
  renderCalCategoryPanel(isAdmin);
  renderCalMonths(isAdmin);
  renderCalContentList();
}

function renderCalCategoryPanel(isAdmin){
  const grid = document.getElementById("cal-cat-grid");
  grid.innerHTML = calState.categories.map(cat=>`
    <div class="cal-cat-pill" style="background:${cat.color}">
      ${escapeHtml(cat.name)}
      ${isAdmin ? `<button class="cal-cat-del" data-del-cat="${cat.id}">✕</button>` : ``}
    </div>`).join("");
  if(isAdmin){
    grid.querySelectorAll("[data-del-cat]").forEach(btn=>
      btn.addEventListener("click", (e)=>{ e.stopPropagation(); deleteCalCategory(btn.dataset.delCat); }));
  }
}

async function deleteCalCategory(id){
  if(calState.categories.length<=1){ showToast("Дор хаяж нэг ангилал байх ёстой.", true); return; }
  if(!confirm('Энэ ангиллыг устгах уу? Холбогдох үйл явдлууд ч устана.')) return;
  calState.categories = calState.categories.filter(c=>c.id!==id);
  Object.keys(calState.events).forEach(k=>{
    calState.events[k] = calState.events[k].filter(e=>e.catId!==id);
    if(calState.events[k].length===0) delete calState.events[k];
  });
  await saveCalendarState();
  renderCalendar();
}

function renderCalMonths(isAdmin){
  const grid = document.getElementById("cal-months-grid");
  grid.innerHTML = '';
  const seq = calMonthSequence(calState.startYear);

  seq.forEach(({month,year}, idx)=>{
    const wrap = document.createElement('div');
    wrap.className = 'cal-month-wrap';

    const mascot = document.createElement('img');
    mascot.className = 'cal-month-mascot';
    mascot.src = CAL_MONTH_MASCOTS[idx % CAL_MONTH_MASCOTS.length];
    mascot.alt = '';
    wrap.appendChild(mascot);

    const card = document.createElement('div');
    card.className = 'cal-month-card';

    const head = document.createElement('div');
    head.className = 'cal-month-head';
    head.innerHTML = `<h2>${MN_MONTHS[month]}</h2><span class="cal-idx">${year}</span>`;
    card.appendChild(head);

    const wdRow = document.createElement('div');
    wdRow.className = 'cal-weekday-row';
    MN_DAYS.forEach(d=>{ const s=document.createElement('span'); s.textContent=d; wdRow.appendChild(s); });
    card.appendChild(wdRow);

    const cells = document.createElement('div');
    cells.className = 'cal-grid-cells';
    const firstDay = calFirstWeekdayMon0(year,month);
    const numDays = calDaysInMonth(year,month);
    for(let i=0;i<firstDay;i++){ const c=document.createElement('div'); c.className='cal-cell cal-empty-cell'; cells.appendChild(c); }
    for(let d=1; d<=numDays; d++){
      const c = document.createElement('div');
      const dayEvents = calState.events[calKeyOf(year,month,d)] || [];
      const cats = dayEvents.map(ev=>calState.categories.find(cc=>cc.id===ev.catId)).filter(Boolean);
      c.className = 'cal-cell' + (cats.length ? ' cal-filled' : '');
      if(cats.length){
        c.appendChild(calBuildQuadrantSwatches(cats));
      }
      const num = document.createElement('div');
      num.className = 'cal-num'; num.textContent = d;
      c.appendChild(num);
      if(isAdmin){ c.onclick = ()=>openCalDayModal(year,month,d); }
      else { c.style.cursor = 'default'; }
      cells.appendChild(c);
    }
    card.appendChild(cells);

    const evList = document.createElement('div');
    evList.className = 'cal-month-events';
    const monthEvents = [];
    for(let d=1; d<=numDays; d++){
      (calState.events[calKeyOf(year,month,d)]||[]).forEach(ev=> monthEvents.push({d,ev}));
    }
    const grouped = calGroupConsecutiveEvents(monthEvents);
    if(grouped.length===0){
      evList.innerHTML = '<div class="cal-no-ev">Бичлэг алга</div>';
    }else{
      grouped.forEach(g=>{
        const cat = calState.categories.find(c=>c.id===g.catId);
        const row = document.createElement('div');
        row.className = 'cal-ev-row';
        const dayLabel = g.startDay===g.endDay ? `${g.startDay}` : `${g.startDay}-${g.endDay}`;
        row.innerHTML = `<span class="cal-dnum" style="background:${cat?cat.color:'#5b7ce0'}">${dayLabel}</span><span class="cal-title">${escapeHtml(g.title)}</span>`;
        if(isAdmin){
          const del = document.createElement('button');
          del.textContent = '✕';
          del.onclick = ()=>{ g.ids.forEach(({d,id})=> removeCalEvent(year,month,d,id)); };
          row.appendChild(del);
        }
        evList.appendChild(row);
      });
    }
    card.appendChild(evList);

    wrap.appendChild(card);
    grid.appendChild(wrap);
  });
}

function renderCalContentList(){
  const list = document.getElementById("cal-content-list");
  list.innerHTML = '';
  const seq = calMonthSequence(calState.startYear);
  const all = [];
  seq.forEach(({month,year})=>{
    const numDays = calDaysInMonth(year,month);
    for(let d=1; d<=numDays; d++){
      (calState.events[calKeyOf(year,month,d)]||[]).forEach(ev=>{
        all.push({y:year,m:month,d,ev});
      });
    }
  });
  if(all.length===0){
    list.innerHTML = '<li class="cal-empty-note">Одоогоор бичлэг алга</li>';
    return;
  }
  all.forEach(({y,m,d,ev})=>{
    const cat = calState.categories.find(c=>c.id===ev.catId);
    const li = document.createElement('li');
    li.style.setProperty('--dot', cat?cat.color:'#5b7ce0');
    li.innerHTML = `${escapeHtml(ev.title)}<span class="cal-when">${d} ${MN_MONTHS[m]}</span>`;
    list.appendChild(li);
  });
}

function openCalDayModal(y,m,d){
  const dateStr = `${d} ${MN_MONTHS[m]} ${y}`;
  const existing = calState.events[calKeyOf(y,m,d)] || [];

  const existingHtml = existing.length ? existing.map(ev=>{
    const cat = calState.categories.find(c=>c.id===ev.catId);
    return `<div class="cal-event-row" data-evid="${ev.id}"><span class="cal-tag" style="background:${cat?cat.color:'#999'}"></span><span class="cal-ev-title">${escapeHtml(ev.title)}</span><button class="icon-btn danger" data-rm-ev="${ev.id}">✕</button></div>`;
  }).join('') : '<p class="hint">Одоогоор бичлэг алга</p>';

  const modal = document.getElementById("cal-day-modal");
  modal.innerHTML = `
    <h2>Шинэ бичлэг</h2>
    <p class="hint">${dateStr}</p>
    <div class="cal-existing">${existingHtml}</div>
    <label>Гарчиг</label>
    <input type="text" id="cal-ev-title" placeholder="Жишээ: Эцэг эхийн уулзалт" maxlength="60">
    <label>Ангилал</label>
    <div class="cal-cat-picker" id="cal-cat-picker"></div>
    <div class="modal-actions">
      <button class="btn-ghost" id="cal-day-cancel">Хаах</button>
      <button class="btn-primary" id="cal-day-save">Нэмэх</button>
    </div>
  `;

  modal.querySelectorAll("[data-rm-ev]").forEach(btn=>
    btn.addEventListener("click", async ()=>{ await removeCalEvent(y,m,d,btn.dataset.rmEv); openCalDayModal(y,m,d); }));

  let selectedCat = calState.categories[0]?.id;
  const picker = modal.querySelector("#cal-cat-picker");
  calState.categories.forEach(cat=>{
    const chip = document.createElement('div');
    chip.className = 'cal-cat-chip' + (cat.id===selectedCat ? ' selected' : '');
    chip.style.background = cat.color;
    chip.textContent = cat.name;
    chip.onclick = ()=>{
      selectedCat = cat.id;
      [...picker.children].forEach(c=>c.classList.remove('selected'));
      chip.classList.add('selected');
    };
    picker.appendChild(chip);
  });

  modal.querySelector("#cal-day-cancel").onclick = ()=> closeModal("modal-cal-day");
  modal.querySelector("#cal-day-save").onclick = async ()=>{
    const titleInput = modal.querySelector("#cal-ev-title");
    const title = titleInput.value.trim();
    if(!title){ titleInput.focus(); return; }
    const k = calKeyOf(y,m,d);
    if(!calState.events[k]) calState.events[k] = [];
    calState.events[k].push({ id: uid(), title, catId: selectedCat });
    await saveCalendarState();
    renderCalendar();
    closeModal("modal-cal-day");
  };

  openModal("modal-cal-day");
}

async function removeCalEvent(y,m,d,evId){
  const k = calKeyOf(y,m,d);
  calState.events[k] = (calState.events[k]||[]).filter(e=>e.id!==evId);
  if(calState.events[k].length===0) delete calState.events[k];
  await saveCalendarState();
  renderCalendar();
}

function openCalCategoryManager(){
  const modal = document.getElementById("cal-category-modal");
  modal.innerHTML = `
    <h2>Ангилал удирдах</h2>
    <div id="cal-cat-list"></div>
    <div class="cal-cat-manager-row" style="margin-top:14px;">
      <input type="color" id="cal-new-cat-color" value="#5b7ce0">
      <input type="text" id="cal-new-cat-name" placeholder="Шинэ ангиллын нэр">
    </div>
    <button class="btn-ghost" id="cal-add-cat-go" style="width:100%;justify-content:center;margin-top:8px;">+ Ангилал нэмэх</button>
    <div class="modal-actions">
      <button class="btn-ghost" id="cal-category-close">Хаах</button>
    </div>
  `;
  const list = modal.querySelector("#cal-cat-list");
  calState.categories.forEach(cat=>{
    const row = document.createElement('div');
    row.className = 'cal-cat-manager-row';
    row.innerHTML = `<input type="color" value="${cat.color}" data-id="${cat.id}" class="cal-cat-color-input">
                      <input type="text" value="${escapeHtml(cat.name)}" data-id="${cat.id}" class="cal-cat-name-input">`;
    list.appendChild(row);
  });
  list.querySelectorAll(".cal-cat-color-input").forEach(inp=>{
    inp.oninput = async ()=>{
      const cat = calState.categories.find(c=>c.id===inp.dataset.id);
      cat.color = inp.value;
      await saveCalendarState();
      renderCalendar();
    };
  });
  list.querySelectorAll(".cal-cat-name-input").forEach(inp=>{
    inp.onchange = async ()=>{
      const cat = calState.categories.find(c=>c.id===inp.dataset.id);
      cat.name = inp.value.trim() || cat.name;
      await saveCalendarState();
      renderCalendar();
    };
  });
  modal.querySelector("#cal-add-cat-go").onclick = async ()=>{
    const name = modal.querySelector("#cal-new-cat-name").value.trim();
    const color = modal.querySelector("#cal-new-cat-color").value;
    if(!name) return;
    calState.categories.push({ id: uid(), name, color });
    await saveCalendarState();
    renderCalendar();
    openCalCategoryManager();
  };
  modal.querySelector("#cal-category-close").onclick = ()=> closeModal("modal-cal-category");
  openModal("modal-cal-category");
}

async function exportCalImage(){
  const btn = document.getElementById("cal-image-btn");
  const oldText = btn.textContent;
  btn.textContent = 'Зураг бэлдэж байна…';
  btn.disabled = true;
  try{
    const target = document.querySelector("#calendar-view .cal-wrap");
    const canvas = await html2canvas(target, { backgroundColor: '#eaf6ec', scale: 2, useCORS: true });
    canvas.toBlob((blob)=>{
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `huanli-${calState.startYear}-${calState.startYear+1}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      btn.textContent = oldText;
      btn.disabled = false;
    });
  }catch(err){
    showToast("Зураг бэлдэхэд алдаа гарлаа: " + err.message, true);
    btn.textContent = oldText;
    btn.disabled = false;
  }
}

/* ---------------- modals ---------------- */
function openModal(id){ document.getElementById(id).classList.add("show"); }
function closeModal(id){ document.getElementById(id).classList.remove("show"); }

/* ---------------- folder create ---------------- */
async function createFolder(){
  const input = document.getElementById("new-folder-name");
  const name = input.value.trim();
  if(!name) return;
  const { error } = await supabase.from("folders").insert({ id: uid(), name, parent_id: currentFolderId() });
  if(error){ showToast("Фолдер үүсгэхэд алдаа: " + error.message, true); return; }
  input.value = "";
  closeModal("modal-folder");
}

/* ---------------- upload ---------------- */
async function doUpload(){
  const input = document.getElementById("file-input");
  const status = document.getElementById("upload-status");
  const selected = Array.from(input.files || []);
  if(selected.length===0) return;
  const btn = document.getElementById("upload-go");
  btn.disabled = true;
  const folderId = currentFolderId();

  for(let i=0;i<selected.length;i++){
    const f = selected[i];
    status.textContent = `(${i+1}/${selected.length}) ${f.name} хуулж байна…`;
    const id = uid();
    const ext = extOf(f.name);
    const path = `${id}.${ext || "bin"}`;
    const mime = f.type || mimeFor(ext);
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, f, { contentType: mime, upsert: false });
    if(upErr){
      status.textContent = `Алдаа (${f.name}): ${upErr.message}`;
      btn.disabled = false;
      return;
    }
    const { error: dbErr } = await supabase.from("files").insert({
      id, name: f.name, folder_id: folderId, ext, mime, storage_path: path, size: f.size,
    });
    if(dbErr){
      await supabase.storage.from(BUCKET).remove([path]);
      status.textContent = `Алдаа (${f.name}): ${dbErr.message}`;
      btn.disabled = false;
      return;
    }
  }
  status.textContent = "";
  btn.disabled = false;
  input.value = "";
  closeModal("modal-upload");
}

/* ---------------- rename (shared: file or qr item) / delete ---------------- */
let renameTarget = null; // { type: "file" | "qr", id }
function openRename(type, id){
  renameTarget = { type, id };
  const item = type === "qr" ? qrItemById(id) : fileById(id);
  if(!item) return;
  document.getElementById("rename-input").value = item.name;
  openModal("modal-rename");
}
async function doRename(){
  const val = document.getElementById("rename-input").value.trim();
  if(!val || !renameTarget) return closeModal("modal-rename");
  const table = renameTarget.type === "qr" ? "qr_items" : "files";
  const { error } = await supabase.from(table).update({ name: val }).eq("id", renameTarget.id);
  if(error){ showToast("Нэр солиход алдаа: " + error.message, true); return; }
  closeModal("modal-rename");
}
async function deleteFile(id){
  const f = fileById(id);
  if(!f) return;
  if(!confirm(`"${f.name}" файлыг устгах уу?`)) return;
  const { error: rmErr } = await supabase.storage.from(BUCKET).remove([f.storage_path]);
  if(rmErr){ showToast("Устгахад алдаа: " + rmErr.message, true); return; }
  const { error: dbErr } = await supabase.from("files").delete().eq("id", f.id);
  if(dbErr){ showToast("Устгахад алдаа: " + dbErr.message, true); return; }
}

/* ---------------- QR board ---------------- */
const QR_LOGO_ASPECT = 0.6024; // combined school+ISO logo width/height

// Draws a logo-branded QR into #qr-gen-canvas (same layout/colors as the
// old standalone QR_Generator_184.html tool) so admins no longer have to
// open that separate file.
function drawGeneratedQr(url){
  return new Promise((resolve)=>{
    const canvas = document.getElementById("qr-gen-canvas");
    const ctx = canvas.getContext("2d");
    const qr = window.qrcode(0, "H");
    qr.addData(url);
    qr.make();
    const moduleCount = qr.getModuleCount();

    const CSS_SIZE = 240;
    const DPR = Math.max(window.devicePixelRatio || 1, 3);
    canvas.width = CSS_SIZE * DPR;
    canvas.height = CSS_SIZE * DPR;
    canvas.style.width = CSS_SIZE + "px";
    canvas.style.height = CSS_SIZE + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    const cell = CSS_SIZE / moduleCount;
    ctx.clearRect(0, 0, CSS_SIZE, CSS_SIZE);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, CSS_SIZE, CSS_SIZE);
    ctx.fillStyle = "#068A50";
    for(let r=0; r<moduleCount; r++){
      for(let c=0; c<moduleCount; c++){
        if(qr.isDark(r,c)){
          ctx.fillRect(Math.round(c*cell), Math.round(r*cell), Math.ceil(cell)+0.5, Math.ceil(cell)+0.5);
        }
      }
    }

    const logoImg = new Image();
    logoImg.onload = ()=>{
      const logoHeight = CSS_SIZE * 0.44;
      const logoWidth = logoHeight * QR_LOGO_ASPECT;
      ctx.drawImage(logoImg, (CSS_SIZE-logoWidth)/2, (CSS_SIZE-logoHeight)/2, logoWidth, logoHeight);
      resolve();
    };
    logoImg.onerror = ()=> resolve();
    logoImg.src = "./assets/qr/logo-combined.png";
  });
}

async function generateQrPreview(){
  const status = document.getElementById("qr-add-status");
  const url = document.getElementById("qr-item-url").value.trim();
  if(!url){ status.textContent = "Холбоосоо оруулна уу."; return; }
  try{ new URL(url); } catch(e){ status.textContent = "Зөв холбоос (URL) оруулна уу."; return; }
  status.textContent = "";
  await drawGeneratedQr(url);
  document.getElementById("qr-gen-placeholder").hidden = true;
  document.getElementById("qr-gen-canvas").hidden = false;
  document.getElementById("qr-add-go").disabled = false;
}

function addGeneratedQrToBoard(){
  const nameInput = document.getElementById("qr-item-name");
  const status = document.getElementById("qr-add-status");
  const name = nameInput.value.trim();
  if(!name){ status.textContent = "Нэр оруулна уу."; return; }
  const canvas = document.getElementById("qr-gen-canvas");
  status.textContent = "Хадгалж байна…";
  canvas.toBlob(async (blob)=>{
    if(!blob){ status.textContent = "QR зураг бэлдэхэд алдаа гарлаа."; return; }
    const id = uid();
    const path = `qr/${id}.png`;
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: "image/png" });
    if(upErr){ status.textContent = "Алдаа: " + upErr.message; return; }
    const nextPosition = qrItems.reduce((max,x)=> Math.max(max, x.position ?? 0), -1) + 1;
    const { error: dbErr } = await supabase.from("qr_items").insert({ id, name, storage_path: path, position: nextPosition });
    if(dbErr){
      await supabase.storage.from(BUCKET).remove([path]);
      status.textContent = "Алдаа: " + dbErr.message;
      return;
    }
    status.textContent = "";
    closeModal("modal-qr-add");
  }, "image/png");
}

// Shortcut from the file viewer: pre-fill name/link with the open file's and
// generate the preview immediately, so admin only has to hit "Самбарт нэмэх".
async function openQrGenFromViewer(){
  if(!viewerQrTarget) return;
  document.getElementById("qr-item-name").value = viewerQrTarget.name;
  document.getElementById("qr-item-url").value = viewerQrTarget.url;
  document.getElementById("qr-add-status").textContent = "";
  document.getElementById("qr-gen-canvas").hidden = true;
  document.getElementById("qr-gen-placeholder").hidden = false;
  document.getElementById("qr-add-go").disabled = true;
  openModal("modal-qr-add");
  await generateQrPreview();
}
async function deleteQrItem(id){
  const item = qrItemById(id);
  if(!item) return;
  if(!confirm(`"${item.name}" QR-г устгах уу?`)) return;
  const { error: rmErr } = await supabase.storage.from(BUCKET).remove([item.storage_path]);
  if(rmErr){ showToast("Устгахад алдаа: " + rmErr.message, true); return; }
  const { error: dbErr } = await supabase.from("qr_items").delete().eq("id", id);
  if(dbErr){ showToast("Устгахад алдаа: " + dbErr.message, true); return; }
}

/* ---------------- file viewer ---------------- */
function closeViewer(){
  const f = fileById(currentFileId());
  location.hash = "f=" + encodeURIComponent(f ? f.folder_id : "root");
}

let viewerQrTarget = null; // { name, url } of the file currently open in the viewer, for the "QR үүсгэх" shortcut
async function openViewer(fileId){
  const f = fileById(fileId);
  const body = document.getElementById("viewer-body");
  const meta = typeMeta(f ? f.ext : "");
  document.getElementById("viewer-badge").innerHTML = `<span class="badge" style="background:${meta.bg}">${meta.label}</span>`;
  document.getElementById("viewer-name").textContent = f ? f.name : "Файл олдсонгүй";
  body.innerHTML = `<div class="center-card">Ачааллаж байна…</div>`;
  viewerQrTarget = f ? { name: f.name, url: publicUrlFor(f.storage_path) } : null;
  document.getElementById("viewer-qr-btn").hidden = !session || !f;
  if(!f){ body.innerHTML = `<div class="center-card">Энэ файл олдсонгүй. Устгагдсан байж магадгүй.</div>`; return; }

  const url = publicUrlFor(f.storage_path);
  try{
    if(["png","jpg","jpeg","gif","webp","svg"].includes(f.ext)){
      body.innerHTML = `<img class="preview" src="${url}" alt="${escapeHtml(f.name)}" />`;
      return;
    }
    if(f.ext==="pdf"){
      body.innerHTML = `<embed class="pdf-frame" src="${url}" type="application/pdf" />`;
      return;
    }
    if(["docx","doc","xlsx","xls","pptx","ppt"].includes(f.ext)){
      const officeUrl = "https://view.officeapps.live.com/op/embed.aspx?src=" + encodeURIComponent(url);
      body.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;gap:10px;width:100%;">
        <iframe class="office-frame" src="${officeUrl}" frameborder="0"></iframe>
        <p class="hint">Дэлгэц дээр гарахгүй бол <a href="${url}" target="_blank" rel="noopener">шинэ tab-аар нээх</a>.</p>
      </div>`;
      return;
    }
    if(f.ext==="drawio"){
      const openUrl = "https://app.diagrams.net/#U" + encodeURIComponent(url);
      body.innerHTML = `<div class="center-card">
        <div class="badge" style="background:${meta.bg}">${meta.label}</div>
        <div style="font-weight:700;margin-bottom:6px;">${escapeHtml(f.name)}</div>
        <p class="hint" style="margin-bottom:18px;">draw.io диаграм. Шинэ tab дээр diagrams.net ашиглан нээнэ.</p>
        <a class="btn-primary" style="justify-content:center;text-decoration:none;" target="_blank" rel="noopener" href="${openUrl}">Diagrams.net дээр нээх ↗</a>
      </div>`;
      return;
    }
    body.innerHTML = `<div class="center-card">
      <div class="badge" style="background:${meta.bg}">${meta.label}</div>
      <div style="font-weight:700;margin-bottom:6px;">${escapeHtml(f.name)}</div>
      <p class="hint" style="margin-bottom:18px;">Энэ төрлийг сайт дээр урьдчилан харах дэмжлэггүй.</p>
      <a class="btn-ghost" style="text-decoration:none;" target="_blank" rel="noopener" href="${url}">Шинэ tab-аар нээх ↗</a>
    </div>`;
  }catch(err){
    body.innerHTML = `<div class="center-card">
      <div style="font-weight:700;margin-bottom:6px;color:var(--danger);">Нээхэд алдаа гарлаа</div>
      <p class="hint">${escapeHtml(String((err && err.message) || err))}</p>
    </div>`;
  }
}

/* ---------------- static event wiring ---------------- */
function wireStaticEvents(){
  document.getElementById("gate-btn").addEventListener("click", tryUnlock);
  document.getElementById("gate-input").addEventListener("keydown", e=>{ if(e.key==="Enter") tryUnlock(); });

  document.getElementById("search-input").addEventListener("input", render);

  document.getElementById("admin-btn").addEventListener("click", async ()=>{
    if(session){ await supabase.auth.signOut(); }
    else { openModal("modal-admin"); }
  });
  document.getElementById("admin-login-go").addEventListener("click", adminLogin);

  document.getElementById("new-folder-btn").addEventListener("click", ()=>{
    document.getElementById("new-folder-name").value = "";
    openModal("modal-folder");
  });
  document.getElementById("create-folder-go").addEventListener("click", createFolder);

  document.getElementById("upload-btn").addEventListener("click", ()=>{
    document.getElementById("file-input").value = "";
    document.getElementById("upload-status").textContent = "";
    openModal("modal-upload");
  });
  document.getElementById("upload-go").addEventListener("click", doUpload);

  document.getElementById("qr-add-btn").addEventListener("click", ()=>{
    document.getElementById("qr-item-name").value = "";
    document.getElementById("qr-item-url").value = "";
    document.getElementById("qr-add-status").textContent = "";
    document.getElementById("qr-gen-canvas").hidden = true;
    document.getElementById("qr-gen-placeholder").hidden = false;
    document.getElementById("qr-add-go").disabled = true;
    openModal("modal-qr-add");
  });
  document.getElementById("qr-gen-go").addEventListener("click", generateQrPreview);
  document.getElementById("qr-add-go").addEventListener("click", addGeneratedQrToBoard);

  document.getElementById("rename-go").addEventListener("click", doRename);
  document.getElementById("viewer-close-btn").addEventListener("click", closeViewer);
  document.getElementById("viewer-qr-btn").addEventListener("click", openQrGenFromViewer);

  document.getElementById("cal-add-category-btn").addEventListener("click", openCalCategoryManager);
  document.getElementById("cal-year-input").addEventListener("change", async (e)=>{
    const v = parseInt(e.target.value,10);
    if(!isNaN(v)){ calState.startYear = v; await saveCalendarState(); renderCalendar(); }
  });
  document.getElementById("cal-image-btn").addEventListener("click", exportCalImage);
  document.getElementById("cal-print-btn").addEventListener("click", ()=> window.print());

  document.querySelectorAll("[data-close]").forEach(el=>
    el.addEventListener("click", ()=> closeModal(el.dataset.close)));
}

boot();
