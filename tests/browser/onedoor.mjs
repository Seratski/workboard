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

await p.evaluate(()=>{
  const ts=ms=>({toMillis:()=>ms});
  const base=(id,o)=>Object.assign({id,title:id,note:'',priority:'none',date:'',sites:[],persons:[],
    tags:[],actions:[],links:[],attachments:[],comments:[],history:[],done:false,createdAt:ts(1787000000000)},o);
  window.__DATA.tasks.push(base('od1',{title:'Plain one',note:'Just a short note.'}));
  window.__DATA.tasks.push(base('od2',{title:'Formatted one',note:'Heading Bold bit',
    richBody:'<h1>Heading</h1><p><b>Bold bit</b> and more</p>',richHtml:true}));
  window.__DATA.tasks.push(base('od3',{title:'Legacy plain rich',note:'old plain body',
    richBody:'old plain body, stored as text'}));
  startListeners();
});
await p.waitForTimeout(500);

console.log('=== one way in ===');
await step('the top bar has only one create button', async()=>{
  const btns = await T(()=>[...document.querySelectorAll('.top-right button')]
    .map(x=>x.textContent.trim()).filter(x=>/^\+/.test(x)));
  return btns.length===1&&btns[0]==='+ Task' ? btns.join(', ') : {btns};});
await step('the mobile action bar has only one too', async()=>{
  const btns = await T(()=>[...document.querySelectorAll('.mob-action-bar button')]
    .map(x=>x.textContent.trim()));
  return btns.length===1&&btns[0]==='+ Task' ? btns.join(', ') : {btns};});
await step('nothing calls openRichEditor(null) from the chrome any more', async()=>{
  const html = await p.content();
  return !html.includes('openRichEditor(null)') ? true : 'still referenced';});
await step('the empty state no longer mentions a second button', async()=>{
  const html = await p.content();
  return !html.includes('Rich task') ? true : 'still mentions "Rich task"';});
await step('Ctrl+Shift+K still opens the quick modal', async()=>{
  await p.keyboard.press('Control+Shift+K'); await p.waitForTimeout(300);
  const open = await T(()=>!document.getElementById('taskOverlay').classList.contains('hidden'));
  await p.evaluate(()=>closeModal());
  return open;});

console.log('=== plain text becomes paragraphs, not one blob ===');
await step('a single line becomes one paragraph', async()=>
  await T(()=>plainToHtml('One line')==='<p>One line</p>'));
await step('a blank line starts a new paragraph', async()=>
  await T(()=>plainToHtml('First\n\nSecond')==='<p>First</p><p>Second</p>'));
await step('a single newline becomes a break, keeping the shape', async()=>
  await T(()=>plainToHtml('Line one\nLine two')==='<p>Line one<br>Line two</p>'));
await step('three or more blank lines still make two paragraphs', async()=>
  await T(()=>plainToHtml('A\n\n\n\nB')==='<p>A</p><p>B</p>'));
await step('CRLF is handled', async()=>
  await T(()=>plainToHtml('A\r\n\r\nB')==='<p>A</p><p>B</p>'));
await step('empty and whitespace give nothing at all', async()=>
  await T(()=>plainToHtml('')===''&&plainToHtml('   \n  ')===''&&plainToHtml(null)===''));
await step('HTML in the plain note is escaped, not executed', async()=>{
  const r = await T(()=>plainToHtml('<script>alert(1)</script> & <b>x</b>'));
  return r==='<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; &lt;b&gt;x&lt;/b&gt;</p>' ? true : {r};});

console.log('=== the escalation carries everything ===');
await step('the quick modal offers "Write on a full page"', async()=>{
  await p.evaluate(()=>openModal()); await p.waitForTimeout(300);
  const btn = await T(()=>{const el=document.querySelector('.expand-note');
    return el?{text:el.textContent.trim(),onclick:el.getAttribute('onclick')}:null;});
  // Assert the exact label: the first version rendered a literal \u2197 because a JS escape
  // had been written into HTML text, and a loose /full page/ match sailed straight past it.
  return btn&&btn.text==='Write on a full page \u2197'&&/expandToRichEditor/.test(btn.onclick)
    ? btn.text : {btn};});
// Two spellings of the same mistake. \uXXXX in HTML text renders verbatim; \UXXXXXXXX in a
// JavaScript string is not an escape at all, so the backslash is dropped and the codepoint
// itself becomes the text. Both have shipped in this file. Catch both.
await step('no stray unicode escape survives anywhere in the rendered page', async()=>{
  const stray = await T(()=>{
    // Skip script and style: their source legitimately contains \uXXXX escapes.
    const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,{
      acceptNode:n=>/^(SCRIPT|STYLE)$/.test(n.parentNode&&n.parentNode.nodeName)
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT});
    const hits=[];let node;
    while((node=walker.nextNode()))
      if(/\\u[0-9a-fA-F]{4}|\b[Uu]000[0-9a-fA-F]{4,5}\b/.test(node.nodeValue||''))
        hits.push(node.nodeValue.trim().slice(0,60));
    return hits;});
  return stray.length===0 ? 'none' : {stray};});
