import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)('playwright');
// Use whatever chromium playwright installed, unless a prebuilt one is present (some
// sandboxes ship it at a fixed path and cannot download). WB_CHROMIUM overrides both.
const PREBUILT = '/opt/pw-browsers/chromium';
const exe = process.env.WB_CHROMIUM
  || (createRequire(import.meta.url)('fs').existsSync(PREBUILT) ? PREBUILT : null);
const b = await chromium.launch(exe ? { executablePath: exe } : {});
const ctx = await b.newContext({ viewport:{width:1400,height:960},
  permissions:['clipboard-read','clipboard-write'] });
const p = await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.goto('http://127.0.0.1:8777/test.html'); await p.waitForTimeout(700);
let pass=0,fail=0;
const step=async(n,f)=>{try{const r=await f();
  if(r===true){pass++;console.log('OK   '+n);}
  else if(typeof r==='string'){pass++;console.log('OK   '+n+' :: '+r);}
  else {fail++;console.log('FAIL '+n+(r&&r!==false?' :: '+JSON.stringify(r):''));}
}catch(e){fail++;console.log('FAIL '+n+' :: '+e.message);}};
const T = async fn => p.evaluate(fn);

// Every new tab the page tries to open, captured instead of actually navigating.
const opened=[];
await p.context().on('page', async pg => { opened.push(pg.url()); await pg.close().catch(()=>{}); });
await p.addInitScript(()=>{ window.__OPENED=[];
  const real=window.open;
  window.open=function(u,t,f){ window.__OPENED.push(u); return null; }; });
await p.reload(); await p.waitForTimeout(700);

await p.evaluate(()=>{
  const ts=ms=>({toMillis:()=>ms});
  const base=(id,o)=>Object.assign({id,title:id,note:'',priority:'none',date:'',sites:[],persons:[],
    tags:[],actions:[],links:[],attachments:[],comments:[],history:[],done:false,createdAt:ts(1787000000000)},o);
  window.__DATA.tasks.push(base('cu1',{title:'Rewrite the returns SOP',
    note:'Two paragraphs of plain note.',priority:'high',date:'2026-09-15',
    sites:['DK','NO'],persons:['Martin'],tags:['sop'],
    actions:[{text:'Draft it',assignee:'Martin',done:false},{text:'Review with Anna',assignee:'',done:true}]}));
  window.__DATA.tasks.push(base('cu2',{title:'Bare task'}));
  window.__DATA.tasks.push(base('cu3',{title:'Already sent',clickupSent:'2026-08-20',clickupArea:'🚀 Nexus',
    links:[{name:'ClickUp',url:'https://app.clickup.com/t/abc123'}]}));
  window.__DATA.tasks.push(base('cu4',{title:'Rich one',richBody:'<p>Formatted <b>body</b> here</p>',richHtml:true}));
  startListeners();
});
await p.waitForTimeout(500);

console.log('=== the dialog is reachable and carries no credentials ===');
await step('the detail modal has a ClickUp button', async()=>
  await T(()=>{const el=document.getElementById('detailClickupBtn');
    return !!el&&/openClickup/.test(el.getAttribute('onclick')||'');}));
await step('the page contains no ClickUp token or Authorization header', async()=>{
  const src = await p.content();
  const bad = ['pk_','Authorization','api.clickup.com'].filter(x=>src.includes(x));
  return bad.length===0 ? 'no token, no API host' : {found:bad};});
await step('the list URL points at NCS BO Team', async()=>
  await T(()=>CLICKUP_LIST_URL==='https://app.clickup.com/4575366/v/l/li/901202525470'
    && CLICKUP_LIST_NAME==='NCS BO Team'));
await step('all sixteen Areas are offered', async()=>{
  const n = await T(()=>CLICKUP_AREAS.length);
  return n===16 ? n+' areas' : {n};});

console.log('\n=== opening it for a task ===');
await p.evaluate(()=>openClickup('cu1')); await p.waitForTimeout(300);
await step('the dialog opens', async()=>
  await T(()=>!document.getElementById('clickupOverlay').classList.contains('hidden')));
await step('it names the task and the destination list', async()=>{
  const t = await T(()=>document.getElementById('cuSub').textContent);
  return /Rewrite the returns SOP/.test(t)&&/NCS BO Team/.test(t) ? t.trim() : {t};});
