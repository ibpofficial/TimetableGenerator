/* IBP Timetable Generator — app.js
   Constraint-aware scheduler with a step-by-step wizard.
   No external libraries required.
*/

// ---------- State ----------
const state = {
  days: ["Mon","Tue","Wed","Thu","Fri"],
  startTime: "09:00",
  endTime: "17:00",
  slotLength: 50, // minutes
  maxClassesPerDay: 6,

  rooms: { theory: 4, labs: 2, theoryPrefix: "T", labPrefix: "L" },

  batches: [], // ["CSE-3A", ...]
  faculties: [], // [{id,name,leaves}]
  subjects: [],  // [{id,batch,name,type,classesPerWeek,sessionLength,facultyId,fixed?,fixedDay,fixedStart,fixedLength,unavail:[{day,start,end}], }]
  breaks: [], // [{day,start,durationMins}]
  events: [], // [{name,day,start,length,roomType}]
  options: { maxAttempts: 4000, balanceAcrossWeek: true },

  // Will be set during generate
  solution: null
};

// ---------- Utilities ----------
const byId = id => document.getElementById(id);
const fmt = n => (n<10? "0"+n : ""+n);
const t2m = t => { const [h,m] = t.split(":").map(Number); return h*60 + m; };
const m2t = m => `${fmt(Math.floor(m/60))}:${fmt(m%60)}`;

function clone(obj){ return JSON.parse(JSON.stringify(obj)); }

function uniqueId(prefix="id"){
  return prefix + "_" + Math.random().toString(36).slice(2,9);
}

function infoSummary(){
  const s = [];
  s.push(`Days: ${state.days.join(", ")}`);
  s.push(`Working hours: ${state.startTime}–${state.endTime} | Slot: ${state.slotLength} mins`);
  s.push(`Max classes/day (per batch): ${state.maxClassesPerDay}`);
  s.push(`Rooms: ${state.rooms.theory} theory (${state.rooms.theoryPrefix}1…); ${state.rooms.labs} labs (${state.rooms.labPrefix}1…)`);
  s.push(`Batches: ${state.batches.join(", ") || "—"}`);
  s.push(`Faculties: ${state.faculties.map(f=>f.name).join(", ") || "—"}`);
  s.push(`Subjects: ${state.subjects.length}`);
  s.push(`Breaks: ${state.breaks.length} • Events: ${state.events.length}`);
  return s.join("\n");
}

function download(filename, content, mime="text/plain"){
  const blob = new Blob([content], {type: mime});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
}

function toCSV(rows){
  return rows.map(r => r.map(x => `"${(x??"").toString().replaceAll('"','""')}"`).join(",")).join("\n");
}

// Populate day selects dynamically
function populateDaySelects(){
  const daySelectIds = ["fixedDay","subUnavailDay","breakDay","eventDay"];
  daySelectIds.forEach(id => {
    const sel = byId(id);
    if(!sel) return;
    sel.innerHTML = "";
    state.days.forEach(d => {
      const opt = document.createElement("option");
      opt.value = d; opt.textContent = d;
      sel.appendChild(opt);
    });
  });
}

// ---------- Wizard Navigation ----------
let currentStep = 1;
function showStep(n){
  currentStep = n;
  document.querySelectorAll(".step").forEach(sec => {
    sec.hidden = (Number(sec.dataset.step) !== n);
  });
  document.querySelectorAll(".steps li").forEach(li => {
    const step = Number(li.dataset.step);
    li.classList.toggle("active", step === n);
    li.classList.toggle("done", step < n);
  });

  if(n === 4){ // sync batch & faculty selects
    syncBatchAndFacultySelects();
  }
  if(n === 6){ // summary
    byId("summary").textContent = infoSummary();
  }
  if(n === 7){
    renderResults();
  }
}

document.querySelectorAll(".next").forEach(btn => btn.addEventListener("click", () => showStep(currentStep+1)));
document.querySelectorAll(".prev").forEach(btn => btn.addEventListener("click", () => showStep(currentStep-1)));
document.querySelectorAll(".steps li").forEach(li => li.addEventListener("click", ()=>{
  const step = Number(li.dataset.step);
  if(step<=currentStep) showStep(step);
}));

// ---------- Step 1: Institution & Time ----------
document.querySelectorAll(".dayCheck").forEach(chk => chk.addEventListener("change", () => {
  state.days = Array.from(document.querySelectorAll(".dayCheck:checked")).map(c=>c.value);
  populateDaySelects();
}));