await step('everything typed comes across', async()=>{
  const r = await T(async()=>{
    document.getElementById('fTitle').value='Returcenter Q4';
    document.getElementById('fNote').value='Første afsnit.\n\nAndet afsnit med\nto linjer.';
    document.getElementById('fPriority').value='high';
    document.getElementById('fDate').value=addDaysStr(5);
    writeRepeat('f',{n:2,unit:'week',from:'due'});
    fSites=['DK','NO']; fPersons=['Martin']; fProjects=['sop'];
    fActions=[{text:'Ring til Anna',assignee:'Martin',done:false}];
    fLinks=[{name:'Mail',url:'https://outlook.office365.com/owa/?ItemID=X'}];
    modalAttachments=[{name:'a.png',type:'image/png',size:10,thumb:'data:image/png;base64,x',fullData:'data:image/png;base64,x'}];
    expandToRichEditor();
    await new Promise(r=>setTimeout(r,250));
    return {
      page:document.getElementById('page-rich').style.display,
      title:document.getElementById('richTitle').value,
      body:document.getElementById('richBody').innerHTML,
      priority:document.getElementById('richPriority').value,
      date:document.getElementById('richDate').value,
      repeat:readRepeat('r'),
      sites:rSites, persons:rPersons, tags:rProjects,
      actions:rActions.length, links:rLinks.length, attach:richAttachments.length,
      editing:richEditingId, status:document.getElementById('richTaskStatus').textContent};});
  const okAll = r.page!=='none' && r.title==='Returcenter Q4'
    && r.body==='<p>Første afsnit.</p><p>Andet afsnit med<br>to linjer.</p>'
    && r.priority==='high' && r.repeat&&r.repeat.n===2&&r.repeat.unit==='week'
    && JSON.stringify(r.sites)==='["DK","NO"]' && JSON.stringify(r.persons)==='["Martin"]'
    && JSON.stringify(r.tags)==='["sop"]'
    && r.actions===1 && r.links===1 && r.attach===1 && r.editing===null;
  return okAll ? 'title, body as 2 paragraphs, priority, date, repeat, 2 sites, 1 person, 1 label, 1 action, 1 link, 1 attachment' : {r};});
await step('it says the task is still an unsaved draft', async()=>{
  const t = await T(()=>document.getElementById('richTaskStatus').textContent);
  return /not saved yet/i.test(t) ? t : {t};});
await step('the quick modal closed behind it', async()=>
  await T(()=>document.getElementById('taskOverlay').classList.contains('hidden')));
await step('and left NO leftover draft to reappear later', async()=>{
  const d = await T(()=>localStorage.getItem('wb_task_draft'));
  return d===null ? 'no wb_task_draft' : {d};});
await step('the moved task saves as a formatted task', async()=>{
  const r = await T(async()=>{
    const out=await saveRichTask();
    const w=window.__WB_WRITES.filter(x=>x.op==='add'&&x.coll==='tasks').pop();
    return {id:out&&out.id,richHtml:w.data.richHtml,body:w.data.richBody,
      note:w.data.note,sites:w.data.sites,repeat:w.data.repeat};});
  return r.richHtml===true&&/Første afsnit/.test(r.body)&&/Første afsnit/.test(r.note)
    &&JSON.stringify(r.sites)==='["DK","NO"]'&&r.repeat.n===2 ? 'saved with richHtml' : {r};});
await step('a normal + Task still reads its own draft, unaffected', async()=>{
  const r = await T(async()=>{
    openModal();
    document.getElementById('fTitle').value='Abandoned draft';
    closeModal();
    const stored=JSON.parse(localStorage.getItem('wb_task_draft')||'null');
    localStorage.removeItem('wb_task_draft');
    return stored&&stored.title;});
  return r==='Abandoned draft' ? 'draft still saved on a normal close' : {r};});

console.log('=== escalating an existing task upgrades it in place ===');
await step('editing a plain task and expanding keeps editing that task', async()=>{
  const r = await T(async()=>{
    openEdit('od1');
    expandToRichEditor();
    await new Promise(r=>setTimeout(r,250));
    return {editing:richEditingId,title:document.getElementById('richTitle').value,
      body:document.getElementById('richBody').innerHTML,
      status:document.getElementById('richTaskStatus').textContent};});
  return r.editing==='od1'&&r.title==='Plain one'&&r.body==='<p>Just a short note.</p>'
    &&/Editing saved task/.test(r.status) ? 'still editing od1' : {r};});
// The whole point of the fix: an unsaved change made in the quick modal must survive the
// move. The first version reloaded from the stored task and threw it away.
await step('an unsaved change made before expanding is NOT thrown away', async()=>{
  const r = await T(async()=>{
    openEdit('od1');
    document.getElementById('fTitle').value='Plain one, retitled';
    document.getElementById('fNote').value='Typed just now, not yet saved.';
    document.getElementById('fPriority').value='high';
    fSites=['SE'];
    expandToRichEditor();
    await new Promise(r=>setTimeout(r,250));
    return {editing:richEditingId,title:document.getElementById('richTitle').value,
      body:document.getElementById('richBody').innerHTML,
      priority:document.getElementById('richPriority').value, sites:rSites};});
  return r.editing==='od1'&&r.title==='Plain one, retitled'
    &&r.body==='<p>Typed just now, not yet saved.</p>'&&r.priority==='high'
    &&JSON.stringify(r.sites)==='["SE"]' ? 'the unsaved edit came across' : {r};});