await step('the Area select is populated, with a no-Area option first', async()=>{
  const o = await T(()=>[...document.getElementById('cuArea').options].map(x=>x.value));
  return o.length===17&&o[0]==='' ? '17 options incl. blank' : {o:o.length,first:o[0]};});
await step('the task name field holds exactly the title', async()=>{
  const v = await T(()=>document.getElementById('cuTitle').value);
  return v==='Rewrite the returns SOP' ? v : {v};});
await step('the name field is read-only, so it cannot drift from the task', async()=>
  await T(()=>document.getElementById('cuTitle').readOnly===true));

console.log('\n=== the description block ===');
const body = async () => T(()=>document.getElementById('cuBody').value);
await step('it starts with the note body', async()=>{
  const v = await body();
  return v.startsWith('Two paragraphs of plain note.') ? v.split('\n')[0] : {v};});
await step('action items come across as a checklist, with assignees', async()=>{
  const v = await body();
  return v.includes('- [ ] Draft it (Martin)')&&v.includes('- [ ] Review with Anna') ? true : {v};});
await step('due date, sites, people, labels and priority are listed', async()=>{
  const v = await body();
  const want=['Due: 15/09/2026','Sites: DK, NO','People: Martin','Labels: sop','Priority: high'];
  const missing=want.filter(x=>!v.includes(x));
  return missing.length===0 ? true : {missing,v};});
await step('it says where it came from', async()=>(await body()).includes('From WorkBoard'));
await step('choosing an Area adds it to the block', async()=>{
  await p.selectOption('#cuArea','👨‍💻 Tech/AI'); await p.waitForTimeout(200);
  const v = await body();
  return v.includes('Area: 👨‍💻 Tech/AI') ? true : {v};});
await step('clearing the Area removes the line again', async()=>{
  await p.selectOption('#cuArea',''); await p.waitForTimeout(200);
  return !(await body()).includes('Area:') ? true : {v:await body()};});
await step('a bare task produces a short block, not empty headings', async()=>{
  await p.evaluate(()=>{closeClickup();openClickup('cu2');}); await p.waitForTimeout(300);
  const v = await body();
  return v==='From WorkBoard' ? JSON.stringify(v) : {v};});
await step('a formatted note is flattened to text, not HTML', async()=>{
  await p.evaluate(()=>{closeClickup();openClickup('cu4');}); await p.waitForTimeout(300);
  const v = await body();
  return v.includes('Formatted body here')&&!v.includes('<b>') ? v.split('\n')[0] : {v};});

console.log('\n=== copying ===');
await p.evaluate(()=>{closeClickup();openClickup('cu1');}); await p.waitForTimeout(300);
await step('the Copy button next to the name copies the title', async()=>{
  await p.locator('.cu-copy-row').first().locator('button').click();
  await p.waitForTimeout(300);
  const clip = await T(async()=>await navigator.clipboard.readText());
  return clip==='Rewrite the returns SOP' ? clip : {clip};});
await step('the button confirms, then goes back to its label', async()=>{
  const btn = p.locator('.cu-copy-row').first().locator('button');
  const during = await btn.textContent();
  await p.waitForTimeout(1600);
  const after = await btn.textContent();
  return /Copied/.test(during)&&after==='Copy' ? during.trim()+' -> '+after : {during,after};});
await step('the description Copy button copies the block', async()=>{
  await p.locator('.cu-copy-row').nth(1).locator('button').click();
  await p.waitForTimeout(300);
  const clip = await T(async()=>await navigator.clipboard.readText());
  return clip.includes('- [ ] Draft it (Martin)') ? 'block on the clipboard' : {clip};});
await step('copyText falls back rather than throwing when the clipboard API is gone', async()=>{
  const r = await T(async()=>{
    const real=navigator.clipboard;
    Object.defineProperty(navigator,'clipboard',{value:undefined,configurable:true});
    let threw=null,ok=null;
    try{ ok=await copyText('fallback probe'); }catch(e){ threw=String(e); }
    Object.defineProperty(navigator,'clipboard',{value:real,configurable:true});
    return {ok,threw};});
  return r.threw===null ? 'returned '+r.ok+', did not throw' : {r};});

console.log('\n=== "copy name and open the list" ===');
await step('it opens the ClickUp list in a new tab', async()=>{
  await p.evaluate(()=>{window.__OPENED=[];});
  await p.selectOption('#cuArea','📈 Analytics'); await p.waitForTimeout(150);
  await p.locator('#clickupOverlay .merge-foot .btn-primary').click();
  await p.waitForTimeout(600);
  const urls = await T(()=>window.__OPENED);
  return urls.length===1&&urls[0]===await T(()=>CLICKUP_LIST_URL) ? urls[0] : {urls};});