byId("startTime").addEventListener("change", e => state.startTime = e.target.value);
byId("endTime").addEventListener("change", e => state.endTime = e.target.value);
byId("slotLength").addEventListener("change", e => state.slotLength = Number(e.target.value));
byId("maxClassesPerDay").addEventListener("change", e => state.maxClassesPerDay = Number(e.target.value));

byId("numTheoryRooms").addEventListener("change", e => state.rooms.theory = Number(e.target.value));
byId("numLabs").addEventListener("change", e => state.rooms.labs = Number(e.target.value));
byId("theoryPrefix").addEventListener("change", e => state.rooms.theoryPrefix = e.target.value || "T");
byId("labPrefix").addEventListener("change", e => state.rooms.labPrefix = e.target.value || "L");

// ---------- Step 2: Batches ----------
byId("addBatch").addEventListener("click", () => {
  const name = byId("batchNameInput").value.trim();
  if(!name) return;
  if(state.batches.includes(name)){ alert("Batch already added."); return; }
  state.batches.push(name);
  byId("batchNameInput").value = "";
  renderBatches();
});

function renderBatches(){
  const container = byId("batchesList");
  container.innerHTML = "";
  state.batches.forEach(b => {
    const el = document.createElement("div");
    el.className = "chip";
    el.innerHTML = `<span>${b}</span> <button title="Remove">✕</button>`;
    el.querySelector("button").addEventListener("click", ()=>{
      state.batches = state.batches.filter(x=>x!==b);
      state.subjects = state.subjects.filter(s=>s.batch!==b);
      renderBatches(); renderSubjects();
    });
    container.appendChild(el);
  });
  syncBatchAndFacultySelects();
}

// ---------- Step 3: Faculties ----------
byId("addFaculty").addEventListener("click", () => {
  const name = byId("facultyNameInput").value.trim();
  const leaves = Number(byId("facultyLeavesInput").value || 0);
  if(!name) return;
  const f = { id: uniqueId("F"), name, leaves };
  state.faculties.push(f);
  byId("facultyNameInput").value = "";
  renderFaculties();
  syncBatchAndFacultySelects();
});

function renderFaculties(){
  const container = byId("facultiesList");
  container.innerHTML = "";
  state.faculties.forEach(f => {
    const card = document.createElement("div");
    card.className = "minicard";
    card.innerHTML = `<div class="title">${f.name}</div><div class="meta">Avg leaves/mo: ${f.leaves||0}</div>
    <div class="row" style="margin-top:8px">
      <button class="ghost" data-act="del">Remove</button>
    </div>`;
    card.querySelector("[data-act=del]").addEventListener("click", ()=>{
      state.faculties = state.faculties.filter(x=>x.id!==f.id);
      // also remove from subjects
      state.subjects.forEach(s=>{ if(s.facultyId===f.id) s.facultyId=null; });
      renderFaculties(); renderSubjects();
      syncBatchAndFacultySelects();
    });
    container.appendChild(card);
  });
}

// ---------- Step 4: Subjects ----------
function syncBatchAndFacultySelects(){
  const sb = byId("subjectBatch"); sb.innerHTML="";
  state.batches.forEach(b => {
    const opt = document.createElement("option"); opt.value=b; opt.textContent=b; sb.appendChild(opt);
  });
  const facSel = byId("subjectFaculty"); facSel.innerHTML = "";
  state.faculties.forEach(f => {
    const opt = document.createElement("option"); opt.value=f.id; opt.textContent=f.name; facSel.appendChild(opt);
  });
  populateDaySelects();
}

byId("hasFixedSlot").addEventListener("change", e => {
  const en = e.target.checked;
  ["fixedDay","fixedStart","fixedLength"].forEach(id=>{ byId(id).disabled = !en; });
});

const subUnavails = []; // temp collection during subject creation
byId("addSubUnavail").addEventListener("click", ()=>{
  const start = byId("subUnavailStart").value;
  const end = byId("subUnavailEnd").value;
  const day = byId("subUnavailDay").value;
  if(!start || !end || !day){ alert("Select start, end and day."); return; }
  subUnavails.push({day, start, end});
  renderSubUnavailChips();
});
function renderSubUnavailChips(){
  const c = byId("subUnavailList"); c.innerHTML="";
  subUnavails.forEach((u,idx)=>{
    const el = document.createElement("div"); el.className="chip";
    el.innerHTML = `<span>${u.day} ${u.start}–${u.end}</span> <button title="Remove">✕</button>`;
    el.querySelector("button").addEventListener("click", ()=>{
      subUnavails.splice(idx,1); renderSubUnavailChips();
    });
    c.appendChild(el);
  });
}

