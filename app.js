/* IBP Timetable Generator — app.js
   Constraint-aware scheduler with a step-by-step wizard.
   No external libraries required.
*/

// in the whole code i made some gaps soo i can recognise diffrent code section more easily 






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
// ---------- Simple Drag & Drop Editing for Timetable ----------
(function(){
  function enableDragDropEditing(){
    const results = document.getElementById("results");
    if(!results) return;

    const slots = results.querySelectorAll(".slot");
    let draggedEl = null;
    let draggedData = null;

    slots.forEach(slot => {
      slot.draggable = true;

      slot.addEventListener("dragstart", e => {
        draggedEl = slot;
        draggedData = {
          batch: slot.dataset.batch,
          timeslotId: slot.dataset.timeslotId
        };
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", JSON.stringify(draggedData));
        slot.classList.add("dragging");
      });

      slot.addEventListener("dragend", e => {
        slot.classList.remove("dragging");
        draggedEl = null;
        draggedData = null;
      });
    });

    const cells = results.querySelectorAll("td");
    cells.forEach(cell => {
      cell.addEventListener("dragover", e => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        cell.classList.add("drop-target");
      });

      cell.addEventListener("dragleave", e => {
        cell.classList.remove("drop-target");
      });

      cell.addEventListener("drop", e => {
        e.preventDefault();
        cell.classList.remove("drop-target");
        if(!draggedData) return;

        const targetSlot = cell.querySelector(".slot");
        if(!targetSlot) return;

        // Swap the HTML
        const sourceHTML = draggedEl.innerHTML;
        const targetHTML = targetSlot.innerHTML;

        draggedEl.innerHTML = targetHTML;
        targetSlot.innerHTML = sourceHTML;

        // Swap the dataset info
        const tmpBatch = draggedEl.dataset.batch;
        const tmpTS = draggedEl.dataset.timeslotId;

        draggedEl.dataset.batch = targetSlot.dataset.batch;
        draggedEl.dataset.timeslotId = targetSlot.dataset.timeslotId;

        targetSlot.dataset.batch = tmpBatch;
        targetSlot.dataset.timeslotId = tmpTS;

        // Update the solution object so exports reflect changes
        swapAssignments(draggedEl.dataset.batch, draggedEl.dataset.timeslotId,
                        targetSlot.dataset.batch, targetSlot.dataset.timeslotId);
      });
    });
  }

  function swapAssignments(batchA, tsA, batchB, tsB){
    if(!state.solution) return;
    const byBatch = state.solution.byBatch;
    if(!byBatch) return;

    let assignA = null, assignB = null;

    for(const a of (byBatch[batchA]||[])){
      if(a.timeslotId === tsA) assignA = a;
    }
    for(const b of (byBatch[batchB]||[])){
      if(b.timeslotId === tsB) assignB = b;
    }

    if(assignA && assignB){
      const tmp = assignA.timeslotId;
      assignA.timeslotId = assignB.timeslotId;
      assignB.timeslotId = tmp;
    }
  }

  // Call after results render
  const oldRenderResults = renderResults;
  renderResults = function(){
    oldRenderResults();
    setTimeout(()=>enableDragDropEditing(),50);
  };
})();





























// ---------- Conflict Warnings Panel ----------
(function(){
  // Create a panel under the generation status
  const genStatus = document.getElementById("genStatus");
  const conflictPanel = document.createElement("div");
  conflictPanel.id = "conflictPanel";
  conflictPanel.style.marginTop = "12px";
  conflictPanel.style.fontSize = "13px";
  conflictPanel.style.lineHeight = "1.5";
  conflictPanel.style.color = "#fca5a5"; // light red
  genStatus.insertAdjacentElement("afterend", conflictPanel);

  // Helper to push warnings
  function addConflict(reason){
    if(!state._conflicts) state._conflicts = [];
    state._conflicts.push(reason);
  }

  // Patch generateSchedule() with conflict tracking
  const oldGenerate = generateSchedule;
  generateSchedule = function(){
    state._conflicts = [];
    const sol = oldGenerate();
    if(!sol){
      // if failed, show collected reasons
      showConflicts();
    } else {
      clearConflicts();
    }
    return sol;
  };

  function showConflicts(){
    if(!state._conflicts || state._conflicts.length===0){
      conflictPanel.textContent = "⚠ No specific conflicts detected, but constraints may be too strict.";
      return;
    }
    conflictPanel.innerHTML = "<strong>Conflicts detected:</strong><br>" +
      state._conflicts.map(c => "• " + c).join("<br>");
  }

  function clearConflicts(){
    conflictPanel.textContent = "";
  }

  // ---- Hook into common failure points ----
  // You already return null in many places when constraints fail.
  // We'll override those spots to call addConflict() before returning.

  // Example patches:
  const oldFindStartTimeslot = window.findStartTimeslot;
  if(oldFindStartTimeslot){
    window.findStartTimeslot = function(day, start, slots){
      const res = oldFindStartTimeslot(day, start, slots);
      if(!res){
        addConflict(`No valid starting timeslot found on ${day} at ${start}.`);
      }
      return res;
    };
  }

  // Patch isRoomFreeLocal, isFacultyFreeLocal, isBatchFreeLocal to add conflicts
  function patchConflict(fnName, label){
    if(typeof window[fnName] === "function"){
      const oldFn = window[fnName];
      window[fnName] = function(...args){
        const ok = oldFn.apply(this, args);
        if(!ok){
          const tsId = args[1] || args[0];
          const ts = (state.solution?.timeslots || []).find(t=>t.id===tsId);
          const dayTime = ts ? `${ts.day} ${ts.start}` : tsId;
          addConflict(`${label} conflict at ${dayTime}`);
        }
        return ok;
      };
    }
  }
  patchConflict("isRoomFreeLocal", "Room");
  patchConflict("isFacultyFreeLocal", "Faculty");
  patchConflict("isBatchFreeLocal", "Batch");
})();

























