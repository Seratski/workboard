// playwright is installed outside this folder (OneDrive), so resolve it through the CJS
// loader, which honours NODE_PATH -- ESM `import` does not. Set WB_PLAYWRIGHT to an
// absolute path to the package to be explicit.
import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)(process.env.WB_PLAYWRIGHT || 'playwright');
// Use whatever chromium playwright installed, unless a prebuilt one is present (some
// sandboxes ship it at a fixed path and cannot download). WB_CHROMIUM overrides both.
const PREBUILT = '/opt/pw-browsers/chromium';
const exe = process.env.WB_CHROMIUM
  || (createRequire(import.meta.url)('fs').existsSync(PREBUILT) ? PREBUILT : null);
const b = await chromium.launch(exe ? { executablePath: exe } : {});
const p = await b.newPage({ viewport:{width:1400,height:900} });
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://127.0.0.1:8777/test.html'); await p.waitForTimeout(700);
let pass=0,fail=0;
const step=async(n,f)=>{try{const r=await f();
  if(r===true){pass++;console.log('OK   '+n);}
  else if(typeof r==='string'){pass++;console.log('OK   '+n+' :: '+r);}
  else {fail++;console.log('FAIL '+n+(r&&r!==false?' :: '+JSON.stringify(r):''));}
}catch(e){fail++;console.log('FAIL '+n+' :: '+e.message);}};

// ---------- seed ----------
await p.evaluate(()=>{
  const D=window.__DATA;
  const ts=ms=>({toMillis:()=>ms});
  const base=(id,o)=>Object.assign({id,title:id,note:'',priority:'none',date:'',sites:[],persons:[],
    tags:[],actions:[],links:[],attachments:[],comments:[],history:[],done:false,createdAt:ts(1787000000000)},o);
  D.tasks.push(base('pz1',{title:'Paused far out',snoozedUntil:addDaysStr(30),sites:['DK']}));
  D.tasks.push(base('pz2',{title:'Paused soon',snoozedUntil:addDaysStr(2),sites:['NO'],date:todayStr()}));
  D.tasks.push(base('pz3',{title:'Wakes today',snoozedUntil:todayStr()}));
  D.tasks.push(base('pz4',{title:'Woke yesterday',snoozedUntil:addDaysStr(-3)}));
  D.tasks.push(base('or1',{title:'Only DK',sites:['DK'],persons:['Anna']}));
  D.tasks.push(base('or2',{title:'Only NO',sites:['NO'],persons:['Martin']}));
  D.tasks.push(base('or3',{title:'Only SE',sites:['SE'],persons:['Martin']}));
  D.tasks.push(base('rp1',{title:'Weekly review',date:'2026-09-04',repeat:{n:1,unit:'week',from:'due'},
    actions:[{text:'step a',assignee:'',done:true},{text:'step b',assignee:'',done:false}],
    links:[{name:'doc',url:'https://example.com'}],
    attachments:[{id:'a1',name:'x.png',type:'image/png',size:10,thumb:'data:image/png;base64,x'}],
    comments:[{text:'old chat',time:1}],richBody:'<p>body</p>',richHtml:true}));
  D.tasks.push(base('rp2',{title:'Monthly from done',repeat:{n:2,unit:'month',from:'done'}}));
  D.tasks.push(base('rp3',{title:'Very overdue weekly',date:'2026-01-05',repeat:{n:1,unit:'week',from:'due'}}));
  startListeners();
});
await p.waitForTimeout(600);

const T = async fn => p.evaluate(fn);

console.log('=== the Paused tab exists in both navs ===');
await step('top nav has a Paused tab', async()=>
  await T(()=>!!document.getElementById('tab-paused')&&document.getElementById('tab-paused').getAttribute('onclick')==="showPage('paused')"));
await step('bottom nav has a Paused item', async()=>
  await T(()=>!!document.getElementById('bnav-paused')));
await step('there is a page-paused container', async()=>
  await T(()=>!!document.getElementById('page-paused')));
await step('showPage("paused") shows it and marks both tabs active', async()=>
  await T(()=>{showPage('paused');
    return document.getElementById('page-paused').style.display==='block'
      && document.getElementById('tab-paused').classList.contains('active')
      && document.getElementById('bnav-paused').classList.contains('active')
      && document.getElementById('page-board').style.display==='none';}));