byId("addSubject").addEventListener("click", ()=>{
  const batch = byId("subjectBatch").value;
  const name = byId("subjectName").value.trim();
  const type = byId("subjectType").value;
  const classesPerWeek = Number(byId("classesPerWeek").value||1);
  const sessionLength = Number(byId("sessionLength").value||1);
  const facultyId = byId("subjectFaculty").value || null;

  if(!batch || !name){ alert("Please enter batch and subject name."); return; }
  const subj = {
    id: uniqueId("S"), batch, name, type, classesPerWeek, sessionLength, facultyId,
    unavail: subUnavails.splice(0) // copy & clear
  };
  if(byId("hasFixedSlot").checked){
    subj.fixed = true;
    subj.fixedDay = byId("fixedDay").value;
    subj.fixedStart = byId("fixedStart").value;
    subj.fixedLength = Number(byId("fixedLength").value||1);
  }
  state.subjects.push(subj);
  byId("subjectName").value = ""; byId("sessionLength").value = 1; byId("classesPerWeek").value = 3;
  byId("hasFixedSlot").checked = false; ["fixedDay","fixedStart","fixedLength"].forEach(id=>{ byId(id).disabled = true; });
  renderSubUnavailChips();
  renderSubjects();
});

function renderSubjects(){
  const container = byId("subjectsList"); container.innerHTML="";
  state.subjects.forEach(s => {
    const facName = (state.faculties.find(f=>f.id===s.facultyId)||{}).name || "—";
    const card = document.createElement("div");
    card.className = "minicard";
    const fixed = s.fixed ? ` • Fixed: ${s.fixedDay} ${s.fixedStart} (${s.fixedLength} slots)` : "";
    const unv = s.unavail?.length ? ` • Unavail: ${s.unavail.map(u=>`${u.day} ${u.start}-${u.end}`).join("; ")}` : "";
    card.innerHTML = `<div class="title">${s.name} <span class="meta">[${s.batch}]</span></div>
      <div class="meta">${s.type} • ${s.classesPerWeek}×/week • ${s.sessionLength} slot(s) • Faculty: ${facName}${fixed}${unv}</div>
      <div class="row" style="margin-top:8px"><button class="ghost" data-act="del">Remove</button></div>`;
    card.querySelector("[data-act=del]").addEventListener("click", ()=>{
      state.subjects = state.subjects.filter(x=>x.id!==s.id);
      renderSubjects();
    });
    container.appendChild(card);
  });
}

// ---------- Step 5: Breaks & Fixed Events ----------
byId("addBreak").addEventListener("click", ()=>{
  const start = byId("breakStart").value;
  const durationMins = Number(byId("breakDuration").value||0);
  const day = byId("breakDay").value;
  if(!start || !day || !durationMins){ alert("Enter break start, duration and day."); return; }
  state.breaks.push({ day, start, durationMins });
  renderBreaks();
});

function renderBreaks(){
  const c = byId("breaksList"); c.innerHTML="";
  state.breaks.forEach((b,idx)=>{
    const el = document.createElement("div"); el.className = "chip";
    el.innerHTML = `<span>${b.day} ${b.start} • ${b.durationMins} mins</span> <button>✕</button>`;
    el.querySelector("button").addEventListener("click", ()=>{
      state.breaks.splice(idx,1); renderBreaks();
    });
    c.appendChild(el);
  });
}

byId("addEvent").addEventListener("click", ()=>{
  const name = byId("eventName").value.trim();
  const day = byId("eventDay").value;
  const start = byId("eventStart").value;
  const length = Number(byId("eventLen").value||1);
  const roomType = byId("eventRoomType").value;
  if(!name || !day || !start){ alert("Enter event name, day, start."); return; }
  state.events.push({ name, day, start, length, roomType });
  byId("eventName").value=""; renderEvents();
});

function renderEvents(){
  const c = byId("eventsList"); c.innerHTML="";
  state.events.forEach((e,idx)=>{
    const el = document.createElement("div"); el.className="minicard";
    el.innerHTML = `<div class="title">${e.name}</div><div class="meta">${e.day} ${e.start} • ${e.length} slot(s) • ${e.roomType}</div>
    <div class="row" style="margin-top:8px"><button class="ghost">Remove</button></div>`;
    el.querySelector("button").addEventListener("click", ()=>{
      state.events.splice(idx,1); renderEvents();
    });
    c.appendChild(el);
  });
}

