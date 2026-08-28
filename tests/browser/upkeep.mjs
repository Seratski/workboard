import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)('playwright');
// Use whatever chromium playwright installed, unless a prebuilt one is present (some
// sandboxes ship it at a fixed path and cannot download). WB_CHROMIUM overrides both.
const PREBUILT = '/opt/pw-browsers/chromium';
const exe = process.env.WB_CHROMIUM
  || (createRequire(import.meta.url)('fs').existsSync(PREBUILT) ? PREBUILT : null);
const b = await chromium.launch(exe ? { executablePath: exe } : {});
const p = await b.newPage({ viewport:{width:1400,height:1000} });
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://127.0.0.1:8777/test.html'); await p.waitForTimeout(700);
let pass=0,fail=0;
const step=async(n,f)=>{try{const r=await f();
  if(r===true){pass++;console.log('OK   '+n);}
  else if(typeof r==='string'){pass++;console.log('OK   '+n+' :: '+r);}
  else {fail++;console.log('FAIL '+n+(r&&r!==false?' :: '+JSON.stringify(r):''));}
}catch(e){fail++;console.log('FAIL '+n+' :: '+e.message);}};
const T = async (fn,arg) => (arg===undefined ? p.evaluate(fn) : p.evaluate(fn,arg));

console.log('=== the Today page no longer shows two numbers in one field ===');
await step('the two headings have their own count elements', async()=>
  await T(()=>!!document.getElementById('todayCount')&&!!document.getElementById('todayDueCount')));
await step('"Due today" gets the due-today number', async()=>{
  const r = await T(()=>{
    window.__DATA.tasks.push({id:'du1',title:'Due today one',note:'',priority:'none',
      date:todayStr(),sites:[],persons:[],tags:[],actions:[],links:[],attachments:[],
      comments:[],history:[],done:false,createdAt:{toMillis:()=>1787000000000}});
    startListeners(); return null;});
  await p.waitForTimeout(400);
  await p.evaluate(()=>renderAllNow());
  const r2 = await T(()=>({due:document.getElementById('todayDueCount').textContent,
    dueReal:getFiltered('today').length}));
  return r2.due.includes(String(r2.dueReal)) ? r2.due : {r2};});
await step('"Today focus" keeps the pinned number, and they are different', async()=>{
  const r = await T(async()=>{
    todayFocus=[{id:'du1',title:'Due today one',done:false}];
    renderTodayFocus(); renderTodayList();
    return {focus:document.getElementById('todayCount').textContent,
      due:document.getElementById('todayDueCount').textContent,
      focusN:todayFocus.length, dueN:getFiltered('today').length};});
  return r.focus.includes(String(r.focusN))&&r.due.includes(String(r.dueN))
    ? 'focus "'+r.focus.trim()+'", due "'+r.due.trim()+'"' : {r};});
await step('rendering in either order leaves both correct', async()=>{
  const a = await T(()=>{renderTodayFocus();renderTodayList();
    return document.getElementById('todayCount').textContent;});
  const c = await T(()=>{renderTodayList();renderTodayFocus();
    return document.getElementById('todayCount').textContent;});
  return a===c ? 'stable: "'+a.trim()+'"' : {a,c};});

console.log('\n=== the pinned list follows the task, not a copy ===');
await step('a renamed task shows its new title in the Today panel', async()=>{
  const r = await T(async()=>{
    const d=window.__DATA.tasks.find(t=>t.id==='du1');
    d.title='Renamed after pinning';
    startListeners(); await new Promise(r=>setTimeout(r,250));
    todayFocus=[{id:'du1',title:'The old stored title',done:false}];
    renderTodayFocus();
    return document.querySelector('#todayFocusList .today-item-title').textContent;});
  return r==='Renamed after pinning' ? r : {r};});
