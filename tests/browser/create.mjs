import { createRequire } from 'module';
const { chromium } = createRequire(import.meta.url)('playwright');
// Use whatever chromium playwright installed, unless a prebuilt one is present (some
// sandboxes ship it at a fixed path and cannot download). WB_CHROMIUM overrides both.
const PREBUILT = '/opt/pw-browsers/chromium';
const exe = process.env.WB_CHROMIUM
  || (createRequire(import.meta.url)('fs').existsSync(PREBUILT) ? PREBUILT : null);
const b = await chromium.launch(exe ? { executablePath: exe } : {});
const ctx = await b.newContext({ viewport:{width:1400,height:1000},
  permissions:['clipboard-read','clipboard-write'] });
const p = await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(e.message));
await p.addInitScript(()=>{ window.__OPENED=[]; window.open=function(u){window.__OPENED.push(u);return null;}; });
await p.goto('http://127.0.0.1:8777/test.html'); await p.waitForTimeout(700);
let pass=0,fail=0;
const step=async(n,f)=>{try{const r=await f();
  if(r===true){pass++;console.log('OK   '+n);}
  else if(typeof r==='string'){pass++;console.log('OK   '+n+' :: '+r);}
  else {fail++;console.log('FAIL '+n+(r&&r!==false?' :: '+JSON.stringify(r):''));}
}catch(e){fail++;console.log('FAIL '+n+' :: '+e.message);}};
const T = async (fn,arg) => (arg===undefined ? p.evaluate(fn) : p.evaluate(fn,arg));
const OWA = 'https://outlook.office365.com/owa/?ItemID=DKRYfmt07ELSZgnu18FM%2Fov29GNUbipw3AHOVcjqx4BIPWdkry5%3D&exvsurl=1&viewmodel=ReadMessageItem';

console.log('=== everything a new task needs is on the create screen ===');
await p.evaluate(()=>openModal()); await p.waitForTimeout(350);
await step('the quick modal has a Links field', async()=>
  await T(()=>!!document.getElementById('modalLinkUrl')&&!!document.getElementById('modalLinkName')));
await step('its placeholder advertises the Label | URL form', async()=>{
  const ph = await T(()=>document.getElementById('modalLinkUrl').placeholder);
  return /Label \| https/.test(ph) ? ph : {ph};});
await step('the label says a mail link is recognised', async()=>{
  const t = await T(()=>[...document.querySelectorAll('.form-label')]
    .map(x=>x.textContent).find(x=>/^Links/.test(x)));
  return /Outlook mail link is recognised/.test(t) ? t.trim() : {t};});
await step('it has a repeat control', async()=>
  await T(()=>!!document.getElementById('fRepeatUnit')));
await step('and a Save & ClickUp button', async()=>{
  const btns = await T(()=>[...document.querySelectorAll('.modal-footer button')].map(x=>x.textContent.trim()));
  return btns.some(x=>/Save & ClickUp/.test(x)) ? btns.join(' | ') : {btns};});

console.log('=== a mail link can be added while creating the task ===');
await step('pasting the OWA URL into the link field and pressing Enter adds it', async()=>{
  await p.fill('#modalLinkUrl', OWA);
  await p.press('#modalLinkUrl','Enter');
  await p.waitForTimeout(250);
  const links = await T(()=>fLinks);
  return links.length===1&&links[0].url===OWA&&links[0].name==='Mail'
    ? 'Mail, '+links[0].url.length+' chars' : {links};});
await step('the pending link is listed with the envelope icon', async()=>{
  const h = await T(()=>document.getElementById('modalLinksList').innerHTML);
  return h.includes('📧 Mail') ? true : {h};});
await step('Label | URL in the URL field alone names it', async()=>{
  await p.fill('#modalLinkUrl','Anna · Returflow | '+OWA.replace('ItemID=','ItemID=B'));
  await p.press('#modalLinkUrl','Enter'); await p.waitForTimeout(250);
  const links = await T(()=>fLinks);
  return links.length===2&&links[1].name==='Anna · Returflow' ? links[1].name : {links};});
await step('the fields are cleared after each add', async()=>
  await T(()=>document.getElementById('modalLinkUrl').value===''
    &&document.getElementById('modalLinkName').value===''));