// ---------- Step 6: Generate ----------
byId("maxAttempts").addEventListener("change", e => state.options.maxAttempts = Number(e.target.value||1000));
byId("balanceAcrossWeek").addEventListener("change", e => state.options.balanceAcrossWeek = !!e.target.checked);

byId("generate").addEventListener("click", () => {
  byId("genStatus").textContent = "Generating…";
  setTimeout(()=>{ // allow UI paint
    try{
      const sol = generateSchedule();
      if(sol){
        state.solution = sol;
        byId("genStatus").textContent = "Success!";
        showStep(7);
      }else{
        byId("genStatus").textContent = "No feasible schedule found. Try relaxing constraints (fewer fixed slots, more rooms, longer day, or shorter sessions).";
      }
    }catch(err){
      console.error(err);
      byId("genStatus").textContent = "Error: " + err.message;
    }
  }, 30);
});

// ---------- Step 7: Results & Export ----------
function renderResults(){
  const wrap = byId("results");
  wrap.innerHTML = "";
  if(!state.solution){ wrap.textContent = "No results."; return; }

  // Tabs per batch
  const tabs = document.createElement("div"); tabs.className="tabs";
  wrap.appendChild(tabs);

  const views = document.createElement("div");
  wrap.appendChild(views);

  const batches = Object.keys(state.solution.byBatch);
  let active = batches[0];

  function render(){
    tabs.innerHTML="";
    batches.forEach(b => {
      const t = document.createElement("button");
      t.className = "tab" + (b===active? " active":"");
      t.textContent = b;
      t.addEventListener("click", ()=>{ active = b; render(); });
      tabs.appendChild(t);
    });

    views.innerHTML = "";
    const table = buildTimetableTable(state.solution, active);
    views.appendChild(table);
  }
  render();
}

byId("btnPrint").addEventListener("click", ()=>window.print());

byId("btnExportAllCSV").addEventListener("click", ()=>{
  if(!state.solution) return;
  const rows = [["Batch","Day","Start","End","Subject","Faculty","Room"]];
  const { timeslots, byBatch } = state.solution;
  const tsById = Object.fromEntries(timeslots.map(t=>[t.id,t]));
  for(const [batch, cells] of Object.entries(byBatch)){
    for(const cell of cells){
      const t = tsById[cell.timeslotId];
      rows.push([batch, t.day, t.start, t.end, cell.subject, cell.faculty, cell.room]);
    }
  }
  download("timetables.csv", toCSV(rows), "text/csv");
});

byId("btnExportJSON").addEventListener("click", ()=>{
  if(!state.solution) return;
  download("timetables.json", JSON.stringify(state.solution, null, 2), "application/json");
});

byId("startOver").addEventListener("click", ()=>{
  if(confirm("Clear everything and start over?")){
    location.reload();
  }
});

// ---------- Save / Load / Sample ----------
byId("btnSaveConfig").addEventListener("click", ()=>{
  const cfg = clone(state); cfg.solution = null; // don't save big solution
  download("ibp-timetable-setup.json", JSON.stringify(cfg, null, 2), "application/json");
});
byId("btnLoadConfig").addEventListener("click", ()=>{
  const inp = document.createElement("input"); inp.type="file"; inp.accept=".json,application/json";
  inp.onchange = async () => {
    const file = inp.files[0]; if(!file) return;
    const txt = await file.text();
    const cfg = JSON.parse(txt);
    Object.assign(state, cfg);
    // Re-render UI
    renderBatches(); renderFaculties(); renderSubjects(); renderBreaks(); renderEvents();
    populateDaySelects();
    byId("startTime").value = state.startTime;
    byId("endTime").value = state.endTime;
    byId("slotLength").value = state.slotLength;
    byId("maxClassesPerDay").value = state.maxClassesPerDay;
    byId("numTheoryRooms").value = state.rooms.theory;
    byId("numLabs").value = state.rooms.labs;
    byId("theoryPrefix").value = state.rooms.theoryPrefix;
    byId("labPrefix").value = state.rooms.labPrefix;
    alert("Setup loaded.");
  };
  inp.click();
});