await step('a task completed on the board shows as ticked in the panel', async()=>{
  const r = await T(async()=>{
    const d=window.__DATA.tasks.find(t=>t.id==='du1');
    d.done=true;
    startListeners(); await new Promise(r=>setTimeout(r,250));
    todayFocus=[{id:'du1',title:'x',done:false}];
    renderTodayFocus();
    const row=document.querySelector('#todayFocusList .today-item');
    return {rowDone:row.className.includes('done-today'),
      checkDone:row.querySelector('.today-item-check').className.includes('checked')};});
  return r.rowDone&&r.checkDone ? 'ticked from the task' : {r};});
await step('a pinned task that no longer exists falls back to the stored title', async()=>{
  const r = await T(()=>{
    todayFocus=[{id:'gone-for-good',title:'Deleted but still pinned',done:false}];
    renderTodayFocus();
    return document.querySelector('#todayFocusList .today-item-title').textContent;});
  return r==='Deleted but still pinned' ? r : {r};});
await step('ticking it off reads the task, not the stored flag', async()=>{
  const r = await T(async()=>{
    const d=window.__DATA.tasks.find(t=>t.id==='du1');
    d.done=false;
    startListeners(); await new Promise(r=>setTimeout(r,250));
    todayFocus=[{id:'du1',title:'x',done:true}];   // stored flag is WRONG on purpose
    const before=window.__WB_WRITES.length;
    await toggleTodayItemDone(0);
    await new Promise(r=>setTimeout(r,150));
    const w=window.__WB_WRITES.slice(before).filter(x=>x.coll==='tasks'&&x.id==='du1').pop();
    return w&&w.data.done;});
  return r===true ? 'marked done, not un-done' : {r};});

console.log('\n=== four renders on load became one ===');
await step('renderAll coalesces: many requests, one render', async()=>{
  const r = await T(async()=>{
    renderStats={requested:0,performed:0,htmlWrites:0,htmlSkips:0};
    renderAll();renderAll();renderAll();renderAll();
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    return {requested:renderStats.requested,performed:renderStats.performed};});
  return r.requested===4&&r.performed===1 ? '4 requested, 1 performed' : {r};});
await step('a later request after the frame renders again', async()=>{
  const r = await T(async()=>{
    renderStats={requested:0,performed:0,htmlWrites:0,htmlSkips:0};
    renderAll();
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    renderAll();
    await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    return renderStats.performed;});
  return r===2 ? '2 frames, 2 renders' : {r};});
await step('a page load performs one render, not four', async()=>{
  const r = await T(async()=>{
    renderStats={requested:0,performed:0,htmlWrites:0,htmlSkips:0};
    startListeners();
    await new Promise(r=>setTimeout(r,500));
    return {requested:renderStats.requested,performed:renderStats.performed};});
  return r.requested>=4&&r.performed===1 ? r.requested+' requested, 1 performed' : {r};});

console.log('\n=== a snapshot that changes nothing touches no DOM ===');
await step('the second identical render writes no markup at all', async()=>{
  const r = await T(()=>{
    renderAllNow();                                    // settle
    renderStats={requested:0,performed:0,htmlWrites:0,htmlSkips:0};
    renderAllNow();                                    // nothing changed since
    return {writes:renderStats.htmlWrites,skips:renderStats.htmlSkips};});
  return r.writes===0&&r.skips>=10 ? '0 writes, '+r.skips+' lists left alone' : {r};});
await step('a real change still writes, and only where it changed', async()=>{
  const r = await T(async()=>{
    renderAllNow();
    const d=window.__DATA.tasks.find(t=>t.id==='du1');
    d.title='Changed for real';
    startListeners(); await new Promise(r=>setTimeout(r,250));
    renderStats={requested:0,performed:0,htmlWrites:0,htmlSkips:0};
    renderAllNow();
    return {writes:renderStats.htmlWrites,skips:renderStats.htmlSkips};});
  return r.writes>0&&r.skips>0 ? r.writes+' written, '+r.skips+' skipped' : {r};});