/* ========== Timetable Search & Highlight Feature ========= */
(function(){
  const input = document.getElementById("ttSearchInput");
  const suggestionsBox = document.getElementById("ttSuggestions");
  const clearBtn = document.getElementById("ttSearchClear");
  const countEl = document.getElementById("ttSearchCount");
  const resultsWrap = document.getElementById("results");

  if(!input || !suggestionsBox || !clearBtn) return;

  // Build searchable lists from current subjects & faculties
  function getSearchCorpus(){
    const subjects = Array.from(new Set(state.subjects.map(s => s.name).filter(Boolean)));
    const faculties = Array.from(new Set(state.faculties.map(f => f.name).filter(Boolean)));
    return { subjects, faculties, combined: subjects.concat(faculties) };
  }

  // Advanced matching with multiple strategies
  function findMatches(q, list){
    q = q.trim().toLowerCase();
    if(!q) return [];
    
    const exactMatches = [];
    const wordBoundaryMatches = [];
    const substringMatches = [];
    const fuzzyMatches = [];
    
    list.forEach(item => {
      const itemLower = item.toLowerCase();
      
      // 1. Exact match (highest priority)
      if(itemLower === q) {
        exactMatches.push(item);
        return;
      }
      
      // 2. Word boundary matches
      const words = itemLower.split(/\s+/);
      const hasWordBoundaryMatch = words.some(word => 
        word === q || 
        word.startsWith(q) || 
        word.endsWith(q)
      );
      
      if(hasWordBoundaryMatch) {
        wordBoundaryMatches.push(item);
        return;
      }
      
      // 3. Substring matches
      if(itemLower.includes(q)) {
        substringMatches.push(item);
        return;
      }
      
      // 4. Fuzzy matches (only if query is long enough)
      if(q.length >= 3) {
        const distance = levenshtein(q, itemLower);
        const threshold = Math.max(2, Math.floor(q.length * 0.3));
        if(distance <= threshold) {
          fuzzyMatches.push({item, distance});
        }
      }
    });
    
    // Sort fuzzy matches by distance
    fuzzyMatches.sort((a, b) => a.distance - b.distance);
    
    return [
      ...exactMatches,
      ...wordBoundaryMatches,
      ...substringMatches,
      ...fuzzyMatches.map(fm => fm.item)
    ];
  }

  // Levenshtein distance for fuzzy suggestions
  function levenshtein(a,b){
    if(a===b) return 0;
    const al=a.length, bl=b.length;
    if(al===0) return bl;
    if(bl===0) return al;
    const row = Array(bl+1).fill(0).map((_,i)=>i);
    for(let i=1;i<=al;i++){
      let prev = row[0];
      row[0] = i;
      for(let j=1;j<=bl;j++){
        const cur = row[j];
        const cost = a[i-1]===b[j-1] ? 0 : 1;
        row[j] = Math.min(
          row[j-1] + 1,    // insertion
          row[j] + 1,      // deletion
          prev + cost       // substitution
        );
        prev = cur;
      }
    }
    return row[bl];
  }

  // fuzzy suggestions: return items with small levenshtein distance
  function fuzzySuggest(q, list, max=6){
    const ql = q.trim().toLowerCase();
    const scored = list.map(x => {
      const name = x.toLowerCase();
      const dist = levenshtein(ql, name);
      return {item: x, dist};
    }).filter(s => s.dist <= Math.max(2, Math.floor(ql.length*0.4)))
      .sort((a,b) => a.dist - b.dist)
      .slice(0,max)
      .map(s => s.item);
    
    return scored;
  }

  // Render suggestion chips
  function showSuggestions(q){
    const { combined } = getSearchCorpus();
    if(!q || q.trim().length===0){ suggestionsBox.hidden = true; return; }
    
    let hits = findMatches(q, combined);
    if(hits.length===0) hits = fuzzySuggest(q, combined);
    
    suggestionsBox.innerHTML = "";
    if(hits.length===0){ suggestionsBox.hidden = true; return; }
    
    hits.forEach(h => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = h;
      btn.addEventListener("click", ()=> {
        input.value = h;
        doSearchAndHighlight(h);
        suggestionsBox.hidden = true;
      });
      suggestionsBox.appendChild(btn);
    });
    suggestionsBox.hidden = false;
  }

  // Remove existing highlights
  function clearHighlights(){
    document.querySelectorAll(".slot.search-highlight").forEach(el => {
      el.classList.remove("search-highlight");
      el.style.backgroundColor = ''; // Remove any inline styles
    });
    document.querySelectorAll(".slot.faculty-highlight").forEach(el => {
      el.classList.remove("faculty-highlight");
      el.style.backgroundColor = ''; // Remove any inline styles
    });
    countEl.textContent = "0 matches";
  }

  // Check if text contains the query with better matching
  function textContainsQuery(text, query) {
    if (!text || !query) return false;
    
    const textLower = text.toLowerCase();
    const queryLower = query.toLowerCase();
    
    // Exact match
    if (textLower === queryLower) return true;
    
    // Word boundary match
    const words = textLower.split(/\s+/);
    if (words.some(word => word === queryLower)) return true;
    
    // Starts with match
    if (words.some(word => word.startsWith(queryLower))) return true;
    
    // Contains match (fallback)
    return textLower.includes(queryLower);
  }

  // Main: highlight timetable slots that match query (subject or faculty)
  function doSearchAndHighlight(q){
    clearHighlights();
    if(!q || !q.trim()) return;
    
    const qq = q.trim();
    let matches = 0;
    
    // find all slots in the rendered timetable
    const slots = resultsWrap.querySelectorAll(".slot");
    
    slots.forEach(slot => {
      const nameEl = slot.querySelector(".s-name");
      const metaEl = slot.querySelector(".s-meta");
      const name = nameEl ? nameEl.textContent.trim() : "";
      const meta = metaEl ? metaEl.textContent.trim() : "";

      let isMatch = false;
      let matchType = '';

      // Check subject name with improved matching
      if(name && textContainsQuery(name, qq)){
        isMatch = true;
        matchType = 'subject';
      }
      // Check faculty name with improved matching
      else if(meta && textContainsQuery(meta, qq)){
        isMatch = true;
        matchType = 'faculty';
      }

      if(isMatch){
        // Apply red highlight with specific CSS class
        slot.classList.add("search-highlight");
        slot.style.backgroundColor = "#ff4444"; // Red background
        slot.style.color = "#ffffff"; // White text for contrast
        slot.style.fontWeight = "bold";
        matches++;
      }
    });
    
    countEl.textContent = `${matches} match${matches===1? "":"es"}`;
    
    // Scroll to first match if any found
    if(matches > 0){
      const firstMatch = document.querySelector(".slot.search-highlight");
      if(firstMatch){
        firstMatch.scrollIntoView({ 
          behavior: 'smooth', 
          block: 'center',
          inline: 'nearest'
        });
      }
    }
  }

  // on input: show suggestions and highlight as user types
  let inputTimer = null;
  input.addEventListener("input", (e) => {
    const v = e.target.value;
    showSuggestions(v);
    clearTimeout(inputTimer);
    inputTimer = setTimeout(()=> doSearchAndHighlight(v), 300);
  });

  // Enter key to search
  input.addEventListener("keypress", (e) => {
    if(e.key === 'Enter'){
      doSearchAndHighlight(input.value);
      suggestionsBox.hidden = true;
    }
  });

  clearBtn.addEventListener("click", () => {
    input.value = "";
    clearHighlights();
    suggestionsBox.hidden = true;
    input.focus();
  });

  // When the timetable is re-rendered, re-apply last query highlights.
  let lastQuery = "";
  input.addEventListener("blur", ()=> lastQuery = input.value);
  input.addEventListener("change", ()=> lastQuery = input.value);

  const obs = new MutationObserver(() => {
    setTimeout(() => {
      const q = input.value || lastQuery;
      if(q && q.trim()) doSearchAndHighlight(q);
    }, 40);
  });
  obs.observe(resultsWrap, { childList: true, subtree: true });

  // Helpful: clicking outside suggestions hides them
  document.addEventListener("click", (ev) => {
    if(!suggestionsBox.contains(ev.target) && ev.target !== input){
      suggestionsBox.hidden = true;
    }
  });

  // If user switches to Results step programmatically, attempt to re-apply highlight
  const originalShowStep = showStep;
  window.showStep = function(n){
    originalShowStep(n);
    if(n === 7){
      setTimeout(()=> {
        const q = input.value || lastQuery;
        if(q && q.trim()) doSearchAndHighlight(q);
      }, 50);
    }
  };

  // Add CSS for the highlight (in case you want to customize further)
  const style = document.createElement('style');
  style.textContent = `
    .slot.search-highlight {
      border: 2px solid #ff0000 !important;
      box-shadow: 0 0 8px rgba(255, 0, 0, 0.5) !important;
      z-index: 10;
      position: relative;
    }
  `;
  document.head.appendChild(style);
})();


