byId("btnReset").addEventListener("click", ()=>{
  if(confirm("Reset the setup? This will clear batches, faculties, subjects, breaks, and events.")){
    state.batches = [];
    state.faculties = [];
    state.subjects = [];
    state.breaks = [];
    state.events = [];
    renderBatches(); renderFaculties(); renderSubjects(); renderBreaks(); renderEvents();
  }
});

byId("sampleData").addEventListener("click", (e)=>{
  e.preventDefault();
  loadSample();
  alert("Sample data loaded. Go to Step 6 → Generate.");
});

function loadSample(){
  state.days = ["Mon","Tue","Wed","Thu","Fri"];
  state.startTime = "09:00"; state.endTime="16:00"; state.slotLength=60; state.maxClassesPerDay=5;
  state.rooms = { theory: 3, labs: 1, theoryPrefix:"T", labPrefix:"L" };
  state.batches = ["CSE-3A", "ECE-3B"];
  state.faculties = [
    {id: "F1", name:"Dr. Sharma", leaves: 1},
    {id: "F2", name:"Prof. Rao", leaves: 1},
    {id: "F3", name:"Dr. Mehta", leaves: 2},
  ];
  state.subjects = [
    {id:"S1", batch:"CSE-3A", name:"Data Structures", type:"theory", classesPerWeek:3, sessionLength:1, facultyId:"F1", unavail:[]},
    {id:"S2", batch:"CSE-3A", name:"OOP", type:"theory", classesPerWeek:2, sessionLength:1, facultyId:"F2", unavail:[{day:"Wed", start:"13:00", end:"16:00"}]},
    {id:"S3", batch:"CSE-3A", name:"DS Lab", type:"practical", classesPerWeek:1, sessionLength:2, facultyId:"F1", unavail:[]},
    {id:"S4", batch:"ECE-3B", name:"Signals", type:"theory", classesPerWeek:3, sessionLength:1, facultyId:"F3", unavail:[]},
    {id:"S5", batch:"ECE-3B", name:"Circuits", type:"theory", classesPerWeek:2, sessionLength:1, facultyId:"F2", unavail:[]},
    {id:"S6", batch:"ECE-3B", name:"Circuits Lab", type:"practical", classesPerWeek:1, sessionLength:2, facultyId:"F2", unavail:[]},
  ];
  state.breaks = [
    {day:"Mon", start:"12:00", durationMins:60},
    {day:"Wed", start:"12:00", durationMins:60},
  ];
  state.events = [
    {name:"Dept Seminar", day:"Fri", start:"11:00", length:1, roomType:"theory"}
  ];
  // update UI
  renderBatches(); renderFaculties(); renderSubjects(); renderBreaks(); renderEvents();
  populateDaySelects();
}