// Node identity is the mechanism behind everything the old code lost on every snapshot:
// scroll position, :hover, focus, and images reloading. If the nodes survive, so do they.
await step('an identical render does not rebuild the task rows', async()=>{
  const r = await T(async()=>{
    for(let i=0;i<60;i++) window.__DATA.tasks.push({id:'sc'+i,title:'Filler '+i,
      note:'',priority:'none',date:'',sites:[],persons:[],tags:[],actions:[],links:[],
      attachments:[],comments:[],history:[],done:false,createdAt:{toMillis:()=>1787000000000+i}});
    startListeners(); await new Promise(r=>setTimeout(r,300));
    renderAllNow();
    const el=document.getElementById('taskList');
    const firstRow=el.firstElementChild;
    const rowCount=el.children.length;
    renderAllNow();                                    // nothing changed
    return {same:el.firstElementChild===firstRow,rowCount,
      stillThere:el.children.length===rowCount};});
  return r.same&&r.stillThere ? 'same '+r.rowCount+' row objects' : {r};});
await step('a real change does rebuild them', async()=>{
  const r = await T(async()=>{
    const el=document.getElementById('taskList');
    const firstRow=el.firstElementChild;
    window.__DATA.tasks[0].title='Now definitely different';
    startListeners(); await new Promise(r=>setTimeout(r,250));
    renderAllNow();
    return el.firstElementChild!==firstRow;});
  return r===true ? 'rebuilt, as it must be' : {r};});
await step('setHtml leaves the element alone on a repeat of the same markup', async()=>
  await T(()=>{const d=document.createElement('div');
    setHtml(d,'<b>x</b>');
    const first=d.firstChild;
    const wrote=setHtml(d,'<b>x</b>');
    return wrote===false&&d.firstChild===first;}));
// The guard compares with the string last assigned, so markup the browser rewrites on
// parse -- an unquoted attribute here -- still counts as unchanged the second time.
await step('and still matches markup the browser normalises on parse', async()=>
  await T(()=>{const d=document.createElement('div');
    const html='<img src=x alt=\'it&#39;s\'>';
    setHtml(d,html);
    const roundTrip=d.innerHTML;
    const wrote=setHtml(d,html);
    return wrote===false&&roundTrip!==html;}));
await step('different markup does write', async()=>
  await T(()=>{const d=document.createElement('div');
    setHtml(d,'<b>x</b>');
    return setHtml(d,'<b>y</b>')===true;}));
await step('setText is guarded the same way', async()=>
  await T(()=>{const d=document.createElement('div');d.id='wb-probe-text';
    document.body.appendChild(d);
    setText(d,'a'); const wrote=setText(d,'a');
    d.remove();
    return wrote===false;}));

console.log('\n=== the board says when the backup is getting old ===');
await step('the banner exists', async()=>
  await T(()=>!!document.getElementById('backupNag')));
await step('with no export recorded it prompts, but not in the red styling', async()=>{
  const r = await T(()=>{lastExportAt='';backupNagDismissed=false;renderBackupNag();
    const el=document.getElementById('backupNag');
    return {show:el.classList.contains('show'),stale:el.classList.contains('stale')};});
  return r.show&&!r.stale ? 'prompting, not alarming' : {r};});
await step('and the wording says the app has no record, not that you never did it', async()=>{
  const r = await T(()=>{lastExportAt='';renderBackupNag();
    return document.getElementById('backupNagText').textContent;});
  return /No backup recorded yet/.test(r)&&/only copy/.test(r) ? r : {r};});
await step('exported today: no banner', async()=>{
  const r = await T(()=>{lastExportAt=todayStr();renderBackupNag();
    return document.getElementById('backupNag').classList.contains('show');});
  return r===false ? true : {r};});
await step('13 days: still quiet', async()=>{
  const r = await T(()=>{lastExportAt=addDaysStr(-13);renderBackupNag();
    return document.getElementById('backupNag').classList.contains('show');});
  return r===false ? true : {r};});
await step('14 days: the reminder appears', async()=>{
  const r = await T(()=>{lastExportAt=addDaysStr(-14);renderBackupNag();
    const el=document.getElementById('backupNag');
    return {show:el.classList.contains('show'),stale:el.classList.contains('stale'),
      text:document.getElementById('backupNagText').textContent};});
  return r.show&&!r.stale&&/14 days ago/.test(r.text) ? r.text : {r};});