await step('junk is refused here too, with a message', async()=>{
  await p.fill('#modalLinkUrl','javascript:alert(1)');
  await p.click('.link-add-row .btn'); await p.waitForTimeout(250);
  const r = await T(()=>({n:fLinks.length,toast:document.getElementById('toast').textContent}));
  return r.n===2&&/not a link/i.test(r.toast) ? r.toast : {r};});

console.log('=== saveTask now reports the id it wrote ===');
await step('creating a task returns its new id and data', async()=>{
  const r = await T(async()=>{
    document.getElementById('fTitle').value='Returflow — svar Anna';
    var out=await saveTask();
    return {id:out&&out.id,title:out&&out.data&&out.data.title,links:out&&out.data&&out.data.links.length};});
  return r.id&&r.title==='Returflow — svar Anna'&&r.links===2 ? 'id='+r.id : {r};});
await step('the links went with it', async()=>{
  const w = await T(()=>window.__WB_WRITES.filter(x=>x.op==='add'&&x.coll==='tasks').pop());
  return w.data.links.length===2&&w.data.links[0].url===OWA ? '2 links stored' : {w};});
await step('an empty title returns null instead of writing', async()=>{
  const r = await T(async()=>{openModal();
    const before=window.__WB_WRITES.length;
    var out=await saveTask();
    return {out,wrote:window.__WB_WRITES.length-before};});
  return r.out===null&&r.wrote===0 ? true : {r};});
await step('editing an existing task returns that task’s id, not a new one', async()=>{
  const r = await T(async()=>{openEdit('t1');
    var out=await saveTask();
    return out&&out.id;});
  return r==='t1' ? r : {r};});

console.log('=== Save & ClickUp goes straight into the dialog ===');
await step('it saves and opens the ClickUp dialog for the task just created', async()=>{
  const r = await T(async()=>{
    openModal();
    document.getElementById('fTitle').value='Nordic BO kapacitet';
    document.getElementById('fPriority').value='high';
    await saveTaskAndClickup();
    await new Promise(r=>setTimeout(r,250));
    return {open:!document.getElementById('clickupOverlay').classList.contains('hidden'),
            id:clickupTaskId, sub:document.getElementById('cuSub').textContent};});
  return r.open&&r.id&&/Nordic BO kapacitet/.test(r.sub) ? 'dialog open for '+r.id : {r};});
await step('the dialog works before the snapshot has landed', async()=>{
  const r = await T(()=>({title:document.getElementById('cuTitle').value,
    body:document.getElementById('cuBody').value}));
  return r.title==='Nordic BO kapacitet'&&/Priority: high/.test(r.body)
    ? 'name and description built from the fallback' : {r};});
await step('the task modal closed behind it', async()=>
  await T(()=>document.getElementById('taskOverlay').classList.contains('hidden')));
await step('choosing an Area re-renders the description', async()=>{
  await p.selectOption('#cuArea','📈 Analytics'); await p.waitForTimeout(200);
  const body = await T(()=>document.getElementById('cuBody').value);
  return /Area: 📈 Analytics/.test(body) ? true : {body};});
await step('Copy name & open the list records the hand-over on the new task', async()=>{
  const id = await T(()=>clickupTaskId);
  await p.click('#clickupOverlay .merge-foot .btn-primary'); await p.waitForTimeout(600);
  const r = await T(i=>({w:window.__WB_WRITES.filter(x=>x.coll==='tasks'&&x.id===i).pop(),
    opened:window.__OPENED.length}), id);
  return r.w&&r.w.data.clickupArea==='📈 Analytics'&&r.opened===1
    ? 'recorded on '+id : {r};});
await step('and the ClickUp link can be pasted back on it right away', async()=>{
  const id = await T(()=>clickupTaskId);
  await p.fill('#cuLink','https://app.clickup.com/t/newone');
  await p.click('#cuLink ~ button'); await p.waitForTimeout(500);
  const w = await T(i=>window.__WB_WRITES.filter(x=>x.coll==='tasks'&&x.id===i).pop(), id);
  return w&&w.data.links&&w.data.links.some(l=>l.url==='https://app.clickup.com/t/newone')
    ? 'linked' : {w};});
await step('an empty title makes Save & ClickUp do nothing at all', async()=>{
  const r = await T(async()=>{
    closeClickup();openModal();
    const before=window.__WB_WRITES.length;
    await saveTaskAndClickup();
    await new Promise(r=>setTimeout(r,200));
    return {wrote:window.__WB_WRITES.length-before,
      dialog:document.getElementById('clickupOverlay').classList.contains('hidden'),
      modal:document.getElementById('taskOverlay').classList.contains('hidden')};});
  return r.wrote===0&&r.dialog===true&&r.modal===false
    ? 'nothing written, task modal still open' : {r};});