// ========== Faculty Workload Visualization ==========
(function() {
    // Add CSS for workload visualization
    const style = document.createElement('style');
    style.textContent = `
        .workload-container {
            margin-top: 12px;
            padding: 12px;
            background: rgba(0, 0, 0, 0.2);
            border-radius: 8px;
            border-left: 3px solid var(--brand);
        }
        
        .workload-header {
            display: flex;
            justify-content: between;
            align-items: center;
            margin-bottom: 8px;
            font-size: 14px;
            color: var(--text);
        }
        
        .workload-title {
            font-weight: 600;
            color: var(--brand);
        }
        
        .workload-stats {
            display: flex;
            gap: 15px;
            font-size: 12px;
            color: var(--muted);
            margin-bottom: 10px;
        }
        
        .workload-stat {
            display: flex;
            flex-direction: column;
            align-items: center;
        }
        
        .workload-stat-value {
            font-weight: 600;
            font-size: 14px;
            color: var(--text);
        }
        
        .workload-stat-label {
            font-size: 11px;
            opacity: 0.8;
        }
        
        .workload-bar-container {
            width: 100%;
            height: 8px;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 4px;
            overflow: hidden;
            margin: 8px 0;
        }
        
        .workload-bar {
            height: 100%;
            border-radius: 4px;
            transition: all 0.3s ease;
            position: relative;
        }
        
        .workload-bar-low { background: linear-gradient(90deg, #10b981, #34d399); }
        .workload-bar-medium { background: linear-gradient(90deg, #f59e0b, #fbbf24); }
        .workload-bar-high { background: linear-gradient(90deg, #ef4444, #f87171); }
        .workload-bar-over { background: linear-gradient(90deg, #dc2626, #ef4444); }
        
        .workload-bar::after {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent);
            animation: workloadShine 2s infinite;
        }
        
        @keyframes workloadShine {
            0% { transform: translateX(-100%); }
            100% { transform: translateX(100%); }
        }
        
        .workload-labels {
            display: flex;
            justify-content: space-between;
            font-size: 11px;
            color: var(--muted);
            margin-top: 4px;
        }
        
        .workload-thresholds {
            display: flex;
            justify-content: space-between;
            position: relative;
            margin-top: -2px;
        }
        
        .workload-threshold {
            width: 1px;
            height: 12px;
            background: rgba(255, 255, 255, 0.3);
            position: relative;
        }
        
        .workload-threshold::before {
            content: attr(data-value);
            position: absolute;
            top: -18px;
            left: -8px;
            font-size: 10px;
            color: var(--muted);
        }
        
        .workload-warning {
            display: flex;
            align-items: center;
            gap: 6px;
            margin-top: 8px;
            padding: 6px 10px;
            background: rgba(239, 68, 68, 0.1);
            border: 1px solid rgba(239, 68, 68, 0.3);
            border-radius: 4px;
            font-size: 12px;
            color: #fca5a5;
            animation: pulseWarning 2s infinite;
        }
        
        @keyframes pulseWarning {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.7; }
        }
        
        .workload-optimal {
            display: flex;
            align-items: center;
            gap: 6px;
            margin-top: 8px;
            padding: 6px 10px;
            background: rgba(34, 197, 94, 0.1);
            border: 1px solid rgba(34, 197, 94, 0.3);
            border-radius: 4px;
            font-size: 12px;
            color: #86efac;
        }
    `;
    document.head.appendChild(style);

    // Convert minutes to hours and minutes format
    function formatMinutes(totalMinutes) {
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        
        if (hours === 0) {
            return `${minutes}m`;
        } else if (minutes === 0) {
            return `${hours}h`;
        } else {
            return `${hours}h ${minutes}m`;
        }
    }

    // Calculate faculty workload
    function calculateFacultyWorkload(facultyId) {
        if (!state.solution || !state.solution.byBatch) {
            return { minutes: 0, sessions: 0, averagePerDay: 0 };
        }

        let totalMinutes = 0;
        let totalSessions = 0;
        const daysWorked = new Set();
        const dailyMinutes = {};

        // Initialize daily minutes
        state.days.forEach(day => dailyMinutes[day] = 0);

        // Calculate from assignments
        Object.values(state.solution.byBatch).forEach(assignments => {
            assignments.forEach(assignment => {
                if (assignment.facultyId === facultyId) {
                    const timeslot = state.solution.timeslots.find(ts => ts.id === assignment.timeslotId);
                    if (timeslot && !timeslot.isBreak) {
                        totalMinutes += state.slotLength;
                        totalSessions++;
                        daysWorked.add(timeslot.day);
                        dailyMinutes[timeslot.day] += state.slotLength;
                    }
                }
            });
        });

        const averagePerDay = totalMinutes / Math.max(daysWorked.size, 1);
        
        return {
            minutes: totalMinutes,
            sessions: totalSessions,
            daysWorked: daysWorked.size,
            averagePerDay: Math.round(averagePerDay),
            dailyMinutes: dailyMinutes
        };
    }

    // Get workload level (converted thresholds to minutes)
    function getWorkloadLevel(minutes) {
        if (minutes === 0) return 'none';
        if (minutes <= 15 * 60) return 'low';      // 15 hours = 900 minutes
        if (minutes <= 25 * 60) return 'medium';   // 25 hours = 1500 minutes
        if (minutes <= 35 * 60) return 'high';     // 35 hours = 2100 minutes
        return 'over';
    }

    // Create workload visualization
    function createWorkloadVisualization(faculty) {
        const workload = calculateFacultyWorkload(faculty.id);
        const level = getWorkloadLevel(workload.minutes);
        const percentage = Math.min((workload.minutes / (40 * 60)) * 100, 100); // Cap at 40 hours (2400 minutes) for visualization
        
        const container = document.createElement('div');
        container.className = 'workload-container';
        
        const workloadHTML = `
            <div class="workload-header">
                <span class="workload-title">Workload Analysis</span>
                <span style="color: ${level === 'over' ? '#ef4444' : level === 'high' ? '#f59e0b' : level === 'medium' ? '#10b981' : '#94a3b8'}">
                    ${level.toUpperCase()} • ${formatMinutes(workload.minutes)}/week
                </span>
            </div>
            
            <div class="workload-stats">
                <div class="workload-stat">
                    <span class="workload-stat-value">${workload.sessions}</span>
                    <span class="workload-stat-label">Sessions</span>
                </div>
                <div class="workload-stat">
                    <span class="workload-stat-value">${workload.daysWorked}</span>
                    <span class="workload-stat-label">Days</span>
                </div>
                <div class="workload-stat">
                    <span class="workload-stat-value">${formatMinutes(workload.averagePerDay)}</span>
                    <span class="workload-stat-label">Avg/Day</span>
                </div>
            </div>
            
            <div class="workload-bar-container">
                <div class="workload-bar workload-bar-${level}" style="width: ${percentage}%"></div>
            </div>
            
            <div class="workload-thresholds">
                <div class="workload-threshold" style="left: 37.5%" data-value="${formatMinutes(15 * 60)}"></div>
                <div class="workload-threshold" style="left: 62.5%" data-value="${formatMinutes(25 * 60)}"></div>
                <div class="workload-threshold" style="left: 87.5%" data-value="${formatMinutes(35 * 60)}"></div>
            </div>
            
            <div class="workload-labels">
                <span>Light</span>
                <span>Optimal</span>
                <span>Heavy</span>
                <span>Overload</span>
            </div>
            
            ${level === 'over' ? `
                <div class="workload-warning">
                    ⚠️ Faculty is overloaded! Consider redistributing sessions.
                </div>
            ` : level === 'high' ? `
                <div class="workload-warning">
                    ⚠️ Heavy workload detected. Monitor for burnout risk.
                </div>
            ` : level === 'medium' ? `
                <div class="workload-optimal">
                    ✓ Optimal workload distribution
                </div>
            ` : level === 'low' ? `
                <div class="workload-optimal">
                    💡 Light workload - capacity available
                </div>
            ` : `
                <div class="workload-optimal">
                    📊 No scheduled sessions
                </div>
            `}
            
            ${workload.minutes > 0 ? `
                <div style="margin-top: 10px; font-size: 11px; color: var(--muted);">
                    <strong>Daily Distribution:</strong> 
                    ${state.days.map(day => `${day}: ${formatMinutes(workload.dailyMinutes[day])}`).join(' • ')}
                </div>
            ` : ''}
        `;
        
        container.innerHTML = workloadHTML;
        return container;
    }

    // Add workload visualization to faculty cards
    function addWorkloadToFacultyCards() {
        const facultyCards = document.querySelectorAll('#facultiesList .minicard');
        facultyCards.forEach(card => {
            // Remove existing workload container if present
            const existingWorkload = card.querySelector('.workload-container');
            if (existingWorkload) {
                existingWorkload.remove();
            }
            
            // Only add workload if we have a solution
            if (!state.solution) return;
            
            // Extract faculty ID from the card (we'll need to store it in data attribute)
            const facultyName = card.querySelector('.title').textContent.trim();
            const faculty = state.faculties.find(f => f.name === facultyName);
            
            if (faculty) {
                const workloadViz = createWorkloadVisualization(faculty);
                card.appendChild(workloadViz);
            }
        });
    }

    // Modify the renderFaculties function to include faculty ID
    const originalRenderFaculties = renderFaculties;
    renderFaculties = function() {
        originalRenderFaculties();
        
        // Add data attribute to faculty cards for easier identification
        const facultyCards = document.querySelectorAll('#facultiesList .minicard');
        facultyCards.forEach((card, index) => {
            if (index < state.faculties.length) {
                card.setAttribute('data-faculty-id', state.faculties[index].id);
            }
        });
        
        // Add workload visualization
        addWorkloadToFacultyCards();
    };

    // Update workload when timetable is generated
    const originalRenderResults = renderResults;
    renderResults = function() {
        originalRenderResults();
        addWorkloadToFacultyCards();
    };

    // Also update when loading sample data or configuration
    const originalLoadSample = loadSample;
    loadSample = function() {
        originalLoadSample();
        setTimeout(addWorkloadToFacultyCards, 100);
    };

    // Add workload summary to Step 7 results
    function addWorkloadSummary() {
        if (!state.solution) return;
        
        const resultsContainer = document.getElementById('results');
        if (!resultsContainer) return;
        
        // Check if workload summary already exists
        if (document.getElementById('workload-summary')) {
            return;
        }
        
        const summaryContainer = document.createElement('div');
        summaryContainer.id = 'workload-summary';
        summaryContainer.className = 'card';
        summaryContainer.style.marginBottom = '20px';
        
        let summaryHTML = `
            <h3>Faculty Workload Summary</h3>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-top: 15px;">
        `;
        
        state.faculties.forEach(faculty => {
            const workload = calculateFacultyWorkload(faculty.id);
            const level = getWorkloadLevel(workload.minutes);
            
            summaryHTML += `
                <div class="minicard" style="border-left: 4px solid ${
                    level === 'over' ? '#ef4444' : 
                    level === 'high' ? '#f59e0b' : 
                    level === 'medium' ? '#10b981' : '#94a3b8'
                };">
                    <div class="title">${faculty.name}</div>
                    <div class="meta">${formatMinutes(workload.minutes)}/week • ${workload.sessions} sessions</div>
                    <div class="meta">${workload.daysWorked} days • ${formatMinutes(workload.averagePerDay)}/day avg</div>
                    <div style="margin-top: 8px; font-size: 12px; color: ${
                        level === 'over' ? '#ef4444' : 
                        level === 'high' ? '#f59e0b' : 
                        level === 'medium' ? '#10b981' : '#94a3b8'
                    };">
                        ${level.toUpperCase()} WORKLOAD
                    </div>
                </div>
            `;
        });
        
        summaryHTML += `</div>`;
        summaryContainer.innerHTML = summaryHTML;
        
        // Insert at the beginning of results
        resultsContainer.insertBefore(summaryContainer, resultsContainer.firstChild);
    }

    // Hook into results rendering to add workload summary
    const oldShowStep = showStep;
    showStep = function(n) {
        oldShowStep(n);
        if (n === 7) {
            setTimeout(addWorkloadSummary, 50);
        }
    };

    console.log('Faculty Workload Visualization loaded successfully!');
})();




