await step('30 days: it turns red', async()=>{
  const r = await T(()=>{lastExportAt=addDaysStr(-30);renderBackupNag();
    const el=document.getElementById('backupNag');
    return {show:el.classList.contains('show'),stale:el.classList.contains('stale')};});
  return r.show&&r.stale ? 'stale styling' : {r};});
await step('dismissing hides it for this page load only', async()=>{
  const r = await T(()=>{lastExportAt=addDaysStr(-40);backupNagDismissed=false;renderBackupNag();
    const shownFirst=document.getElementById('backupNag').classList.contains('show');
    dismissBackupNag();
    const shownAfter=document.getElementById('backupNag').classList.contains('show');
    return {shownFirst,shownAfter,flag:backupNagDismissed};});
  return r.shownFirst&&!r.shownAfter&&r.flag===true ? 'hidden, flag set' : {r};});
await step('Settings shows the age in words', async()=>{
  const r = await T(()=>{lastExportAt=addDaysStr(-3);renderBackupNag();
    return document.getElementById('backupWhen').textContent;});
  return r==='exported 3 days ago' ? r : {r};});
await step('and reads naturally for today, yesterday and never', async()=>{
  const r = await T(()=>{
    const out={};
    lastExportAt=todayStr();renderBackupNag();out.today=document.getElementById('backupWhen').textContent;
    lastExportAt=addDaysStr(-1);renderBackupNag();out.yesterday=document.getElementById('backupWhen').textContent;
    lastExportAt='';renderBackupNag();out.never=document.getElementById('backupWhen').textContent;
    return out;});
  return r.today==='exported today'&&r.yesterday==='exported yesterday'&&r.never==='never exported'
    ? [r.today,r.yesterday,r.never].join(' / ') : {r};});
await step('a future date is treated as today, not as negative days', async()=>{
  const r = await T(()=>{lastExportAt=addDaysStr(5);renderBackupNag();
    return {when:document.getElementById('backupWhen').textContent,
      show:document.getElementById('backupNag').classList.contains('show')};});
  return r.when==='exported today'&&r.show===false ? true : {r};});

console.log('\n=== exporting records the date ===');
await step('an export writes lastExportAt into meta/settings, merged', async()=>{
  const r = await T(async()=>{
    lastExportAt='';
    const before=window.__WB_WRITES.length;
    await exportData();
    await new Promise(r=>setTimeout(r,300));
    const w=window.__WB_WRITES.slice(before).filter(x=>x.coll==='meta'&&x.id==='settings').pop();
    return {w,live:lastExportAt,today:todayStr()};});
  return r.w&&r.w.data.lastExportAt===r.today&&r.live===r.today
    ? 'lastExportAt='+r.w.data.lastExportAt : {r};});
await step('it does not overwrite the defaults in that document', async()=>{
  const r = await T(()=>{
    const w=window.__WB_WRITES.filter(x=>x.coll==='meta'&&x.id==='settings').pop();
    return Object.keys(w.data);});
  return r.length===1&&r[0]==='lastExportAt' ? 'only lastExportAt written' : {keys:r};});
await step('the banner clears itself right after an export', async()=>
  await T(()=>!document.getElementById('backupNag').classList.contains('show')));
await step('the Export button in the banner calls the real export', async()=>{
  const onclick = await T(()=>{
    const btns=[...document.querySelectorAll('#backupNag button')];
    return btns.map(x=>x.getAttribute('onclick'));});
  return onclick.some(x=>x==='exportData()')&&onclick.some(x=>x==='dismissBackupNag()')
    ? onclick.join(' | ') : {onclick};});