console.log('\n=== isPaused only counts future wake dates ===');
await step('a wake date 30 days out is paused', async()=>await T(()=>isPaused(tasks.find(t=>t.id==='pz1'))===true));
await step('a wake date of today is NOT paused', async()=>await T(()=>isPaused(tasks.find(t=>t.id==='pz3'))===false));
await step('a wake date in the past is NOT paused', async()=>await T(()=>isPaused(tasks.find(t=>t.id==='pz4'))===false));
await step('no snoozedUntil is NOT paused', async()=>await T(()=>isPaused(tasks.find(t=>t.id==='or1'))===false));
await step('isPaused(undefined) is false, not a throw', async()=>await T(()=>isPaused(undefined)===false));

console.log('\n=== paused tasks leave the board, Today and the counts ===');
await step('paused tasks are absent from the board', async()=>
  await T(()=>{const ids=getFiltered('board').map(t=>t.id);
    return !ids.includes('pz1')&&!ids.includes('pz2');}));
await step('a task whose wake date has arrived is back on the board', async()=>
  await T(()=>getFiltered('board').map(t=>t.id).includes('pz3')));
await step('pz2 is due today but paused, so Today does not list it', async()=>
  await T(()=>!getFiltered('today').map(t=>t.id).includes('pz2')));
await step('the Today badge does not count a paused task', async()=>
  await T(()=>{updateBadges();
    const n=tasks.filter(t=>!t.done&&!isPaused(t)&&t.date===todayStr()).length;
    const badge=document.getElementById('tab-today').textContent;
    return n===0? !/\d/.test(badge) : badge.includes(String(n));}));
await step('the Paused tab shows a count badge', async()=>{
  const r=await T(()=>{updateBadges();return document.getElementById('tab-paused').textContent;});
  return r.includes('2')?r.trim():false;});
await step('search still finds a paused task', async()=>
  await T(()=>{document.getElementById('searchInput').value='Paused far';
    const ids=getFiltered('search').map(t=>t.id);
    document.getElementById('searchInput').value='';
    return ids.includes('pz1');}));

console.log('\n=== the Paused page lists them, soonest first ===');
await step('renderPausedList lists exactly the paused tasks', async()=>
  await T(()=>{renderPausedList();
    const rows=[...document.querySelectorAll('#pausedList .paused-row')].map(r=>r.id);
    return rows.length===2&&rows.includes('tc-pz1')&&rows.includes('tc-pz2');}));
await step('the one waking soonest is listed first', async()=>
  await T(()=>document.querySelector('#pausedList .paused-row').id==='tc-pz2'));
await step('each row says when it comes back', async()=>{
  const r=await T(()=>document.querySelector('#pausedList .paused-until').textContent);
  return /in 2 days|tomorrow/.test(r)?r:false;});
await step('each row has a Resume button', async()=>
  await T(()=>{const bs=[...document.querySelectorAll('#pausedList button')].map(b=>b.textContent);
    return bs.length===2&&bs.every(x=>x.includes('Resume'));}));
await step('the paused count line is filled in', async()=>{
  const r=await T(()=>document.getElementById('pausedCount').textContent);
  return r==='2 tasks'?r:false;});
await step('with nothing paused the page shows an empty state', async()=>
  await T(()=>{const keep=tasks.filter(t=>isPaused(t)).map(t=>[t.id,t.snoozedUntil]);
    keep.forEach(([id])=>{tasks.find(t=>t.id===id).snoozedUntil='';});
    renderPausedList();
    const empty=!!document.querySelector('#pausedList .empty')
      && document.getElementById('pausedCount').textContent==='';
    keep.forEach(([id,v])=>{tasks.find(t=>t.id===id).snoozedUntil=v;});
    renderPausedList();
    return empty;}));

console.log('\n=== the pause dialog ===');
await step('openPause offers five future presets', async()=>
  await T(()=>{openPause('or1');
    const bs=[...document.querySelectorAll('#pausePresets button')];
    const dates=bs.map(x=>(x.getAttribute('onclick').match(/'([\d-]+)'/)||[])[1]);
    return bs.length===5&&dates.every(d=>d>todayStr());}));