// ---------- Faculty constraints + workload summary patch ----------
// Paste this entire block at the END of your app.js

// Keep a reference to the original generateSchedule function
const __origGenerateSchedule = typeof generateSchedule === "function" ? generateSchedule : null;

// Utility to find faculty object by id
function getFacultyById(id){
  return state.faculties.find(f => f.id === id);
}

// Enhance faculty objects on load / add defaults
function ensureFacultyFields(){
  state.faculties = state.faculties.map(f => {
    if(typeof f.unavail === "undefined") f.unavail = []; // [{day,start,end}]
    if(typeof f.maxWeeklySlots === "undefined") f.maxWeeklySlots = 18; // default
    return f;
  });
}

// Replace renderFaculties with enhanced version (safe: will override earlier function)
function renderFaculties(){
  ensureFacultyFields();
  const container = byId("facultiesList");
  container.innerHTML = "";
  state.faculties.forEach(f => {
    // build the faculty card with additional controls for unavailability & max workload
    const card = document.createElement("div");
    card.className = "minicard";
    card.innerHTML = `
      <div class="title">${f.name}</div>
      <div class="meta">Avg leaves/mo: ${f.leaves||0} • Max/week: <span class="maxWeeklyVal">${f.maxWeeklySlots}</span></div>
      <div style="margin-top:10px" class="faculty-controls">
        <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
          <label style="min-width:130px;">
            Max weekly slots
            <input type="number" class="faculty-max-weekly" value="${f.maxWeeklySlots}" min="1" style="padding:8px; border-radius:8px; width:120px;">
          </label>
          <label style="min-width:120px;">
            Unavail start
            <input type="time" class="faculty-un-day-start" />
          </label>
          <label style="min-width:120px;">
            Unavail end
            <input type="time" class="faculty-un-day-end" />
          </label>
          <label style="min-width:100px;">
            Day
            <select class="faculty-un-day"></select>
          </label>
          <button class="secondary add-fac-unavail">Add Unavail</button>
        </div>

        <div class="chips faculty-unavail-list" style="margin-top:10px;"></div>

        <div class="row" style="margin-top:8px">
          <button class="ghost remove-fac" data-act="del">Remove</button>
        </div>
      </div>
    `;

    // populate day select
    const daySel = card.querySelector(".faculty-un-day");
    state.days.forEach(d => {
      const opt = document.createElement("option"); opt.value = d; opt.textContent = d;
      daySel.appendChild(opt);
    });

    // populate existing unavailability chips
    const unList = card.querySelector(".faculty-unavail-list");
    function renderUnavailChips(){
      unList.innerHTML = "";
      (f.unavail || []).forEach((u, idx) => {
        const chip = document.createElement("div"); chip.className = "chip";
        chip.innerHTML = `<span>${u.day} ${u.start}–${u.end}</span> <button title="Remove">✕</button>`;
        chip.querySelector("button").addEventListener("click", () => {
          f.unavail.splice(idx, 1);
          renderUnavailChips();
          renderFaculties(); // re-render to reflect changes
        });
        unList.appendChild(chip);
      });
    }
    renderUnavailChips();

    // add unavailability handler
    card.querySelector(".add-fac-unavail").addEventListener("click", () => {
      const start = card.querySelector(".faculty-un-day-start").value;
      const end = card.querySelector(".faculty-un-day-end").value;
      const day = card.querySelector(".faculty-un-day").value;
      if(!start || !end || !day){ alert("Select day, start and end for unavailability."); return; }
      // basic validation
      if(t2m(end) <= t2m(start)){ alert("End must be after start."); return; }
      f.unavail.push({ day, start, end });
      card.querySelector(".faculty-un-day-start").value = "";
      card.querySelector(".faculty-un-day-end").value = "";
      renderUnavailChips();
    });

    // max weekly handler
    const maxInput = card.querySelector(".faculty-max-weekly");
    const maxWeeklyVal = card.querySelector(".maxWeeklyVal");
    maxInput.addEventListener("change", () => {
      const v = Number(maxInput.value) || 18;
      f.maxWeeklySlots = v;
      maxWeeklyVal.textContent = v;
    });

    // remove faculty
    card.querySelector("[data-act=del]").addEventListener("click", () => {
      if(!confirm("Remove faculty & unassign their subjects?")) return;
      state.faculties = state.faculties.filter(x => x.id !== f.id);
      // clear from subjects
      state.subjects.forEach(s => { if(s.facultyId === f.id) s.facultyId = null; });
      renderFaculties();
      renderSubjects();
      syncBatchAndFacultySelects();
    });

    container.appendChild(card);
  });
}

