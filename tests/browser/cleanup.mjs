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
const ctx = await b.newContext({ viewport:{width:1500,height:1000}, timezoneId:'Europe/Copenhagen' });
const p = await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
p.on('console',m=>{if(m.type()==='error'&&!m.text().includes('404'))errs.push(m.text());});
await p.goto('http://127.0.0.1:8777/test.html'); await p.waitForTimeout(700);
let pass=0,fail=0;
const step=async(n,f)=>{try{const r=await f();if(r===false){fail++;console.log('FAIL '+n);}else{pass++;console.log('OK   '+n+(r!==true&&r!==undefined?' :: '+r:''));}}catch(e){fail++;console.log('FAIL '+n+' :: '+e.message);}};
const writes=()=>p.evaluate(()=>window.__WB_WRITES);
const clearW=()=>p.evaluate(()=>{window.__WB_WRITES=[];});

console.log('=== no library left behind ===');
await step('SortableJS not requested', async()=> await p.evaluate(()=>typeof window.Sortable==='undefined'));

console.log('\n=== grid view controls (were dead) ===');
await p.evaluate(()=>setViewMode('grid')); await p.waitForTimeout(400);
await step('grid cards rendered', async()=> await p.locator('.task-card-grid').count());
// Grid cards used to emit a checkbox and edit buttons that CSS hid with no hover rule --
// rendered, never reachable. In August 2026 the markup was deleted rather than revealed,
// because a hover rule does nothing on a phone and the card already opens the detail
// modal. These assert the markup is gone, so it cannot creep back in unnoticed.
await step('grid cards no longer emit a hidden checkbox', async()=>
  (await p.locator('#tc-t1 .card-check').count())===0 ? true
    : {found:await p.locator('#tc-t1 .card-check').count()});
await step('grid cards no longer emit hidden edit buttons', async()=>
  (await p.locator('#tc-t1 .card-actions').count())===0 ? true
    : {found:await p.locator('#tc-t1 .card-actions').count()});
await step('the .card-check / .card-actions CSS rules are gone too', async()=>{
  const left = await p.evaluate(()=>{
    const hits=[];
    for (const sheet of document.styleSheets) {
      let rules; try { rules = sheet.cssRules; } catch(e){ continue; }
      for (const r of rules) if (r.selectorText && /\.card-(check|actions)\b/.test(r.selectorText)) hits.push(r.selectorText);
    }
    return hits;
  });
  return left.length===0 ? true : {leftover:left};});
await step('a grid card still renders its title, tags and date', async()=>{
  const txt = await p.locator('#tc-t1').innerText();
  return /Plain old note/.test(txt) ? txt.split('\n')[0] : {txt};});
await clearW();
await step('grid card click still opens the detail modal', async()=>{
  await p.locator('#tc-t2').click(); await p.waitForTimeout(400);
  const open = await p.locator('#detailOverlay').isVisible();
  await p.evaluate(()=>closeDetail());
  return open;});
await p.evaluate(()=>setViewMode('list')); await p.waitForTimeout(300);

console.log('\n=== attachment lightbox (was dead) ===');
await step('row thumbnail has a parseable handler', async()=>{
  const h=await p.locator('#tc-t1 .task-attach-img').first().getAttribute('onclick');
  return h && h.includes("showTaskAttachLightbox('t1'") ? h : false;});
await p.locator('#tc-t1 .task-attach-img').first().click(); await p.waitForTimeout(350);
await step('lightbox opens from a task row', async()=> await p.locator('#lightbox').isVisible());
await step('lightbox shows the image', async()=>
  (await p.locator('#lightboxImg').getAttribute('src')||'').startsWith('data:image/png'));
await p.keyboard.press('Escape'); await p.waitForTimeout(250);
await step('lightbox closes', async()=> await p.locator('#lightbox').isVisible()===false);
await p.evaluate(()=>openDetail('t1')); await p.waitForTimeout(400);
await p.locator('.detail-attachments .task-attach-img').first().click(); await p.waitForTimeout(350);
await step('lightbox opens from the detail modal too', async()=> await p.locator('#lightbox').isVisible());
await p.keyboard.press('Escape'); await p.waitForTimeout(200);