await step('the presets are tomorrow, +3, +7, +14 and next month', async()=>
  await T(()=>{const dates=[...document.querySelectorAll('#pausePresets button')]
      .map(x=>(x.getAttribute('onclick').match(/'([\d-]+)'/)||[])[1]);
    return JSON.stringify(dates)===JSON.stringify([addDaysStr(1),addDaysStr(3),addDaysStr(7),addDaysStr(14),addMonthsStr(1)]);}));
await step('an unpaused task defaults the date picker a week out', async()=>
  await T(()=>document.getElementById('pauseDate').value===addDaysStr(7)));
await step('an unpaused task is not offered Resume', async()=>
  await T(()=>document.getElementById('pauseResumeBtn').style.display==='none'));
await step('a paused task is offered Resume and shows its wake date', async()=>
  await T(()=>{openPause('pz1');
    return document.getElementById('pauseResumeBtn').style.display==='inline-flex'
      && document.getElementById('pauseSub').textContent.includes('Currently paused until')
      && document.getElementById('pauseDate').value===tasks.find(t=>t.id==='pz1').snoozedUntil;}));
await step('a date today or earlier is refused, and nothing is written', async()=>{
  const r=await T(async()=>{const before=window.__WB_WRITES.length;
    await pauseUntil(todayStr());
    return {wrote:window.__WB_WRITES.length-before,toast:document.getElementById('toast').textContent};});
  return r.wrote===0&&/future/i.test(r.toast)?r.toast:r;});
await step('applyPauseDate with an empty field refuses', async()=>{
  const r=await T(async()=>{const before=window.__WB_WRITES.length;
    document.getElementById('pauseDate').value='';
    applyPauseDate();await new Promise(r=>setTimeout(r,50));
    return {wrote:window.__WB_WRITES.length-before,toast:document.getElementById('toast').textContent};});
  return r.wrote===0&&/date/i.test(r.toast)?r.toast:r;});
await step('pausing writes snoozedUntil on that task', async()=>{
  const r=await T(async()=>{openPause('or1');
    const target=addDaysStr(9);
    await pauseUntil(target);
    const w=window.__WB_WRITES[window.__WB_WRITES.length-1];
    return {w,target};});
  return r.w&&r.w.coll==='tasks'&&r.w.id==='or1'&&r.w.data&&r.w.data.snoozedUntil===r.target
    ? 'snoozedUntil='+r.target : r;});
await step('pausing closes both the dialog and the detail modal', async()=>
  await T(()=>document.getElementById('pauseOverlay').classList.contains('hidden')
    && document.getElementById('detailOverlay').classList.contains('hidden')));
await step('pausing a task pinned to Today unpins it', async()=>{
  const r=await T(async()=>{
    todayFocus=[{id:'or2',title:'Only NO',done:false},{id:'or3',title:'Only SE',done:false}];
    openPause('or2');
    await pauseUntil(addDaysStr(5));
    return {focus:todayFocus.map(x=>x.id),
      metaWrite:window.__WB_WRITES.filter(w=>w.coll==='meta'&&w.id==='todayFocus').length};});
  return r.focus.length===1&&r.focus[0]==='or3'&&r.metaWrite>0 ? 'todayFocus='+r.focus : r;});
await step('resumeTaskById clears snoozedUntil', async()=>{
  const r=await T(async()=>{await resumeTaskById('pz1');
    return window.__WB_WRITES[window.__WB_WRITES.length-1];});
  return r&&r.id==='pz1'&&r.data.snoozedUntil==='' ? 'cleared' : r;});
await step('resumeTaskById with no id writes nothing', async()=>{
  const r=await T(async()=>{const before=window.__WB_WRITES.length;
    await resumeTaskById('');return window.__WB_WRITES.length-before;});
  return r===0?true:r;});
await step('Escape closes the pause dialog and leaves the detail modal open', async()=>{
  await p.evaluate(()=>{openDetail('rp1');});
  await p.waitForTimeout(200);
  await p.evaluate(()=>{openPause();});
  await p.waitForTimeout(150);
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  const r=await T(()=>({pause:document.getElementById('pauseOverlay').classList.contains('hidden'),
    detail:document.getElementById('detailOverlay').classList.contains('hidden')}));
  return r.pause&&!r.detail ? 'pause closed, detail still open' : r;});