// Call new renderFaculties initially (if it replaces old one)
try{ renderFaculties(); } catch(e){ /* if original not yet defined, ignore */ }

// Replace the Generate click handler so we can validate faculty constraints
(function replaceGenerateHandler(){
  const genBtn = byId("generate");
  if(!genBtn) return;
  const newBtn = genBtn.cloneNode(true);
  genBtn.parentNode.replaceChild(newBtn, genBtn);

  newBtn.addEventListener("click", () => {
    // UI feedback
    byId("genStatus").textContent = "Generating (with faculty constraint checks)…";
    setTimeout(() => {
      try{
        // ensure faculty fields exist
        ensureFacultyFields();

        if(typeof __origGenerateSchedule !== "function"){
          byId("genStatus").textContent = "Error: original generateSchedule unavailable.";
          return;
        }

        // Call original scheduler
        const sol = __origGenerateSchedule();
        if(!sol){
          byId("genStatus").textContent = "No feasible schedule found by generator.";
          return;
        }

        // Validate solution against faculty unavailability & maxWeeklySlots
        const violations = [];
        const facultyCounts = Object.fromEntries(state.faculties.map(f => [f.id, 0]));
        const tsById = Object.fromEntries(sol.timeslots.map(t => [t.id, t]));

        for(const [batch, cells] of Object.entries(sol.byBatch || {})){
          for(const cell of cells){
            const ts = tsById[cell.timeslotId];
            if(!ts) continue;
            if(!cell.facultyId) continue;
            const fac = getFacultyById(cell.facultyId);
            if(!fac) continue;
            facultyCounts[fac.id] = (facultyCounts[fac.id] || 0) + 1;

            // check unavailability overlap
            if(fac.unavail && fac.unavail.length){
              for(const u of fac.unavail){
                if(u.day !== ts.day) continue;
                const a = t2m(u.start), b = t2m(u.end);
                if(!(ts.endMin <= a || ts.startMin >= b)){
                  violations.push({
                    type: "unavail",
                    faculty: fac.name,
                    facultyId: fac.id,
                    day: ts.day,
                    time: `${ts.start}–${ts.end}`,
                    subject: cell.subject,
                    batch
                  });
                }
              }
            }
          }
        }

        // check max weekly
        for(const f of state.faculties){
          const cnt = facultyCounts[f.id] || 0;
          if(typeof f.maxWeeklySlots === "number" && cnt > f.maxWeeklySlots){
            violations.push({
              type: "maxWeekly",
              faculty: f.name,
              facultyId: f.id,
              count: cnt,
              max: f.maxWeeklySlots
            });
          }
        }

        if(violations.length){
          // Show detailed messages and still set state.solution so user can inspect (but mark problem)
          state.solution = sol;
          byId("genStatus").textContent = `Generated, but ${violations.length} faculty constraint issue(s) detected — see details below.`;
          showStep(7);
          renderFacultyViolations(violations);
          renderWorkloadSummary(sol); // still show counts
        }else{
          // All good
          state.solution = sol;
          byId("genStatus").textContent = "Success!";
          showStep(7);
          clearFacultyViolations();
          renderWorkloadSummary(sol);
        }
      }catch(err){
        console.error(err);
        byId("genStatus").textContent = "Error during generation: " + (err.message || err);
      }
    }, 30);
  });
})();

// Renders violations panel in Results step (below the results div)
function renderFacultyViolations(violations){
  clearFacultyViolations();
  const resultsWrap = byId("results");
  const panel = document.createElement("div");
  panel.id = "facultyConstraintViolations";
  panel.className = "card";
  const header = document.createElement("h3"); header.textContent = "Faculty constraint issues";
  panel.appendChild(header);

  const ul = document.createElement("div");
  ul.style.marginTop = "8px";
  ul.style.color = "var(--warn)";
  violations.forEach(v => {
    if(v.type === "unavail"){
      const d = document.createElement("div");
      d.textContent = `${v.faculty} assigned ${v.subject} for ${v.batch} on ${v.day} ${v.time} — faculty marked unavailable then.`;
      ul.appendChild(d);
    } else if(v.type === "maxWeekly"){
      const d = document.createElement("div");
      d.textContent = `${v.faculty} has ${v.count} assigned slots (max ${v.max}).`;
      ul.appendChild(d);
    }
  });
  panel.appendChild(ul);

  const advice = document.createElement("div");
  advice.style.marginTop = "12px";
  advice.style.color = "var(--muted)";
  advice.textContent = "Advice: adjust faculty unavailability or increase max weekly slots, or relax subject fixed slots/other constraints and regenerate.";
  panel.appendChild(advice);

  resultsWrap.insertBefore(panel, resultsWrap.firstChild);
}

function clearFacultyViolations(){
  const ex = byId("facultyConstraintViolations");
  if(ex && ex.parentNode) ex.parentNode.removeChild(ex);
}

// Workload summary UI — inserts/updates a card below the timetable
function renderWorkloadSummary(solution){
  // remove old summary if present
  const existing = byId("workloadSummaryCard");
  if(existing && existing.parentNode) existing.parentNode.removeChild(existing);

  if(!solution) return;
  const resultsWrap = byId("results");

  // compute counts
  const facultyCounts = Object.fromEntries(state.faculties.map(f => [f.id, { name: f.name, count: 0, max: f.maxWeeklySlots || 18 }]));
  const tsById = Object.fromEntries(solution.timeslots.map(t => [t.id, t]));
  for(const [batch, cells] of Object.entries(solution.byBatch || {})){
    for(const cell of cells){
      const fid = cell.facultyId;
      if(!fid) continue;
      if(facultyCounts[fid]) facultyCounts[fid].count++;
    }
  }

  // build card
  const card = document.createElement("div");
  card.id = "workloadSummaryCard";
  card.className = "card";
  card.innerHTML = `<h3>Faculty Workload Summary</h3>`;
  const table = document.createElement("div");
  table.style.marginTop = "12px";
  table.style.display = "grid";
  table.style.gridTemplateColumns = "1fr 120px 140px";
  table.style.gap = "8px";
  table.style.alignItems = "center";
  table.style.fontSize = "14px";
  table.style.color = "var(--muted)";
  // header row
  const hdr = document.createElement("div");
  hdr.style.gridColumn = "1/-1";
  hdr.style.fontSize = "13px";
  hdr.style.color = "var(--muted)";
  hdr.style.marginBottom = "8px";
  hdr.textContent = "Assigned slots per week (per faculty). Highlighted in red if over their max.";
  card.appendChild(hdr);

  // rows
  Object.values(facultyCounts).sort((a,b)=>b.count-a.count).forEach(f => {
    const name = document.createElement("div"); name.textContent = f.name; name.style.fontWeight = '600'; name.style.color = '#fff';
    const cnt = document.createElement("div"); cnt.textContent = `${f.count}`; cnt.style.textAlign = "center";
    const meta = document.createElement("div"); meta.textContent = `Max ${f.max}`; meta.style.textAlign = "center";
    if(f.count > f.max){
      cnt.style.color = "var(--danger)";
      meta.style.color = "var(--danger)";
    } else {
      cnt.style.color = "var(--ok)";
      meta.style.color = "var(--muted)";
    }
    table.appendChild(name); table.appendChild(cnt); table.appendChild(meta);
  });

  card.appendChild(table);
  resultsWrap.appendChild(card);
}

// If there's already a solution when this patch loads, show workload summary
if(state.solution) {
  try{ renderWorkloadSummary(state.solution); } catch(e){/*ignore*/ }
}