await step('it records the hand-over on the task, with the Area', async()=>{
  const w = await T(()=>window.__WB_WRITES.filter(x=>x.coll==='tasks'&&x.id==='cu1').pop());
  return w&&w.data.clickupSent===await T(()=>todayStr())&&w.data.clickupArea==='📈 Analytics'
    ? 'clickupSent='+w.data.clickupSent+', area='+w.data.clickupArea : {w};});
await step('it does not touch anything else on the task', async()=>{
  const w = await T(()=>window.__WB_WRITES.filter(x=>x.coll==='tasks'&&x.id==='cu1').pop());
  const keys = Object.keys(w.data).sort().join(',');
  return keys==='clickupArea,clickupSent,updatedAt' ? keys : {keys};});
await step('the chosen Area is remembered for the next task', async()=>{
  const v = await T(()=>localStorage.getItem('wb_clickup_area'));
  return v==='📈 Analytics' ? v : {v};});
await step('the next task opens with that Area preselected', async()=>{
  await p.evaluate(()=>{closeClickup();openClickup('cu2');}); await p.waitForTimeout(300);
  const v = await T(()=>document.getElementById('cuArea').value);
  return v==='📈 Analytics' ? v : {v};});
await step('a task that already went out shows its own Area instead', async()=>{
  await p.evaluate(()=>{closeClickup();startListeners();}); await p.waitForTimeout(400);
  await p.evaluate(()=>openClickup('cu3')); await p.waitForTimeout(300);
  const v = await T(()=>document.getElementById('cuArea').value);
  return v==='🚀 Nexus' ? v : {v};});
await step('and says when it was sent', async()=>{
  const t = await T(()=>document.getElementById('cuSub').textContent);
  return /Already sent/.test(t) ? t.trim().split('\n').pop() : {t};});
await step('its existing ClickUp link is prefilled', async()=>{
  const v = await T(()=>document.getElementById('cuLink').value);
  return v==='https://app.clickup.com/t/abc123' ? v : {v};});

console.log('\n=== linking the ClickUp task back ===');
await p.evaluate(()=>{closeClickup();openClickup('cu2');}); await p.waitForTimeout(300);
await step('an empty link field is refused', async()=>{
  const r = await T(async()=>{const before=window.__WB_WRITES.length;
    document.getElementById('cuLink').value='';
    await cuSaveLink(); await new Promise(r=>setTimeout(r,80));
    return {wrote:window.__WB_WRITES.length-before,toast:document.getElementById('toast').textContent};});
  return r.wrote===0&&/link/i.test(r.toast) ? r.toast : {r};});
await step('a non-ClickUp URL is refused', async()=>{
  const r = await T(async()=>{const before=window.__WB_WRITES.length;
    document.getElementById('cuLink').value='https://example.com/whatever';
    await cuSaveLink(); await new Promise(r=>setTimeout(r,80));
    return {wrote:window.__WB_WRITES.length-before,toast:document.getElementById('toast').textContent};});
  return r.wrote===0&&/ClickUp link/i.test(r.toast) ? r.toast : {r};});
await step('a bare host gets https:// and is accepted', async()=>{
  const r = await T(async()=>{
    document.getElementById('cuLink').value='app.clickup.com/t/xyz789';
    await cuSaveLink(); await new Promise(r=>setTimeout(r,150));
    return window.__WB_WRITES.filter(x=>x.coll==='tasks'&&x.id==='cu2').pop();});
  const l=r&&r.data.links&&r.data.links[0];
  return l&&l.url==='https://app.clickup.com/t/xyz789'&&l.name==='ClickUp' ? l.url : {r};});
await step('saving the link also records the hand-over if it had not been', async()=>{
  const r = await T(()=>window.__WB_WRITES.filter(x=>x.coll==='tasks'&&x.id==='cu2').pop());
  return r.data.clickupSent ? 'clickupSent='+r.data.clickupSent : {r};});
await step('it closes the dialog on success', async()=>
  await T(()=>document.getElementById('clickupOverlay').classList.contains('hidden')));