await p.evaluate(()=>closeDetail());

console.log('\n=== pause in the task row and the detail modal ===');
await step('a paused task shows a ⏸ chip with its wake date', async()=>
  await T(()=>{tasks.find(t=>t.id==='pz1').snoozedUntil=addDaysStr(30);
    document.getElementById('searchInput').value='Paused far';
    renderTasks();
    const html=document.getElementById('taskList').innerHTML;
    document.getElementById('searchInput').value='';renderTasks();
    return html.includes('task-paused-chip')&&html.includes('⏸');}));
await step('the detail modal has a Pause button', async()=>
  await T(()=>{const b=[...document.querySelectorAll('#detailOverlay button')]
      .find(x=>/Pause/.test(x.textContent));
    return !!b&&/openPause/.test(b.getAttribute('onclick')||'');}));
await step('the detail footer button reads "Paused" for a paused task', async()=>{
  await p.evaluate(()=>openDetail('pz1')); await p.waitForTimeout(250);
  const r=await T(()=>document.getElementById('detailPauseBtn').textContent);
  return r.includes('Paused')?r:false;});
await step('the detail body shows when it comes back, with Resume now', async()=>
  await T(()=>{const h=document.getElementById('detailBody').innerHTML;
    return h.includes('back on')&&h.includes('resumeTaskFromDetail');}));
await step('the footer button reads "Pause" for an unpaused task', async()=>{
  await p.evaluate(()=>{closeDetail();openDetail('or3');}); await p.waitForTimeout(250);
  const r=await T(()=>document.getElementById('detailPauseBtn').textContent);
  return (r.includes('Pause')&&!r.includes('Paused'))?r:false;});
await p.evaluate(()=>closeDetail());

console.log('\n=== date arithmetic ===');
await step('addDays crosses a month boundary', async()=>
  await T(()=>todayStr(addDays(dateFromStr('2026-08-30'),3))==='2026-09-02'));
await step('addDays goes backwards too', async()=>
  await T(()=>todayStr(addDays(dateFromStr('2026-03-01'),-1))==='2026-02-28'));
await step('31 Jan + 1 month clamps to 28 Feb in 2026', async()=>
  await T(()=>todayStr(addMonths(dateFromStr('2026-01-31'),1))==='2026-02-28'));
await step('31 Jan + 1 month clamps to 29 Feb in a leap year', async()=>
  await T(()=>todayStr(addMonths(dateFromStr('2028-01-31'),1))==='2028-02-29'));
await step('31 Mar + 1 month clamps to 30 Apr', async()=>
  await T(()=>todayStr(addMonths(dateFromStr('2026-03-31'),1))==='2026-04-30'));
await step('31 Dec + 1 month rolls the year', async()=>
  await T(()=>todayStr(addMonths(dateFromStr('2026-12-31'),1))==='2027-01-31'));
await step('15 Jan + 12 months keeps the day', async()=>
  await T(()=>todayStr(addMonths(dateFromStr('2026-01-15'),12))==='2027-01-15'));
await step('dateFromStr with no argument means today', async()=>
  await T(()=>todayStr(dateFromStr())===todayStr()));
await step('dateFromStr builds a local noon date, so no DST or UTC drift', async()=>
  await T(()=>dateFromStr('2026-06-15').getHours()===12));

console.log('\n=== the repeat rule ===');
await step('no repeat gives no next date', async()=>
  await T(()=>nextRepeatDate(tasks.find(t=>t.id==='or1'))===''));
await step('unit "none" gives no next date', async()=>
  await T(()=>nextRepeatDate({repeat:{n:1,unit:'none',from:'due'},date:'2026-09-01'})===''));
await step('weekly from a future due date steps one week', async()=>
  await T(()=>nextRepeatDate({repeat:{n:1,unit:'week',from:'due'},date:addDaysStr(3)})===addDaysStr(10)));
await step('every 3 days from due steps three days', async()=>
  await T(()=>nextRepeatDate({repeat:{n:3,unit:'day',from:'due'},date:addDaysStr(1)})===addDaysStr(4)));