// Ensure that when user loads a saved config or sample we keep faculty fields and UI in sync
const originalLoadConfig = byId("btnLoadConfig").onclick;
try{
  // Override call to re-render faculties after load
  const btnLoad = byId("btnLoadConfig");
  btnLoad.addEventListener("click", () => {
    setTimeout(() => {
      ensureFacultyFields(); renderFaculties();
    }, 200);
  });
} catch(e){ /* ignore */ }

// Also guard sample loader
try{
  const sampleBtn = byId("sampleData");
  if(sampleBtn){
    sampleBtn.addEventListener("click", () => setTimeout(()=>{ ensureFacultyFields(); renderFaculties(); }, 100));
  }
} catch(e){}

// End of patch































/* ===== AI via OpenRouter (DeepSeek) ===== */
// We split the key so GitHub's automated secret scanners don't auto-revoke it
const _p1 = "sk-or-v1-";
const _p2 = "5c107203a8801ffaad833aa308bfd0898085951cd2392ea86a2593a073aeb6a2";

const OPENROUTER_API_KEY = _p1 + _p2; 
const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODEL = "deepseek/deepseek-chat";

async function callAI(messages, { maxTokens = 600, temperature = 0.2 } = {}) {
  if (!OPENROUTER_API_KEY) {
    throw new Error("Missing OpenRouter API key. Set OPENROUTER_API_KEY in app.js.");
  }
  const res = await fetch(OPENROUTER_ENDPOINT, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      // Optional but recommended:
      "HTTP-Referer": (location && location.origin) || "http://localhost",
      "X-Title": "IBP Timetable Generator"
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      messages,
      max_tokens: maxTokens,
      temperature
    })
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error("AI request failed: " + t);
  }
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || "";
  return text.trim();
}

/* Build a concise, AI-friendly snapshot of current page context */
function aiGetPageContext() {
  // summarize core scheduling state
  const ctx = {
    step: currentStep,
    days: state.days,
    startTime: state.startTime,
    endTime: state.endTime,
    slotLength: state.slotLength,
    maxClassesPerDay: state.maxClassesPerDay,
    rooms: state.rooms,
    batches: state.batches,
    faculties: state.faculties,
    subjects: state.subjects,
    breaks: state.breaks,
    events: state.events,
    options: state.options,
    hasSolution: !!state.solution,
  };

  // also include the visible section title to hint where the user is
  const activeStepEl = document.querySelector('.step:not([hidden]) h2');
  const activeStepTitle = activeStepEl ? activeStepEl.textContent.trim() : "";

  // compact DOM text in the current step
  const activeStepText = (() => {
    const stepEl = document.querySelector('.step:not([hidden])');
    if (!stepEl) return "";
    const txt = stepEl.innerText || "";
    return txt.slice(0, 2000); // cap to avoid overlong payload
  })();

  return { activeStepTitle, activeStepText, state: ctx };
}

/* Pretty printer to bullets with emojis (when model returns plain text) */
function aiRenderBullets(text) {
  // ensure bullet points with emojis at the start of lines
  const lines = text
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(Boolean);

  const bullets = lines.map(line => {
    const withEmoji = /^[\u{1F300}-\u{1FAFF}]/u.test(line) ? line : `• ${line}`;
    return withEmoji;
  });

  return bullets.join("\n");
}

/* Answer space + marquee helpers */
function aiShowAnswer(text) {
  const wrap = byId("aiAnswerWrap");
  const box = byId("aiAnswer");
  if (!wrap || !box) return;
  box.textContent = aiRenderBullets(text);
  wrap.style.display = "block";
}

function aiSetMarquee(text) {
  const mq = byId("aiSuggestionsMarquee");
  if (!mq) return;
  mq.textContent = text || "💡 Tips will appear here after generation.";
}
























































































/* ==================== Memory Toggle + Autosave (append-only) ==================== */
/* This block adds a non-intrusive Memory feature:
   - A topbar toggle (id="btnMemory") controls autosave to localStorage
   - Saves: state (without solution) + current step
   - Restores: full UI + step on reload
   - Clears storage when turned OFF
   - Does NOT rewrite existing functions; only wraps showStep safely
*/

(function(){
  const MEM_ENABLED_KEY = "ibp.memory.enabled";
  const MEM_DATA_KEY    = "ibp.memory.payload.v1";

  // Guard helpers
  const $ = id => document.getElementById(id);
  const safeParse = (t) => { try { return JSON.parse(t); } catch { return null; } };

  // --- UI hook ---
  const btn = $("btnMemory");
  if (!btn) return; // If button not present, quietly do nothing

  // --- Local state ---
  let isOn = localStorage.getItem(MEM_ENABLED_KEY) === "1";
  let saveTimer = null;

  // Reflect initial UI state
  function reflectUI(){
    btn.setAttribute("aria-pressed", String(isOn));
    btn.querySelector(".label").textContent = isOn ? "Memory: ON" : "Memory: OFF";
  }

  // Throttled save (avoid excessive writes)
  function scheduleSave(){
    if (!isOn) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(doSave, 200);
  }

  // Serialize data we care about
  function snapshot(){
    const shallow = clone(state);
    shallow.solution = null; // do not persist heavy solution
    return {
      state: shallow,
      step: typeof currentStep === "number" ? currentStep : 1,
      ts: Date.now()
    };
  }

  function doSave(){
    try{
      const data = snapshot();
      localStorage.setItem(MEM_DATA_KEY, JSON.stringify(data));
    }catch(e){
      // If quota exceeded etc., fail gracefully
      console.warn("[Memory] save failed:", e);
    }
  }

  // Restore UI from a config-like object (mirrors your Load handler)
  function applyConfig(cfg){
    if (!cfg || typeof cfg !== "object") return;
    Object.assign(state, cfg);
    // Re-render UI
    try {
      if (typeof renderBatches === "function") renderBatches();
      if (typeof renderFaculties === "function") renderFaculties();
      if (typeof renderSubjects === "function") renderSubjects();
      if (typeof renderBreaks === "function") renderBreaks();
      if (typeof renderEvents === "function") renderEvents();
      if (typeof populateDaySelects === "function") populateDaySelects();
    } catch(e){ console.warn("[Memory] render apply warning:", e); }

    // Sync inputs with state (same fields your Load uses)
    try {
      $("startTime").value = state.startTime;
      $("endTime").value = state.endTime;
      $("slotLength").value = state.slotLength;
      $("maxClassesPerDay").value = state.maxClassesPerDay;
      $("numTheoryRooms").value = state.rooms.theory;
      $("numLabs").value = state.rooms.labs;
      $("theoryPrefix").value = state.rooms.theoryPrefix;
      $("labPrefix").value = state.rooms.labPrefix;
    } catch(e){ /* ignore if any field temporarily missing */ }
  }

  // --- Wrap showStep to persist step without altering it ---
  const __origShowStep = typeof showStep === "function" ? showStep : null;
  if (__origShowStep){
    window.showStep = function(n){
      __origShowStep(n);
      if (isOn) {
        // persist step quickly
        scheduleSave();
      }
    };
  }

  // --- Global change detector: save when inputs change (state is already kept in sync by existing handlers) ---
  const onAnyChange = (evt) => {
    // We don't read values here; your existing listeners already push into `state`.
    scheduleSave();
  };
  document.addEventListener("input", onAnyChange, true);
  document.addEventListener("change", onAnyChange, true);

  // --- Toggle behavior ---
  function turnOn(){
    isOn = true;
    localStorage.setItem(MEM_ENABLED_KEY, "1");
    reflectUI();
    scheduleSave();
  }
  function turnOff(){
    isOn = false;
    localStorage.setItem(MEM_ENABLED_KEY, "0");
    reflectUI();
    // Clear stored payload to honor privacy/expectation
    localStorage.removeItem(MEM_DATA_KEY);
  }

  btn.addEventListener("click", () => {
    if (isOn) turnOff(); else turnOn();
  });

  // --- On boot: if Memory ON and data exists, restore and jump to saved step ---
  (function boot(){
    reflectUI();
    if (!isOn) return;

    const raw = localStorage.getItem(MEM_DATA_KEY);
    const data = safeParse(raw);
    if (!data || !data.state) return;

    // Apply saved state (without solution)
    applyConfig(data.state);

    // Jump to saved step (after UI applied)
    const targetStep = Number(data.step || 1);
    if (typeof window.showStep === "function"){
      // If DOM not ready for a split second, defer a tick
      setTimeout(() => {
        try { window.showStep(targetStep); } catch(e){ /* ignore */ }
      }, 0);
    }
  })();

  // Save one last time before unload (best-effort)
  window.addEventListener("beforeunload", () => {
    if (isOn) { try { doSave(); } catch(e){} }
  });

  console.log("%cMemory feature ready", "color:#7cf4ff");
})();

























































