// ---------- Scheduler Core ----------
function generateSchedule(){
  // Build all timeslots
  const timeslots = buildTimeslots();
  // Pre-occupancy maps
  const roomsByType = {
    theory: Array.from({length: state.rooms.theory}, (_,i)=> state.rooms.theoryPrefix + (i+1)),
    practical: Array.from({length: state.rooms.labs}, (_,i)=> state.rooms.labPrefix + (i+1))
  };

  // Build fixed assignments first
  const occupancy = {
    room: new Map(),     // key: timeslotId -> Set(roomId)
    faculty: new Map(),  // key: timeslotId -> Set(facultyId)
    batch: new Map(),    // key: timeslotId -> Set(batchName)
    dayCount: {}         // key: batchName -> {Mon: n, ...}
  };
  state.batches.forEach(b => occupancy.dayCount[b] = Object.fromEntries(state.days.map(d=>[d,0])));

  const assignments = []; // {batch, subjectId, timeslotId, length, room, facultyId, subject}
  const tasks = [];

  function tsById(id){ return timeslots.find(t=>t.id===id); }

  function occupy(tsId, room, facultyId, batch){
    const addTo = (map, key, value) => {
      if(!map.has(key)) map.set(key, new Set());
      map.get(key).add(value);
    };
    addTo(occupancy.room, tsId, room);
    addTo(occupancy.faculty, tsId, facultyId);
    addTo(occupancy.batch, tsId, batch);
  }

  function isRoomFree(tsId, room){
    const used = occupancy.room.get(tsId);
    return !used || !used.has(room);
  }
  function isFacultyFree(tsId, facultyId){
    const used = occupancy.faculty.get(tsId);
    return !used || !used.has(facultyId);
  }
  function isBatchFree(tsId, batch){
    const used = occupancy.batch.get(tsId);
    return !used || !used.has(batch);
  }

  // Helper: find available room for a type at a timeslot
  function findRoom(roomType, tsId){
    const list = roomsByType[roomType] || [];
    for(const r of list){
      if(isRoomFree(tsId, r)) return r;
    }
    return null;
  }

  // Mark global breaks & events as occupied
  for(const ev of state.events){
    const candidate = findStartTimeslot(ev.day, ev.start, timeslots);
    if(!candidate) continue; // if mismatch with slot boundaries, skip
    for(let k=0;k<ev.length;k++){
      const ts = timeslots[candidate.index + k];
      if(!ts || ts.day!==ev.day || ts.isBreak) break;
      const room = findRoom(ev.roomType, ts.id);
      if(!room) return null; // no room to host event
      occupy(ts.id, room, "_EVENT_", "_EVENT_");
      assignments.push({batch:"_EVENT_", subject:"["+ev.name+"]", subjectId:null, timeslotId: ts.id, length:1, room, facultyId:"_EVENT_"});
    }
  }

  // Fixed subject slots first
  for(const s of state.subjects.filter(x=>x.fixed)){
    const {batch, facultyId, fixedDay, fixedStart, fixedLength, type, name, id} = s;
    const start = findStartTimeslot(fixedDay, fixedStart, timeslots);
    if(!start) return null;
    for(let k=0;k<fixedLength;k++){
      const ts = timeslots[start.index + k];
      if(!ts || ts.day!==fixedDay || ts.isBreak) return null;
      // Check constraints
      if(!isBatchFree(ts.id, batch)) return null;
      if(!isFacultyFree(ts.id, facultyId)) return null;
      const room = findRoom(type==="practical" ? "practical":"theory", ts.id);
      if(!room) return null;
      occupy(ts.id, room, facultyId, batch);
      assignments.push({batch, subjectId:id, subject:name, timeslotId: ts.id, length:1, room, facultyId});
      occupancy.dayCount[batch][ts.day]++;
    }
    // reduce weekly demand accordingly
    const needed = Math.max(0, s.classesPerWeek - 1); // one session consumed (assuming fixedLength == sessionLength)
    s._remaining = needed;
  }

  // Create remaining tasks (sessions) per subject
  for(const s of state.subjects){
    const remaining = s._remaining ?? s.classesPerWeek;
    for(let i=0;i<remaining;i++){
      tasks.push({ type:"subject", subj: s });
    }
  }

  // Expand tasks so that practical sessionLength>1 are scheduled as contiguous blocks
  function domainFor(subj){
    const roomType = subj.type==="practical" ? "practical" : "theory";
    const length = subj.sessionLength||1;
    const dom = [];
    for(let i=0;i<timeslots.length;i++){
      const ts = timeslots[i];
      if(ts.isBreak || ts.day==="_NA_") continue;
      // Check contiguous span within same day
      let ok = true;
      for(let k=0;k<length;k++){
        const tk = timeslots[i+k];
        if(!tk || tk.day!==ts.day || tk.isBreak){ ok=false; break; }
      }
      if(!ok) continue;
      // subject unavailability
      if(isSubUnavailable(subj, ts.day, ts.startMin, timeslots[i+length-1].endMin)) continue;
      dom.push({index:i, roomType, length});
    }
    return dom;
  }

  function isSubUnavailable(subj, day, startMin, endMin){
    if(!subj.unavail || !subj.unavail.length) return false;
    for(const u of subj.unavail){
      if(u.day!==day) continue;
      const a = t2m(u.start), b = t2m(u.end);
      if(!(endMin<=a || startMin>=b)) return true; // overlaps
    }
    return false;
  }

  // Balance: order tasks so large sessionLength (labs) first, then those with smaller domains
  const taskObjs = tasks.map(t => ({
    kind: "sub",
    subj: t.subj,
    sessionLength: t.subj.sessionLength||1,
    facultyId: t.subj.facultyId,
    batch: t.subj.batch
  }));

  // Compute domains once; will be re-checked during assign
  const preDomains = new Map();
  for(const tk of taskObjs){
    preDomains.set(tk, domainFor(tk.subj));
  }
  taskObjs.sort((a,b)=>{
    const lenDiff = (b.sessionLength)-(a.sessionLength);
    if(lenDiff) return lenDiff;
    return (preDomains.get(a).length)-(preDomains.get(b).length);
  });

  const maxAttempts = state.options.maxAttempts || 4000;
  let attempts = 0;

  function trySolve(){
    attempts++;
    const localAssignments = clone(assignments);
    const occ = {
      room: new Map(Array.from(occupancy.room.entries()).map(([k,v])=>[k,new Set(Array.from(v))])),
      faculty: new Map(Array.from(occupancy.faculty.entries()).map(([k,v])=>[k,new Set(Array.from(v))])),
      batch: new Map(Array.from(occupancy.batch.entries()).map(([k,v])=>[k,new Set(Array.from(v))])),
      dayCount: clone(occupancy.dayCount)
    };

    function tryPlaceTask(idx){
      if(idx>=taskObjs.length) return true; // done
      const tk = taskObjs[idx];
      const { subj } = tk;
      // Build dynamic domain filtered by current occupancy
      const domBase = preDomains.get(tk);
      const dom = domBase.slice();
      if(state.options.balanceAcrossWeek){
        // prefer days with fewer classes for the batch
        dom.sort((A,B)=> occ.dayCount[subj.batch][timeslots[A.index].day] - occ.dayCount[subj.batch][timeslots[B.index].day]);
      }else{
        // randomize to explore
        dom.sort(()=>Math.random()-0.5);
      }

      for(const d of dom){
        const i = d.index, L = d.length;
        const day = timeslots[i].day;
        if(occ.dayCount[subj.batch][day] + 1 > state.maxClassesPerDay) continue;

        let ok = true;
        const chosenRooms = [];
        for(let k=0;k<L;k++){
          const tkSlot = timeslots[i+k];
          if(!tkSlot || tkSlot.day!==day || tkSlot.isBreak){ ok=false; break; }
          if(!isBatchFreeLocal(occ, tkSlot.id, subj.batch)){ ok=false; break; }
          if(!isFacultyFreeLocal(occ, tkSlot.id, subj.facultyId)){ ok=false; break; }
          const room = findRoomLocal(occ, subj.type==="practical" ? "practical":"theory", tkSlot.id);
          if(!room){ ok=false; break; }
          chosenRooms.push(room);
        }
        if(!ok) continue;

        // Commit
        for(let k=0;k<L;k++){
          const tkSlot = timeslots[i+k];
          occupyLocal(occ, tkSlot.id, chosenRooms[k], subj.facultyId, subj.batch);
          localAssignments.push({batch: subj.batch, subjectId: subj.id, subject: subj.name, timeslotId: tkSlot.id, length:1, room: chosenRooms[k], facultyId: subj.facultyId});
        }
        occ.dayCount[subj.batch][day]++;

        if(tryPlaceTask(idx+1)) return true;

        // Undo
        for(let k=0;k<L;k++){
          const tkSlot = timeslots[i+k];
          releaseLocal(occ, tkSlot.id, chosenRooms[k], subj.facultyId, subj.batch);
          localAssignments.pop();
        }
        occ.dayCount[subj.batch][day]--;
      }
      return false;
    }

    function setAdd(map, key, value){
      if(!map.has(key)) map.set(key, new Set());
      map.get(key).add(value);
    }
    function setDel(map, key, value){
      if(!map.has(key)) return;
      const s = map.get(key); s.delete(value);
      if(s.size===0) map.delete(key);
    }
    function isRoomFreeLocal(occ, tsId, room){
      const s = occ.room.get(tsId); return !s || !s.has(room);
    }
    function isFacultyFreeLocal(occ, tsId, facultyId){
      const s = occ.faculty.get(tsId); return !s || !s.has(facultyId);
    }
    function isBatchFreeLocal(occ, tsId, batch){
      const s = occ.batch.get(tsId); return !s || !s.has(batch);
    }
    function findRoomLocal(occ, roomType, tsId){
      const list = roomsByType[roomType] || [];
      for(const r of list){
        if(isRoomFreeLocal(occ, tsId, r)) return r;
      }
      return null;
    }
    function occupyLocal(occ, tsId, room, facultyId, batch){
      setAdd(occ.room, tsId, room);
      setAdd(occ.faculty, tsId, facultyId);
      setAdd(occ.batch, tsId, batch);
    }
    function releaseLocal(occ, tsId, room, facultyId, batch){
      setDel(occ.room, tsId, room);
      setDel(occ.faculty, tsId, facultyId);
      setDel(occ.batch, tsId, batch);
    }

    const ok = tryPlaceTask(0);
    if(ok){
      // Build lookup structures
      const byBatch = {};
      for(const b of state.batches) byBatch[b] = [];
      for(const a of localAssignments){
        if(a.batch==="_EVENT_") continue;
        byBatch[a.batch].push(a);
      }

      return { timeslots, byBatch, roomsByType };
    }
    return null;
  }

  while(attempts < maxAttempts){
    const sol = trySolve();
    if(sol) return sol;
  }
  return null;

  // Helpers
  function buildTimeslots(){
    const list = [];
    let idCounter = 0;
    for(const day of state.days){
      const start = t2m(state.startTime), end = t2m(state.endTime);
      const step = state.slotLength;
      const breaks = (state.breaks||[]).filter(b=>b.day===day).map(b => ({start: t2m(b.start), end: t2m(b.start) + b.durationMins}));
      for(let m=start; m+step<=end; m+=step){
        const slot = { id: "TS"+(++idCounter), day, start: m2t(m), end: m2t(m+step), startMin:m, endMin:m+step, isBreak:false, index: list.length };
        // mark as break if overlaps with any break interval
        slot.isBreak = breaks.some(b => !(slot.endMin<=b.start || slot.startMin>=b.end));
        list.push(slot);
      }
    }
    return list;
  }

  function findStartTimeslot(day, start, slots){
    const m = t2m(start);
    for(let i=0;i<slots.length;i++){
      if(slots[i].day===day && slots[i].startMin===m) return { index: i, id: slots[i].id };
    }
    return null;
  }
}