await step('a second link replaces the first rather than piling up', async()=>{
  const r = await T(async()=>{
    startListeners(); await new Promise(r=>setTimeout(r,250));
    openClickup('cu2');
    document.getElementById('cuLink').value='https://app.clickup.com/t/replaced';
    await cuSaveLink(); await new Promise(r=>setTimeout(r,200));
    return window.__WB_WRITES.filter(x=>x.coll==='tasks'&&x.id==='cu2').pop().data.links;});
  return r.length===1&&r[0].url.endsWith('replaced') ? '1 link, replaced' : {r};});
await step('a non-ClickUp link on the task is left alone', async()=>{
  const r = await T(async()=>{
    const d=window.__DATA.tasks.find(t=>t.id==='cu2');
    d.links=[{name:'Sheet',url:'https://example.com/s'}];
    startListeners(); await new Promise(r=>setTimeout(r,250));
    openClickup('cu2');
    document.getElementById('cuLink').value='https://app.clickup.com/t/keepboth';
    await cuSaveLink(); await new Promise(r=>setTimeout(r,200));
    return window.__WB_WRITES.filter(x=>x.coll==='tasks'&&x.id==='cu2').pop().data.links;});
  return r.length===2&&r.some(l=>l.name==='Sheet')&&r.some(l=>l.name==='ClickUp')
    ? 'kept both' : {r};});

console.log('\n=== where it shows up afterwards ===');
await step('the task row carries a ClickUp chip with the Area', async()=>
  await T(()=>{document.getElementById('searchInput').value='Already sent';
    renderTasks();
    const h=document.getElementById('taskList').innerHTML;
    document.getElementById('searchInput').value='';renderTasks();
    return h.includes('task-clickup-chip')&&h.includes('Nexus');}));
// cu2 was handed over earlier in this suite, so use cu4, which never was.
await step('a task never sent carries no chip', async()=>
  await T(()=>{document.getElementById('searchInput').value='Rich one';
    renderTasks();
    const h=document.getElementById('taskList').innerHTML;
    document.getElementById('searchInput').value='';renderTasks();
    return !h.includes('task-clickup-chip');}));
await step('the detail modal shows a ClickUp section with a working link', async()=>{
  await p.evaluate(()=>{closeClickup();openDetail('cu3');}); await p.waitForTimeout(350);
  const h = await T(()=>document.getElementById('detailBody').innerHTML);
  return h.includes('ClickUp')&&h.includes('app.clickup.com/t/abc123')&&h.includes('Send again')
    ? true : {snippet:h.slice(0,200)};});
await step('the link opens in a new tab with noopener', async()=>{
  const a = await T(()=>{const el=[...document.querySelectorAll('#detailBody a')]
      .find(x=>/clickup/.test(x.href));
    return el?{target:el.target,rel:el.rel}:null;});
  return a&&a.target==='_blank'&&/noopener/.test(a.rel) ? true : {a};});
await step('a task never sent has no ClickUp section', async()=>{
  await p.evaluate(()=>{closeDetail();openDetail('cu4');}); await p.waitForTimeout(350);
  const h = await T(()=>document.getElementById('detailBody').innerHTML);
  return !h.includes('detail-section-label">ClickUp') ? true : {h:h.slice(0,200)};});
await p.evaluate(()=>closeDetail());

console.log('\n=== Escape and Back close it before the detail modal ===');
await step('Escape closes the ClickUp dialog and leaves the detail modal open', async()=>{
  await p.evaluate(()=>openDetail('cu1')); await p.waitForTimeout(250);
  await p.evaluate(()=>openClickup()); await p.waitForTimeout(250);
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  const r = await T(()=>({cu:document.getElementById('clickupOverlay').classList.contains('hidden'),
    detail:document.getElementById('detailOverlay').classList.contains('hidden')}));
  return r.cu&&!r.detail ? 'dialog closed, detail still open' : {r};});
await step('Back does the same', async()=>{
  await p.evaluate(()=>openClickup()); await p.waitForTimeout(250);
  await p.goBack(); await p.waitForTimeout(400);
  const r = await T(()=>({cu:document.getElementById('clickupOverlay').classList.contains('hidden'),
    detail:document.getElementById('detailOverlay').classList.contains('hidden')}));
  return r.cu&&!r.detail ? true : {r};});
await p.evaluate(()=>closeDetail());

console.log('\n=== a merge keeps what pause and repeat added ===');
await step('the surviving task keeps its repeat rule through a merge', async()=>{
  const r = await T(()=>buildMergedData(
    {id:'a',title:'A',repeat:{n:2,unit:'week',from:'due'},sites:[],persons:[],tags:[],actions:[],links:[],attachments:[],comments:[],history:[]},
    {id:'b',title:'B',sites:[],persons:[],tags:[],actions:[],links:[],attachments:[],comments:[],history:[]},
    {title:'a',priority:'a',date:'a',text:'both',secAttach:true}).repeat);
  return r&&r.n===2&&r.unit==='week' ? 'every 2 weeks kept' : {r};});