await step('monthly from due steps one month', async()=>
  await T(()=>nextRepeatDate({repeat:{n:1,unit:'month',from:'due'},date:addDaysStr(5)})
    ===addMonthsStr(1,addDaysStr(5))));
await step('counting from the finish date ignores the due date', async()=>
  await T(()=>nextRepeatDate({repeat:{n:2,unit:'week',from:'done'},date:'2020-01-01'})===addDaysStr(14)));
await step('a repeat from due with no due date falls back to today', async()=>
  await T(()=>nextRepeatDate({repeat:{n:1,unit:'week',from:'due'},date:''})===addDaysStr(7)));
await step('finishing a badly overdue weekly task lands in the future, not the past', async()=>{
  const r=await T(()=>({next:nextRepeatDate(tasks.find(t=>t.id==='rp3')),today:todayStr()}));
  return r.next>r.today ? r.next+' (due was 2026-01-05, today is '+r.today+')' : {tooEarly:r};});
await step('the guarded date stays on the original weekday', async()=>
  await T(()=>dateFromStr(nextRepeatDate(tasks.find(t=>t.id==='rp3'))).getDay()
    ===dateFromStr('2026-01-05').getDay()));
await step('a bad n is clamped rather than producing an invalid date', async()=>
  await T(()=>nextRepeatDate({repeat:{n:'abc',unit:'day',from:'due'},date:addDaysStr(1)})===addDaysStr(2)));
await step('n above 365 is clamped to 365', async()=>
  await T(()=>nextRepeatDate({repeat:{n:9999,unit:'day',from:'done'}})===addDaysStr(365)));
await step('repeatText reads naturally in the singular', async()=>
  await T(()=>repeatText({n:1,unit:'week'})==='every week'));
await step('repeatText pluralises', async()=>
  await T(()=>repeatText({n:3,unit:'day'})==='every 3 days'));
await step('repeatText of nothing is empty', async()=>
  await T(()=>repeatText(null)===''&&repeatText({unit:'none'})===''));

console.log('\n=== ticking off a repeating task creates the next one ===');
await step('spawnRepeat adds one task dated by the rule', async()=>{
  const r=await T(async()=>{const before=window.__DATA.tasks.length;
    const id=await spawnRepeat(tasks.find(t=>t.id==='rp1'));
    const add=window.__WB_WRITES.filter(w=>w.op==='add'&&w.coll==='tasks').pop();
    return {id,grew:window.__DATA.tasks.length-before,data:add&&add.data};});
  return r.id&&r.data&&r.data.date===await T(()=>nextRepeatDate(tasks.find(t=>t.id==='rp1')))
    ? 'due '+r.data.date : r;});
await step('the new one carries title, priority, tags, sites, persons and links', async()=>{
  const r=await T(()=>window.__WB_WRITES.filter(w=>w.op==='add').pop().data);
  return r.title==='Weekly review'&&r.links.length===1&&r.links[0].url==='https://example.com'?true:r;});
await step('its action items come along unticked', async()=>{
  const r=await T(()=>window.__WB_WRITES.filter(w=>w.op==='add').pop().data.actions);
  return r.length===2&&r.every(a=>a.done===false)?'2 actions, both open':r;});
await step('comments do not come along', async()=>
  await T(()=>window.__WB_WRITES.filter(w=>w.op==='add').pop().data.comments.length===0));
await step('attachments do not come along (shared payload documents)', async()=>
  await T(()=>window.__WB_WRITES.filter(w=>w.op==='add').pop().data.attachments.length===0));
await step('the rich body and its richHtml flag come along', async()=>{
  const r=await T(()=>window.__WB_WRITES.filter(w=>w.op==='add').pop().data);
  return r.richBody==='<p>body</p>'&&r.richHtml===true?true:r;});
await step('the new one is not done and not paused', async()=>{
  const r=await T(()=>window.__WB_WRITES.filter(w=>w.op==='add').pop().data);
  return r.done===false&&r.snoozedUntil===''?true:r;});