await step('the cursor lands in the body, ready to keep writing', async()=>{
  await p.waitForTimeout(200);
  const id = await T(()=>document.activeElement&&document.activeElement.id);
  return id==='richBody' ? id : {id};});
await step('saving from there turns it into a formatted task, same document', async()=>{
  const r = await T(async()=>{
    document.getElementById('richBody').innerHTML='<p>Now with <b>formatting</b>.</p>';
    const out=await saveRichTask();
    const w=window.__WB_WRITES.filter(x=>x.coll==='tasks'&&x.id==='od1').pop();
    return {id:out&&out.id,op:w.op,richHtml:w.data.richHtml,body:w.data.richBody};});
  return r.id==='od1'&&r.op==='update'&&r.richHtml===true&&/formatting/.test(r.body)
    ? 'od1 updated in place' : {r};});

console.log('=== one editing door per task ===');
await step('the detail modal no longer has a separate "Open note" button', async()=>{
  const html = await p.content();
  return !html.includes('detailRichBtn')&&!html.includes('richFromDetail') ? true : 'still there';});
await step('Edit on a plain task opens the quick modal', async()=>{
  const r = await T(async()=>{
    startListeners(); await new Promise(r=>setTimeout(r,250));
    openDetail('od2'); return null;});
  await p.evaluate(()=>{closeDetail();openDetail('t3');}); await p.waitForTimeout(250);
  const which = await T(async()=>{
    editFromDetail(); await new Promise(r=>setTimeout(r,250));
    return {modal:!document.getElementById('taskOverlay').classList.contains('hidden'),
      rich:document.getElementById('page-rich').style.display!=='none'};});
  await p.evaluate(()=>closeModal());
  return which.modal&&!which.rich ? 'quick modal' : {which};});
await step('Edit on a formatted task opens the full-page editor instead', async()=>{
  await p.evaluate(()=>openDetail('od2')); await p.waitForTimeout(250);
  const which = await T(async()=>{
    editFromDetail(); await new Promise(r=>setTimeout(r,250));
    return {modal:!document.getElementById('taskOverlay').classList.contains('hidden'),
      rich:document.getElementById('page-rich').style.display!=='none',
      editing:richEditingId,
      body:document.getElementById('richBody').innerHTML};});
  return !which.modal&&which.rich&&which.editing==='od2'&&/Bold bit/.test(which.body)
    ? 'full-page editor, formatting intact' : {which};});
await step('a legacy plain-text richBody also opens in the full page', async()=>{
  await p.evaluate(()=>{closeRichEditor();openDetail('od3');}); await p.waitForTimeout(250);
  const which = await T(async()=>{
    editFromDetail(); await new Promise(r=>setTimeout(r,250));
    return {rich:document.getElementById('page-rich').style.display!=='none',
      editing:richEditingId, text:document.getElementById('richBody').innerText};});
  return which.rich&&which.editing==='od3'&&/old plain body/.test(which.text)
    ? 'opened as text, not markup' : {which};});
await p.evaluate(()=>closeRichEditor());

console.log('=== the edit that used to vanish ===');
// Editing a formatted task through the quick modal wrote `note`, which the detail modal
// never shows, so the change was saved and never seen again. Edit no longer goes there.
await step('the quick modal is not reachable for a formatted task via Edit', async()=>{
  await p.evaluate(()=>openDetail('od2')); await p.waitForTimeout(250);
  const r = await T(async()=>{
    editFromDetail(); await new Promise(r=>setTimeout(r,250));
    return document.getElementById('taskOverlay').classList.contains('hidden');});
  await p.evaluate(()=>closeRichEditor());
  return r===true ? 'quick modal stayed shut' : {r};});
await step('an edit made in the full page IS shown afterwards', async()=>{
  const r = await T(async()=>{
    openRichEditor('od2');
    await new Promise(r=>setTimeout(r,200));
    document.getElementById('richBody').innerHTML='<p>THIS SHOULD BE VISIBLE</p>';
    await saveRichTask();
    startListeners(); await new Promise(r=>setTimeout(r,300));
    openDetail('od2'); await new Promise(r=>setTimeout(r,200));
    const shown=document.getElementById('detailBody').innerText;
    closeDetail();
    return shown.includes('THIS SHOULD BE VISIBLE');});
  return r===true ? true : {r};});

console.log('=== nothing broke ===');
await step('the page raised no uncaught errors', async()=>
  errs.length===0?true:errs.join(' | '));

console.log('\n'+pass+' passed, '+fail+' failed');
await b.close();
process.exit(fail?1:0);