console.log('\n=== completing from the detail modal records history ===');
await clearW();
await p.evaluate(()=>{openDetail('t2');}); await p.waitForTimeout(350);
await p.locator('#detailCheck').click(); await p.waitForTimeout(500);
await step('history entry written', async()=>{
  const w=(await writes()).filter(x=>x.op==='update'&&x.id==='t2');
  const h=w.length?w[0].data.history:null;
  return h && h[h.length-1].type==='completed' ? 'completed logged' : false;});
await p.evaluate(()=>closeDetail()); await p.waitForTimeout(200);

console.log('\n=== Ctrl+K now matches its label ===');
await p.keyboard.press('Control+k'); await p.waitForTimeout(300);
await step('Ctrl+K focuses the search box', async()=>
  await p.evaluate(()=>document.activeElement&&document.activeElement.id==='searchInput'));
await step('Ctrl+K did not open the task modal', async()=> await p.locator('#taskOverlay').isVisible()===false);
await p.keyboard.press('Control+Shift+k'); await p.waitForTimeout(350);
await step('Ctrl+Shift+K opens a new task', async()=>
  (await p.locator('#taskOverlay').isVisible()) && (await p.locator('#modalTitle').innerText())==='+ Task');
await p.evaluate(()=>closeModal()); await p.waitForTimeout(250);

console.log('\n=== Today drag-to-reorder (threw a ReferenceError before) ===');
await p.evaluate(()=>{toggleTodayPanel();}); await p.waitForTimeout(400);
await step('three pinned items shown', async()=> await p.locator('#todayFocusList .today-item').count()===3);
await step('order before', async()=>
  (await p.locator('#todayFocusList .today-item-title').allInnerTexts()).join(' | '));
await clearW();
const src0 = p.locator('#todayFocusList .today-item').nth(0);
const dst2 = p.locator('#todayFocusList .today-item').nth(2);
await src0.hover(); await p.mouse.down();
await dst2.hover(); await p.mouse.move(10,10,{steps:3}); await dst2.hover();
await p.mouse.up(); await p.waitForTimeout(600);
await step('no ReferenceError raised', async()=> !errs.some(e=>e.includes('todayDrag')||e.includes('todayDrop')));
await step('order after the drag', async()=>
  (await p.locator('#todayFocusList .today-item-title').allInnerTexts()).join(' | '));
await step('reorder persisted to meta/todayFocus', async()=>{
  const w=(await writes()).filter(x=>x.op==='set'&&x.id==='todayFocus');
  return w.length ? w.length+' write(s)' : false;});
await step('drag classes cleaned up', async()=>
  (await p.locator('.today-item.dragging, .today-item.drag-over').count())===0);

console.log('\n=== labels with quotes no longer break the filter chips ===');
await p.evaluate(()=>{
  window.__DATA.tasks.push({id:'tq',title:'Quoted label task',note:'',priority:'none',date:'',
    sites:[],persons:[],tags:['Say "hi" & <go>'],actions:[],links:[],attachments:[],
    comments:[],history:[],done:false,createdAt:{toMillis:()=>1787000000000}});
  startListeners();
}); await p.waitForTimeout(600);
await step('chip rendered for the nasty label', async()=>
  (await p.locator('.fchip.ft').allInnerTexts()).some(t=>t.includes('Say')));
await step('clicking it filters without a JS error', async()=>{
  const before=errs.length;
  const chip=p.locator('.fchip.ft').filter({hasText:'Say'}).first();
  await chip.click(); await p.waitForTimeout(400);
  return errs.length===before;});

console.log('\n'+pass+' passed, '+fail+' failed');
console.log('page errors: '+(errs.length?JSON.stringify(errs.slice(0,5)):'none'));
await b.close();
process.exit(fail?1:0);