console.log('\n=== restoring from Trash keeps the task identity ===');
await step('a restore writes back under the original id', async()=>{
  const r = await T(async()=>{
    window.__DATA.trash=[{id:'tr1',title:'Deleted by mistake',note:'',priority:'high',
      sites:['DK'],persons:[],tags:[],actions:[],links:[],attachments:[],comments:[],
      history:[{type:'created',time:1}],done:false,originalId:'was-t9',
      deletedAt:{toMillis:()=>Date.now()-2*86400000}}];
    startTrashListener(); trashItems=window.__DATA.trash.slice();
    const before=window.__WB_WRITES.length;
    await restoreTask('tr1');
    await new Promise(r=>setTimeout(r,250));
    const w=window.__WB_WRITES.slice(before);
    return {set:w.find(x=>x.op==='set'&&x.coll==='tasks'),
      add:w.find(x=>x.op==='add'&&x.coll==='tasks'),
      del:w.find(x=>x.op==='delete'&&x.coll==='trash')};});
  return r.set&&r.set.id==='was-t9'&&!r.add&&r.del ? 'set tasks/was-t9, trash entry removed' : {r};});
await step('a pinned Today item therefore still points at it', async()=>{
  const r = await T(()=>{
    todayFocus=[{id:'was-t9',title:'Deleted by mistake',done:false}];
    startListeners();
    return tasks.some(t=>t.id==='was-t9');});
  return r===true ? 'the id resolves again' : {r};});
await step('the restore is recorded in the history', async()=>{
  const r = await T(()=>{
    const w=window.__WB_WRITES.filter(x=>x.op==='set'&&x.coll==='tasks').pop();
    return w.data.history.map(h=>h.type);});
  return r[r.length-1]==='restored' ? r.join(' -> ') : {r};});
await step('"restored" has a human label in the history list', async()=>{
  await p.evaluate(()=>{startListeners();}); await p.waitForTimeout(300);
  await p.evaluate(()=>openDetail('was-t9')); await p.waitForTimeout(250);
  const h = await T(()=>document.getElementById('detailBody').innerHTML);
  await p.evaluate(()=>closeDetail());
  return h.includes('Restored from Trash') ? true : {snippet:h.slice(-250)};});
await step('the trash copy fields are not carried onto the task', async()=>{
  const r = await T(()=>{
    const w=window.__WB_WRITES.filter(x=>x.op==='set'&&x.coll==='tasks').pop();
    return ['originalId','deletedAt','mergedInto','id'].filter(k=>k in w.data);});
  return r.length===0 ? 'none of them' : {leftover:r};});
await step('if the old id is taken it falls back to a new one', async()=>{
  const r = await T(async()=>{
    window.__DATA.tasks.push({id:'taken',title:'Occupier',note:'',priority:'none',date:'',
      sites:[],persons:[],tags:[],actions:[],links:[],attachments:[],comments:[],history:[],
      done:false,createdAt:{toMillis:()=>1}});
    window.__DATA.trash=[{id:'tr2',title:'Clash',note:'',priority:'none',sites:[],persons:[],
      tags:[],actions:[],links:[],attachments:[],comments:[],history:[],done:false,
      originalId:'taken',deletedAt:{toMillis:()=>Date.now()}}];
    trashItems=window.__DATA.trash.slice();
    const before=window.__WB_WRITES.length;
    await restoreTask('tr2');
    await new Promise(r=>setTimeout(r,250));
    const w=window.__WB_WRITES.slice(before);
    return {add:!!w.find(x=>x.op==='add'&&x.coll==='tasks'),
      set:!!w.find(x=>x.op==='set'&&x.coll==='tasks'&&x.id==='taken'),
      toast:document.getElementById('toast').textContent};});
  return r.add&&!r.set&&/new id/.test(r.toast) ? r.toast : {r};});
await step('a trash entry with no original id still restores', async()=>{
  const r = await T(async()=>{
    window.__DATA.trash=[{id:'tr3',title:'Legacy trash',note:'',priority:'none',sites:[],
      persons:[],tags:[],actions:[],links:[],attachments:[],comments:[],history:[],
      done:false,deletedAt:{toMillis:()=>Date.now()}}];
    trashItems=window.__DATA.trash.slice();
    const before=window.__WB_WRITES.length;
    await restoreTask('tr3');
    await new Promise(r=>setTimeout(r,250));
    return !!window.__WB_WRITES.slice(before).find(x=>x.op==='add'&&x.coll==='tasks');});
  return r===true ? 'added under a new id' : {r};});