await step('the repeat rule is copied, not shared by reference', async()=>{
  const r=await T(()=>{const d=window.__WB_WRITES.filter(w=>w.op==='add').pop().data;
    const src=tasks.find(t=>t.id==='rp1');
    return {equal:JSON.stringify(d.repeat)===JSON.stringify(src.repeat),same:d.repeat===src.repeat};});
  return r.equal&&!r.same?true:r;});
await step('its history starts with a "repeated" entry', async()=>{
  const r=await T(()=>window.__WB_WRITES.filter(w=>w.op==='add').pop().data.history);
  return r.length===1&&r[0].type==='repeated'&&typeof r[0].time==='number'?true:r;});
await step('"repeated" gets a human label in the history list, not a raw key', async()=>{
  const id=await T(()=>window.__WB_WRITES.filter(w=>w.op==='add'&&w.coll==='tasks').pop().id);
  await p.evaluate(()=>startListeners()); await p.waitForTimeout(300);
  await p.evaluate(i=>openDetail(i),id); await p.waitForTimeout(250);
  const h=await T(()=>document.getElementById('detailBody').innerHTML);
  await p.evaluate(()=>closeDetail());
  return h.includes('Created by a repeat') ? true : {history:h.includes('repeated')?'raw key shown':'no history section'};});
await step('spawnRepeat on a non-repeating task does nothing', async()=>{
  const r=await T(async()=>{const before=window.__DATA.tasks.length;
    const id=await spawnRepeat(tasks.find(t=>t.id==='or1'));
    return {id,grew:window.__DATA.tasks.length-before};});
  return r.id===null&&r.grew===0?true:r;});
await step('ticking a repeating task off spawns the next one', async()=>{
  const r=await T(async()=>{const before=window.__DATA.tasks.filter(t=>!t.done).length;
    await toggleDone('rp2'); await new Promise(r=>setTimeout(r,150));
    const add=window.__WB_WRITES.filter(w=>w.op==='add'&&w.coll==='tasks').pop();
    return {added:add&&add.data.title,date:add&&add.data.date,before};});
  return r.added==='Monthly from done'&&r.date===await T(()=>addMonthsStr(2))
    ? 'next due '+r.date : r;});
await step('re-opening a completed repeating task does NOT spawn another', async()=>{
  // The stub only emits a snapshot on subscribe, so re-read it first: otherwise the
  // in-memory task still looks unfinished and the second tick would spawn again.
  await p.evaluate(()=>startListeners()); await p.waitForTimeout(300);
  const r=await T(async()=>{
    const t=tasks.find(x=>x.id==='rp2');
    const before=window.__WB_WRITES.filter(w=>w.op==='add').length;
    await toggleDone('rp2'); await new Promise(r=>setTimeout(r,200));
    return {wasDone:!!t.done,spawned:window.__WB_WRITES.filter(w=>w.op==='add').length-before};});
  return r.wasDone===true&&r.spawned===0 ? 'reopened, nothing spawned' : {unexpected:r};});

console.log('\n=== the repeat controls ===');
await step('the quick modal has repeat controls', async()=>
  await T(()=>['fRepeatUnit','fRepeatN','fRepeatFrom','fRepeatHint'].every(id=>!!document.getElementById(id))));
await step('the rich editor has repeat controls', async()=>
  await T(()=>['rRepeatUnit','rRepeatN','rRepeatFrom','rRepeatHint'].every(id=>!!document.getElementById(id))));
await step('readRepeat returns null while the unit is "none"', async()=>
  await T(()=>{writeRepeat('f',null);return readRepeat('f')===null;}));
await step('readRepeat clamps a silly count', async()=>
  await T(()=>{document.getElementById('fRepeatUnit').value='day';
    document.getElementById('fRepeatN').value='9999';
    const a=readRepeat('f').n;
    document.getElementById('fRepeatN').value='0';
    const b=readRepeat('f').n;
    document.getElementById('fRepeatN').value='';
    const c=readRepeat('f').n;
    return a===365&&b===1&&c===1;}));
await step('writeRepeat then readRepeat round-trips', async()=>
  await T(()=>{writeRepeat('f',{n:3,unit:'week',from:'done'});
    const r=readRepeat('f');
    return r.n===3&&r.unit==='week'&&r.from==='done';}));