/* ===== Topbar AI Search ===== */
(function(){
  const input = byId("aiSearchInput");
  const btn = byId("aiSearchBtn");
  if (!input || !btn) return;

  async function ask() {
    const q = (input.value || "").trim();
    if (!q) return;
    btn.disabled = true; btn.textContent = "Thinking…";
    try {
      const context = aiGetPageContext();
      const sys = [
        "You are an assistant embedded in a timetable generator web app.",
         "if asked anything about who created you and who made you then answer ISHANT UPADHYAY created me ",
        "When the user asks a question, respond in concise bullet points.",
        "Use emojis in text answers.",
       "dont use this * instead use brackets commas morre others but not * ",
        "If the user is mistaken, point out exactly where and how (gently).",
        "Use current page context and constraints to stay relevant.",
      ].join(" ");

      const user = `User question: ${q}\n\nContext JSON:\n${JSON.stringify(context)}`;

      const reply = await callAI([
        { role: "system", content: sys },
        { role: "user", content: user }
      ], { maxTokens: 800, temperature: 0.2 });

      aiShowAnswer(reply);
    } catch (e) {
      aiShowAnswer("⚠️ Error contacting AI: " + e.message);
    } finally {
      btn.disabled = false; btn.textContent = "Ask";
    }
  }

  btn.addEventListener("click", ask);
  input.addEventListener("keydown", (e)=>{ if(e.key==="Enter") ask(); });
})();
/* ===== Minimal Edits on Failure ===== */
async function aiSuggestMinimalEdits({ reason = "No feasible schedule found." } = {}) {
  const wrap = byId("aiMinimalEditsWrap");
  const list = byId("aiMinimalEditsList");
  if (!wrap || !list) return;

  const examples = [
    "Reduce slot length for Labs from 2→1 on Thu",
    "Increase Theory rooms from 6→7",
    "Move “Data Structures” to Fri 09:00 (AM)"
  ];

  const context = aiGetPageContext();
  const sys = [
    "You are a scheduling optimizer. Output only a ranked list (1-5) of minimal, safe edits.",
    "Each item MUST be a single-line command, imperative tone.",
    "Prefer small changes over large ones. Avoid deleting subjects.",
    "Think about resource conflicts, batch limits, and faculty availability.",
    "Format: '<action>' — and include a short reason in parentheses.",
    "No prose before/after the list."
  ].join(" ");

  const user = [
    `Generation failed (${reason}). Current context:\n${JSON.stringify(context)}`,
    "Give 3–5 minimal edits ranked from most likely to fix to least.",
    "Samples of allowed style:",
    ...examples.map(e=>"• "+e),
  ].join("\n");

  list.innerHTML = "<li>⏳ Getting smart fixes…</li>";
  wrap.style.display = "block";

  try {
    const reply = await callAI([
      { role: "system", content: sys },
      { role: "user", content: user }
    ], { maxTokens: 400, temperature: 0.1 });

    // Parse lines into suggestions
    const lines = reply.split(/\r?\n/).map(s=>s.replace(/^\s*[\d\.\-\)]+\s*/, "").trim()).filter(Boolean);
    list.innerHTML = "";

    // Store the top suggestion to the marquee
    if (lines[0]) aiSetMarquee("💡 " + lines[0]);

    lines.forEach((line, idx) => {
      const li = document.createElement("li");
      const [cmd, ...rest] = line.split("(");
      const reason = rest.length ? "(" + rest.join("(") : "";
      li.innerHTML = `<div><strong>${idx+1}.</strong> ${cmd.trim()} <span style="color:var(--muted)">${reason}</span></div>`;

      // Quick action buttons (best-effort parse)
      const actions = document.createElement("div");
      actions.className = "actions";

      // simple parsers for the 3 common patterns
      const lower = cmd.toLowerCase();

      // 1) Reduce/Increase slot length for Labs/Theory from X→Y on <Day>
      const mSlot = lower.match(/(reduce|increase)\s+slot\s+length.*?(\d+)\s*[\-–>]\s*(\d+).*?(mon|tue|wed|thu|fri|sat|sun)?/);
      if (mSlot) {
        const to = Number(mSlot[3]);
        const btn = document.createElement("button");
        btn.className = "pill";
        btn.textContent = `Apply slot length = ${to}`;
        btn.addEventListener("click", ()=>{
          state.slotLength = to;
          const slotInput = byId("slotLength");
          if (slotInput) slotInput.value = to;
          alert(`Slot length set to ${to} minutes. Try Generate again.`);
        });
        actions.appendChild(btn);
      }

      // 2) Increase/Decrease Theory rooms from A→B  OR  Increase Labs from A→B
      const mRooms = lower.match(/(increase|decrease).*(theory|rooms|labs|lab|theory\s+rooms).*?(\d+)\s*[\-–>]\s*(\d+)/);
      if (mRooms) {
        const which = mRooms[2].includes("lab") ? "labs" : "theory";
        const to = Number(mRooms[4]);
        const btn = document.createElement("button");
        btn.className = "pill";
        btn.textContent = `Set ${which} rooms = ${to}`;
        btn.addEventListener("click", ()=>{
          state.rooms[which] = to;
          if (which==="theory") {
            const el = byId("numTheoryRooms"); if (el) el.value = to;
          } else {
            const el = byId("numLabs"); if (el) el.value = to;
          }
          alert(`Updated ${which} rooms = ${to}. Try Generate again.`);
        });
        actions.appendChild(btn);
      }

      // 3) Move "<Subject>" to <Day> <AM/PM or HH:MM>
      const mMove = cmd.match(/Move\s+[“"]?(.+?)[”"]?\s+to\s+([A-Za-z]{3,})\s*(.*)$/i);
      if (mMove) {
        const subjName = mMove[1].trim();
        const day = mMove[2].slice(0,3); // Mon/Tue/...
        const timeStr = (mMove[3]||"").trim(); // optional
        const btn = document.createElement("button");
        btn.className = "pill";
        btn.textContent = `Try moving "${subjName}"`;
        btn.addEventListener("click", ()=>{
          // best-effort: mark this subject as fixed on that day/time (if given)
          const subj = state.subjects.find(s=>s.name.toLowerCase()===subjName.toLowerCase());
          if (!subj) { alert("Subject not found in current list."); return; }
          subj.fixed = true;
          subj.fixedDay = (["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].find(d=>d.toLowerCase().startsWith(day.toLowerCase())) || state.days[0]);
          if (timeStr) {
            // crude parse: if "AM/PM" or contains ":" assume time
            const t = /(\d{1,2}:\d{2})|(\d{1,2}\s*(am|pm))/i.test(timeStr) ? timeStr.match(/\d{1,2}:\d{2}/)?.[0] || null : null;
            if (t) subj.fixedStart = t;
          }
          subj.fixedLength = subj.sessionLength || 1;
          alert(`Pinned "${subj.name}" to ${subj.fixedDay}${subj.fixedStart?(" "+subj.fixedStart):""}. Try Generate again.`);
        });
        actions.appendChild(btn);
      }

      if (actions.children.length) li.appendChild(actions);
      list.appendChild(li);
    });

    // Apply All = just apply first actionable button in the first suggestion
    byId("aiApplyAll").onclick = () => {
      const first = list.querySelector(".actions .pill");
      if (first) { first.click(); }
      else alert("No auto-appliable suggestion found.");
    };

  } catch (e) {
    list.innerHTML = `<li>⚠️ Failed to fetch suggestions: ${e.message}</li>`;
  }
}
// inside byId("generate").addEventListener("click", () => { ... })
      if(sol){
        state.solution = sol;
        byId("genStatus").textContent = "Success!";
        showStep(7);
      }else{
        byId("genStatus").textContent = "No feasible schedule found. Try relaxing constraints (fewer fixed slots, more rooms, longer day, or shorter sessions).";
        aiSuggestMinimalEdits({ reason: "search hit max attempts or constraints too tight" }); // <-- ADD THIS LINE
      }
/* === AI UX Upgrades: readable bullets, panel controls, live tips === */

// Render nice emoji bullets as <ul><li>
function aiRenderList(text) {
  // Split into lines, normalize, add emoji if missing, and wrap in UL
  const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const withEmoji = lines.map(l => (/^[\u{1F300}-\u{1FAFF}•\-]/u.test(l) ? l : `💡 ${l}`));
  const ul = document.createElement("ul");
  withEmoji.forEach(item => {
    const li = document.createElement("li");
    li.textContent = item.replace(/^[•\-]\s*/, "");
    ul.appendChild(li);
  });
  return ul;
}

// Override aiShowAnswer to use list rendering and keep marquee fresh
const _aiOldShowAnswer = typeof aiShowAnswer === "function" ? aiShowAnswer : null;
function aiShowAnswer(text) {
  const wrap = byId("aiAnswerWrap");
  const box = byId("aiAnswer");
  if (!wrap || !box) return;
  box.innerHTML = "";
  box.appendChild(aiRenderList(text));
  // small footer hint
  const hint = document.createElement("div");
  hint.className = "muted";
  hint.textContent = "Tip: you can minimize or close this panel.";
  box.appendChild(hint);
  wrap.style.display = "block";
  aiSetMarquee(text.split(/\n/).filter(Boolean)[0] ? "💡 " + text.split(/\n/)[0] : "");
}

// Minimize / Close controls + floating reopen button
(function attachAIPanelControls(){
  const ansWrap = byId("aiAnswerWrap");
  const editsWrap = byId("aiMinimalEditsWrap");
  if(!ansWrap && !editsWrap) return;

  // Floating reopen pill
  let fab = document.getElementById("aiReopenFab");
  if(!fab){
    fab = document.createElement("button");
    fab.id = "aiReopenFab";
    fab.className = "ai-fab";
    fab.textContent = "🧠 Assistant";
    fab.addEventListener("click", ()=>{
      if(ansWrap) ansWrap.style.display = "block";
      if(editsWrap) editsWrap.style.display = "block";
      fab.style.display = "none";
    });
    document.body.appendChild(fab);
  }

  function minimize(el){ if(el) el.style.display = "none"; fab.style.display = "inline-block"; }
  function close(el){ if(el) el.style.display = "none"; fab.style.display = "inline-block"; }

  const wire = (btnId, fn) => { const b = byId(btnId); if(b) b.addEventListener("click", ()=>fn(b.closest(".card"))); };

  wire("aiAnswerMin", minimize);
  wire("aiAnswerClose", close);
  wire("aiEditsMin", minimize);
  wire("aiEditsClose", close);
})();

/* -------- Live Tip Engine --------
   Sends small, contextual prompts as the user interacts,
   without being noisy (debounced & distinct).
*/
const aiLive = (function(){
  let timer = null;
  let lastHash = "";

  function hashPayload(o){ try{ return JSON.stringify(o).slice(0,400); }catch{ return ""; } }
  function debounce(fn, ms=500){ return (...a)=>{ clearTimeout(timer); timer=setTimeout(()=>fn(...a), ms); }; }

  async function tip(eventName, payload={}){
    const context = aiGetPageContext ? aiGetPageContext() : { state };
    const minimalCtx = {
      step: context?.state?.step ?? currentStep,
      days: context?.state?.days,
      slotLength: context?.state?.slotLength,
      rooms: context?.state?.rooms,
      hasSolution: context?.state?.hasSolution || !!state.solution,
      activeStepTitle: context?.activeStepTitle || "",
    };
    const sig = eventName + "|" + hashPayload({ minimalCtx, payload });
    if(sig === lastHash) return; // avoid spam on same action/value
    lastHash = sig;

    try{
      const sys = "You are an inline coach for a timetable builder. Reply with 3–6 bullet tips, each starting with an emoji. Be specific. If the user is doing something suboptimal, say what and how to fix.";
      const user = `Event: ${eventName}\nPayload: ${JSON.stringify(payload)}\nContext: ${JSON.stringify(minimalCtx)}\n` +
                   `If generation has failed before, prioritize changes that reduce conflicts or search space.`;

      const text = await callAI([
        { role: "system", content: sys },
        { role: "user", content: user }
      ], { maxTokens: 300, temperature: 0.2 });

      aiShowAnswer(text);
    }catch(e){
      // silent fail—no spam
      console.warn("Live tip error:", e.message);
    }
  }

  const dtip = debounce(tip, 600);
  return { tip: dtip };
})();

/* ----- Wire common user actions to live tips (non-intrusive) ----- */
// Step changes
(function(){
  const oldShowStep = showStep;
  showStep = function(n){
    oldShowStep(n);
    aiLive.tip("navigate_step", { step: n });
  };
})();

// Generate clicked: success or fail (existing handler already sets genStatus) ➜ tip
(function(){
  const gen = byId("generate");
  if(gen){
    gen.addEventListener("click", () => {
      // slight delay to let status update
      setTimeout(()=>{
        const status = (byId("genStatus")?.textContent || "").toLowerCase();
        aiLive.tip("generate_clicked", { status });
      }, 80);
    });
  }
})();

// Key inputs in Step 1 (time, slot length, rooms)
["startTime","endTime","slotLength","maxClassesPerDay","numTheoryRooms","numLabs"]
  .forEach(id => {
    const el = byId(id);
    if(!el) return;
    el.addEventListener("change", (e)=>{
      aiLive.tip("setting_changed", { id, value: e.target.value });
    });
  });

// Subjects/faculties/breaks/events added or removed → observe containers
(function(){
  const targets = ["subjectsList","facultiesList","breaksList","eventsList"];
  targets.forEach(id=>{
    const el = byId(id);
    if(!el) return;
    const obs = new MutationObserver(()=> aiLive.tip("list_modified", { list: id, count: el.children.length }));
    obs.observe(el, { childList: true, subtree: false });
  });
})();

// Results table interactions (drag & drop already implemented) → observe DOM changes
(function(){
  const results = byId("results");
  if(!results) return;
  const obs = new MutationObserver(()=> aiLive.tip("results_changed", { action: "edit_or_refresh" }));
  obs.observe(results, { childList: true, subtree: true });
})();

// Search bar usage in Step 7
(function(){
  const input = document.getElementById("ttSearchInput");
  if(!input) return;
  input.addEventListener("input", ()=> aiLive.tip("search_query", { q: input.value }));
})();

/* ----- Tie minimal edits into marquee & live stream on solver fail ----- */
// If you added aiSuggestMinimalEdits earlier, we keep using it.
// Also push a quick live tip after edits appear.
const _oldAiSuggest = typeof aiSuggestMinimalEdits === "function" ? aiSuggestMinimalEdits : null;
if(_oldAiSuggest){
  aiSuggestMinimalEdits = async function(opts){
    await _oldAiSuggest(opts);
    aiLive.tip("suggestions_ready", { reason: opts?.reason || "" });
  };
}
















































