// ---------- Rendering Timetable ----------
function buildTimetableTable(solution, batch){
  const { timeslots, byBatch } = solution;
  const days = state.days.slice();
  const daySlots = Object.fromEntries(days.map(d=>[d, timeslots.filter(t=>t.day===d)]));
  const cellMap = {}; // key: day|start -> {subject, room, faculty}
  const items = byBatch[batch] || [];

  for(const it of items){
    const ts = timeslots.find(t=>t.id===it.timeslotId);
    const key = ts.day + "|" + ts.start;
    // Merge if same subject occupies consecutive slots (practicals)
    if(cellMap[key]){
      // if same subject and faculty and room, extend end time (only for back-to-back)
      const prev = cellMap[key];
      // no-op, because each slot has own key; instead, we will print one per slot
    }else{
      cellMap[key] = { subject: it.subject, room: it.room, faculty: (state.faculties.find(f=>f.id===it.facultyId)||{}).name || "", start: ts.start, end: ts.end };
    }
  }

  // Build HTML table
  const table = document.createElement("div");
  table.className = "timetable";
  const tbl = document.createElement("table");
  tbl.className = "table";
  table.appendChild(tbl);

  const header = document.createElement("thead");
  const hr = document.createElement("tr");
  hr.innerHTML = `<th class="timecol">Time</th>` + days.map(d=>`<th>${d}</th>`).join("");
  header.appendChild(hr);
  tbl.appendChild(header);

  const body = document.createElement("tbody");

  // rows for each unique time slot across day (assume uniform across days)
  const rowSlots = timeslots.filter(t=>t.day===days[0]);
  for(let r=0;r<rowSlots.length;r++){
    const row = document.createElement("tr");
    const refSlot = rowSlots[r];
    const timeCell = document.createElement("th");
    timeCell.className = "timecol";
    timeCell.textContent = `${refSlot.start}–${refSlot.end}` + (refSlot.isBreak? " (Break)": "");
    row.appendChild(timeCell);

    for(const d of days){
      const slot = (timeslots.find(t=>t.day===d && t.start===refSlot.start) || {isBreak:false});
      const cell = document.createElement("td");
      if(slot.isBreak){
        cell.innerHTML = `<div class="slot"><div class="s-name">— Break —</div></div>`;
        row.appendChild(cell); continue;
      }
      const key = d + "|" + refSlot.start;
      const itm = cellMap[key];
      if(itm){
        cell.innerHTML = `<div class="slot">
            <div class="s-name">${itm.subject}</div>
            <div class="s-meta">${itm.faculty || ""} • Room ${itm.room}</div>
          </div>`;
      }else{
        cell.innerHTML = `<div class="slot"><div class="s-name">Free</div></div>`;
      }
      row.appendChild(cell);
    }
    body.appendChild(row);
  }
  tbl.appendChild(body);
  return table;
}

// ---------- Init ----------
populateDaySelects();