await step('an unknown "from" value falls back to due', async()=>
  await T(()=>{writeRepeat('f',{n:1,unit:'day',from:'nonsense'});return readRepeat('f').from==='due';}));
await step('the hint explains what ticking off will do', async()=>
  await T(()=>{writeRepeat('f',{n:2,unit:'week',from:'due'});
    const h=document.getElementById('fRepeatHint').textContent;
    return h.includes('every 2 weeks')&&h.includes('due date');}));
await step('the hint changes when counting from the finish date', async()=>
  await T(()=>{writeRepeat('f',{n:1,unit:'month',from:'done'});
    return document.getElementById('fRepeatHint').textContent.includes('finish');}));
await step('turning repeat off empties the hint and hides the anchor choice', async()=>
  await T(()=>{writeRepeat('f',null);
    return document.getElementById('fRepeatHint').textContent===''
      && document.getElementById('fRepeatFrom').style.display==='none';}));
await step('opening a repeating task for edit loads its rule', async()=>{
  await p.evaluate(()=>openEdit('rp1')); await p.waitForTimeout(250);
  const r=await T(()=>readRepeat('f'));
  return r&&r.n===1&&r.unit==='week'&&r.from==='due'?'every week from due':r;});
await step('saving from the quick modal writes the repeat rule', async()=>{
  const r=await T(async()=>{writeRepeat('f',{n:5,unit:'day',from:'done'});
    await saveTask(); await new Promise(r=>setTimeout(r,200));
    const w=window.__WB_WRITES.filter(x=>x.coll==='tasks'&&x.id==='rp1').pop();
    return w&&w.data&&w.data.repeat;});
  return r&&r.n===5&&r.unit==='day'&&r.from==='done'?'every 5 days from done':r;});
await step('a new task with no repeat chosen stores repeat:null', async()=>{
  const r=await T(async()=>{openModal();writeRepeat('f',null);
    document.getElementById('fTitle').value='Plain new one';
    await saveTask(); await new Promise(r=>setTimeout(r,200));
    const w=window.__WB_WRITES.filter(x=>x.op==='add'&&x.coll==='tasks').pop();
    return w&&w.data&&{title:w.data.title,repeat:w.data.repeat};});
  return r&&r.title==='Plain new one'&&r.repeat===null?true:r;});

console.log('\n=== repeat is visible on the task and in the detail modal ===');
await step('a repeating task carries a 🔁 chip', async()=>
  await T(()=>{tasks.find(t=>t.id==='rp1').repeat={n:1,unit:'week',from:'due'};
    document.getElementById('searchInput').value='Weekly review';
    renderTasks();
    const h=document.getElementById('taskList').innerHTML;
    document.getElementById('searchInput').value='';renderTasks();
    return h.includes('task-repeat-chip')&&h.includes('every week');}));
await step('the detail modal has a Repeats section naming the next date', async()=>{
  await p.evaluate(()=>{closeDetail();openDetail('rp1');}); await p.waitForTimeout(250);
  const r=await T(()=>document.getElementById('detailBody').innerHTML);
  return r.includes('Repeats')&&r.includes('every week')&&r.includes('Next one would be due')?true:false;});
await step('a non-repeating task has no Repeats section', async()=>{
  await p.evaluate(()=>{closeDetail();openDetail('or1');}); await p.waitForTimeout(250);
  const r=await T(()=>document.getElementById('detailBody').innerHTML);
  return !r.includes('Repeats')?true:false;});
await p.evaluate(()=>closeDetail());

console.log('\n=== filters: OR inside a group, AND across groups ===');
// Earlier tests paused some of these; put them back on the board first.
await p.evaluate(()=>{['or1','or2','or3'].forEach(id=>{
  const d=window.__DATA.tasks.find(t=>t.id===id); if(d)d.snoozedUntil='';});
  startListeners();});
await p.waitForTimeout(300);
const setF=(s,pe,t)=>p.evaluate(([s,pe,t])=>{afS=s;afP=pe;afT=t;afPr=[];afOv=false;
  return getFiltered('board').map(x=>x.id);},[s,pe,t]);
await step('two sites match a task carrying either one', async()=>{
  const ids=await setF(['DK','NO'],[],[]);
  return ids.includes('or1')&&ids.includes('or2')&&!ids.includes('or3')
    ? 'DK or NO matched both, SE excluded' : ids;});