await p.evaluate(()=>closeModal());

console.log('=== the same from the note editor ===');
await step('the note editor has a Save & ClickUp button', async()=>{
  const btns = await T(()=>[...document.querySelectorAll('.rich-footer button')].map(x=>x.textContent.trim()));
  return btns.some(x=>/Save & ClickUp/.test(x)) ? btns.join(' | ') : {btns};});
await step('its link field advertises the Label | URL form too', async()=>{
  const ph = await T(()=>document.getElementById('richLinkUrl').placeholder);
  return /Label \| https/.test(ph) ? true : {ph};});
await step('saveRichTask returns the new id', async()=>{
  const r = await T(async()=>{
    openRichEditor();
    document.getElementById('richTitle').value='Mødenotat 28/8';
    document.getElementById('richBody').innerHTML='<p>Aftalt: Anna skriver SOP.</p>';
    var out=await saveRichTask();
    return out&&out.id;});
  return r ? 'id='+r : {r};});
await step('Save & ClickUp from the note editor opens the dialog for it', async()=>{
  const r = await T(async()=>{
    openRichEditor();
    document.getElementById('richTitle').value='Returcenter Q4';
    document.getElementById('richBody').innerHTML='<p>Kapacitet og bemanding.</p>';
    await saveRichTaskAndClickup();
    await new Promise(r=>setTimeout(r,250));
    return {open:!document.getElementById('clickupOverlay').classList.contains('hidden'),
      title:document.getElementById('cuTitle').value,
      body:document.getElementById('cuBody').value};});
  return r.open&&r.title==='Returcenter Q4'&&/Kapacitet og bemanding/.test(r.body)
    ? 'dialog open, body flattened from the note' : {r};});
await step('the note editor closed behind it', async()=>
  await T(()=>document.getElementById('page-rich').style.display==='none'));
await step('an empty title makes it do nothing there too', async()=>{
  const r = await T(async()=>{
    closeClickup();openRichEditor();
    const before=window.__WB_WRITES.length;
    await saveRichTaskAndClickup();
    await new Promise(r=>setTimeout(r,200));
    return {wrote:window.__WB_WRITES.length-before,
      dialog:document.getElementById('clickupOverlay').classList.contains('hidden')};});
  return r.wrote===0&&r.dialog===true ? true : {r};});
await p.evaluate(()=>closeRichEditor());

console.log('=== the live task wins once its snapshot arrives ===');
await step('after startListeners the dialog reads the real task, not the fallback', async()=>{
  const r = await T(async()=>{
    const id=window.__DATA.tasks[window.__DATA.tasks.length-1].id;
    startListeners(); await new Promise(r=>setTimeout(r,300));
    openClickup(id,{id:id,title:'STALE FALLBACK',note:'',sites:[],persons:[],tags:[],actions:[],links:[]});
    return {shown:document.getElementById('cuTitle').value,
      real:tasks.find(t=>t.id===id).title};});
  return r.shown===r.real&&r.shown!=='STALE FALLBACK' ? 'showed "'+r.shown+'"' : {r};});
await step('the fallback is dropped when the dialog closes', async()=>
  await T(()=>{closeClickup();return clickupTaskFallback===null&&clickupTaskId===null;}));
await step('openClickup with an unknown id and no fallback refuses', async()=>{
  const r = await T(()=>{openClickup('does-not-exist');
    return {open:!document.getElementById('clickupOverlay').classList.contains('hidden'),
      toast:document.getElementById('toast').textContent};});
  return r.open===false&&/not found/i.test(r.toast) ? r.toast : {r};});
await step('a fallback for a different id is ignored', async()=>{
  const r = await T(()=>{openClickup('does-not-exist',{id:'someone-else',title:'X'});
    return !document.getElementById('clickupOverlay').classList.contains('hidden');});
  return r===false ? true : {r};});

console.log('=== nothing broke ===');
await step('the page raised no uncaught errors', async()=>
  errs.length===0?true:errs.join(' | '));

console.log('\n'+pass+' passed, '+fail+' failed');
await b.close();
process.exit(fail?1:0);