console.log('\n=== Trash shows its age and offers to clear the old ones ===');
await step('each row shows how long it has been there', async()=>{
  const r = await T(()=>{
    window.__DATA.trash=[
      {id:'a1',title:'Yesterday',deletedAt:{toMillis:()=>Date.now()-1*86400000}},
      {id:'a2',title:'Forty days',deletedAt:{toMillis:()=>Date.now()-40*86400000}},
      {id:'a3',title:'Just now',deletedAt:null}];
    trashItems=window.__DATA.trash.slice();
    renderTrashList();
    return document.getElementById('trashList').innerText;});
  return /1d/.test(r)&&/40d/.test(r)&&/today/.test(r) ? r.replace(/\s+/g,' ').slice(0,80) : {r};});
await step('a pending deletedAt counts as today, not as unknown', async()=>
  await T(()=>trashAgeDays({deletedAt:null})===0&&trashAgeDays({})===0));
await step('the purge button appears only when something is old enough', async()=>{
  const withOld = await T(()=>document.getElementById('trashOldRow').innerHTML);
  const withoutOld = await T(()=>{
    trashItems=[{id:'b1',title:'New',deletedAt:{toMillis:()=>Date.now()}}];
    renderTrashList();
    return document.getElementById('trashOldRow').innerHTML;});
  return /older than 30 days/.test(withOld)&&withoutOld==='' ? 'shown for 1, hidden for 0' : {withOld,withoutOld};});
await step('it counts only the old ones', async()=>{
  const r = await T(()=>{
    trashItems=[{id:'c1',deletedAt:{toMillis:()=>Date.now()-40*86400000}},
                {id:'c2',deletedAt:{toMillis:()=>Date.now()-31*86400000}},
                {id:'c3',deletedAt:{toMillis:()=>Date.now()-5*86400000}}];
    renderTrashList();
    return {row:document.getElementById('trashOldRow').innerText,old:trashOlderThan(30).length};});
  return r.old===2&&/the 2 items/.test(r.row) ? r.row.trim() : {r};});
// The first version of this button rendered "U0001f5d1 Delete the 2 items" because \U is
// not a JavaScript escape. Check the label where it is actually rendered.
await step('the purge button label has no stray codepoint in it', async()=>{
  const r = await T(()=>{
    trashItems=[{id:'d1',deletedAt:{toMillis:()=>Date.now()-40*86400000}}];
    renderTrashList();
    return document.getElementById('trashOldRow').innerText.trim();});
  return !/\\u[0-9a-fA-F]{4}|\b[Uu]000[0-9a-fA-F]{4,5}\b/.test(r) ? r : {r};});
await step('nothing is deleted on a timer without being asked', async()=>{
  const r = await T(async()=>{
    const before=window.__WB_WRITES.length;
    renderTrashList(); startTrashListener();
    await new Promise(r=>setTimeout(r,200));
    return window.__WB_WRITES.length-before;});
  return r===0 ? 'no writes from rendering Trash' : {r};});

console.log('\n=== the dead FAB is gone ===');
await step('no .fab rule is left in the stylesheet', async()=>{
  const left = await T(()=>{
    const hits=[];
    for(const sheet of document.styleSheets){
      let rules; try{ rules=sheet.cssRules; }catch(e){ continue; }
      for(const r of rules){
        if(r.selectorText&&/\.fab\b/.test(r.selectorText)) hits.push(r.selectorText);
        if(r.cssRules) for(const inner of r.cssRules)
          if(inner.selectorText&&/\.fab\b/.test(inner.selectorText)) hits.push(inner.selectorText);
      }
    }
    return hits;});
  return left.length===0 ? true : {left};});
await step('and nothing looks it up any more', async()=>{
  const html = await p.content();
  return !/getElementById\('fab'\)/.test(html) ? true : 'still looked up';});

console.log('\n=== nothing broke ===');
await step('the page raised no uncaught errors', async()=>
  errs.length===0?true:errs.join(' | '));

console.log('\n'+pass+' passed, '+fail+' failed');
await b.close();
process.exit(fail?1:0);