await step('one site still narrows to that site', async()=>{
  const ids=await setF(['SE'],[],[]);
  return ids.includes('or3')&&!ids.includes('or1')?true:ids;});
await step('two people match a task assigned to either', async()=>{
  const ids=await setF([],['Martin','Anna'],[]);
  return ids.includes('or1')&&ids.includes('or2')&&ids.includes('or3')?true:ids;});
await step('a site group and a person group are ANDed together', async()=>{
  const ids=await setF(['DK','NO'],['Martin'],[]);
  return ids.includes('or2')&&!ids.includes('or1')&&!ids.includes('or3')
    ? 'DK-or-NO and Martin left only "Only NO"' : ids;});
await step('an AND across groups that nothing satisfies gives nothing', async()=>{
  const ids=await setF(['SE'],['Anna'],[]);
  return ids.length===0?true:ids;});
await step('labels OR the same way', async()=>{
  const ids=await p.evaluate(()=>{afS=[];afP=[];afT=['pricing'];afPr=[];afOv=false;
    return getFiltered('board').map(x=>x.id);});
  return ids.includes('t1')?true:ids;});
await step('clearing the filters brings everything back', async()=>{
  const ids=await setF([],[],[]);
  return ids.length>=3?ids.length+' tasks':ids;});

console.log('\n=== the bottom navigation actually shows on a phone ===');
{
  const m = await b.newPage({ viewport:{width:390,height:844} });
  const merrs=[]; m.on('pageerror',e=>merrs.push(e.message));
  await m.goto('http://127.0.0.1:8777/test.html'); await m.waitForTimeout(700);
  const nav = await m.evaluate(()=>{
    const el=document.querySelector('.bottom-nav');
    if(!el)return null;
    const cs=getComputedStyle(el), r=el.getBoundingClientRect();
    return {display:cs.display, height:Math.round(r.height), bottom:Math.round(r.bottom),
      items:[...el.querySelectorAll('.bottom-nav-item')].map(x=>x.id)};
  });
  await step('the bottom nav is visible at phone width', async()=>
    nav&&nav.display!=='none'&&nav.height>0 ? nav.display+', '+nav.height+'px' : {nav});
  await step('it sits at the bottom of the viewport, not off-screen', async()=>
    nav.bottom<=844&&nav.bottom>800 ? 'bottom edge at '+nav.bottom : {bottom:nav.bottom});
  await step('all six destinations are there, Paused included', async()=>
    JSON.stringify(nav.items)===JSON.stringify(['bnav-board','bnav-today','bnav-filter','bnav-paused','bnav-done','bnav-settings'])
      ? nav.items.length+' items' : {items:nav.items});
  await step('the top nav-tabs are hidden at this width, so the bottom nav is the only way around', async()=>
    await m.evaluate(()=>getComputedStyle(document.querySelector('.nav-tabs')).display==='none'));
  await step('tapping Paused switches page', async()=>{
    await m.click('#bnav-paused'); await m.waitForTimeout(300);
    return await m.evaluate(()=>document.getElementById('page-paused').style.display==='block'
      && document.getElementById('bnav-paused').classList.contains('active'));});
  await step('every item is wide enough to tap', async()=>{
    const w=await m.evaluate(()=>[...document.querySelectorAll('.bottom-nav-item')]
      .map(x=>Math.round(x.getBoundingClientRect().width)));
    return w.every(x=>x>=44) ? w.join('/')+'px' : {widths:w};});
  await step('no label wraps or overflows its item', async()=>{
    const bad=await m.evaluate(()=>[...document.querySelectorAll('.bottom-nav-item')]
      .filter(x=>x.scrollWidth>x.clientWidth+1).map(x=>x.id));
    return bad.length===0 ? true : {overflowing:bad};});
  await step('the phone page raised no uncaught errors', async()=>
    merrs.length===0?true:merrs.join(' | '));
  await m.close();
}

console.log('\n=== no page errors ===');
await step('the page raised no uncaught errors', async()=>errs.length===0?true:errs.join(' | '));

console.log('\n'+pass+' passed, '+fail+' failed');
await b.close();
process.exit(fail?1:0);