await step("B's repeat rule is adopted only when A has none", async()=>{
  const r = await T(()=>buildMergedData(
    {id:'a',title:'A',sites:[],persons:[],tags:[],actions:[],links:[],attachments:[],comments:[],history:[]},
    {id:'b',title:'B',repeat:{n:1,unit:'month',from:'done'},sites:[],persons:[],tags:[],actions:[],links:[],attachments:[],comments:[],history:[]},
    {title:'a',priority:'a',date:'a',text:'both',secAttach:true}).repeat);
  return r&&r.unit==='month' ? 'adopted from B' : {r};});
await step('no repeat on either side stays null, not undefined', async()=>{
  const r = await T(()=>buildMergedData(
    {id:'a',title:'A',sites:[],persons:[],tags:[],actions:[],links:[],attachments:[],comments:[],history:[]},
    {id:'b',title:'B',sites:[],persons:[],tags:[],actions:[],links:[],attachments:[],comments:[],history:[]},
    {title:'a',priority:'a',date:'a',text:'both',secAttach:true}).repeat);
  return r===null ? true : {r};});
await step('the merged rule is a copy, not a reference to A', async()=>{
  const r = await T(()=>{const a={id:'a',title:'A',repeat:{n:3,unit:'day',from:'due'},sites:[],persons:[],tags:[],actions:[],links:[],attachments:[],comments:[],history:[]};
    const d=buildMergedData(a,{id:'b',title:'B',sites:[],persons:[],tags:[],actions:[],links:[],attachments:[],comments:[],history:[]},
      {title:'a',priority:'a',date:'a',text:'both',secAttach:true});
    return d.repeat===a.repeat;});
  return r===false ? true : {sameReference:r};});
await step('a merge keeps the ClickUp hand-over on the surviving task', async()=>{
  const r = await T(()=>buildMergedData(
    {id:'a',title:'A',clickupSent:'2026-08-01',clickupArea:'🎯 BO Excellence',sites:[],persons:[],tags:[],actions:[],links:[],attachments:[],comments:[],history:[]},
    {id:'b',title:'B',clickupSent:'2026-08-05',clickupArea:'🚀 Nexus',sites:[],persons:[],tags:[],actions:[],links:[],attachments:[],comments:[],history:[]},
    {title:'a',priority:'a',date:'a',text:'both',secAttach:true}));
  return r.clickupSent==='2026-08-01'&&r.clickupArea==='🎯 BO Excellence' ? "A's kept" : {r:{s:r.clickupSent,a:r.clickupArea}};});
await step("B's hand-over is inherited when A never went out", async()=>{
  const r = await T(()=>buildMergedData(
    {id:'a',title:'A',sites:[],persons:[],tags:[],actions:[],links:[],attachments:[],comments:[],history:[]},
    {id:'b',title:'B',clickupSent:'2026-08-05',clickupArea:'🚀 Nexus',sites:[],persons:[],tags:[],actions:[],links:[],attachments:[],comments:[],history:[]},
    {title:'a',priority:'a',date:'a',text:'both',secAttach:true}));
  return r.clickupSent==='2026-08-05'&&r.clickupArea==='🚀 Nexus' ? "inherited from B" : {r:{s:r.clickupSent,a:r.clickupArea}};});

console.log('\n=== a backup carries the new fields ===');
await step('export includes clickupSent, clickupArea and repeat', async()=>{
  const r = await T(()=>{
    const t=tasks.find(x=>x.id==='cu3');
    const w=taskForWrite?taskForWrite(t):t;
    return {sent:t.clickupSent,area:t.clickupArea,hasKey:'clickupSent' in t};});
  return r.sent==='2026-08-20'&&r.area==='🚀 Nexus' ? 'present on the task document' : {r};});

console.log('\n=== nothing broke ===');
await step('the page raised no uncaught errors', async()=>
  errs.length===0?true:errs.join(' | '));
await step('no request ever went to clickup.com', async()=>
  opened.length===0 ? 'no real navigation attempted' : {opened});

console.log('\n'+pass+' passed, '+fail+' failed');
await b.close();
process.exit(fail?1:0);
