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
const step=async(n,f)=>{try{const r=await f();if(r===false){fail++;console.log('FAIL '+n);}else{pass++;console.log('OK   '+n+(r!==true&&r!==undefined?' :: '+r:''));}}catch(e){fail++;console.log('FAIL '+n+' :: '+e.message);}};
const box=()=>p.evaluate(()=>{const im=document.getElementById('lightboxImg');const r=im.getBoundingClientRect();
  return {nat:im.naturalWidth+'x'+im.naturalHeight, rend:Math.round(r.width)+'x'+Math.round(r.height), cls:im.className};});

// register a SMALL screenshot (the case that used to render tiny) and a LARGE one
await p.evaluate(async ()=>{
  async function mk(w,h,label){
    const c=document.createElement('canvas'); c.width=w; c.height=h;
    const x=c.getContext('2d'); x.fillStyle='#fff'; x.fillRect(0,0,w,h);
    x.fillStyle='#000'; x.font='16px monospace';
    for(let i=0;i*24<h-20;i++) x.fillText(label+' line '+i+' small text', 12, 24+i*24);
    return c.toDataURL('image/png');
  }
  const small=await mk(420,260,'SMALL'), big=await mk(2000,1400,'BIG');
  const st=await makeThumb(small,'image/png'), bt=await makeThumb(big,'image/png');
  window.__DATA.attachments.push({id:'sm',name:'small-crop.png',type:'image/png',size:9000,data:small});
  window.__DATA.attachments.push({id:'bg',name:'big-shot.png',type:'image/png',size:400000,data:big});
  window.__DATA.tasks.push({id:'lbtask',title:'Lightbox test',note:'',priority:'none',date:'',
    sites:[],persons:[],tags:[],actions:[],links:[],comments:[],history:[],done:false,
    createdAt:{toMillis:()=>1787000000000},
    attachments:[{id:'sm',name:'small-crop.png',type:'image/png',size:9000,thumb:st},
                 {id:'bg',name:'big-shot.png',type:'image/png',size:400000,thumb:bt}]});
  startListeners();
});
await p.waitForTimeout(600);

console.log('=== a small screenshot now fills the screen ===');
await p.evaluate(()=>openDetail('lbtask')); await p.waitForTimeout(400);
await p.locator('.detail-attachments .task-attach-img').nth(0).click(); await p.waitForTimeout(900);
let m=await box();
await step('natural size is the small original', async()=> m.nat==='420x260');
await step('rendered much larger than natural (scaled up)', async()=>{
  const rw=parseInt(m.rend.split('x')[0]);
  if(rw<=1000){console.log('       rendered '+m.rend+' from '+m.nat);return false;}
  console.log('       rendered '+m.rend+' from natural '+m.nat);
  return true;});
await step('filename shown in the bar', async()=> await p.locator('#lightboxName').innerText());
await step('no stale loading state', async()=> !m.cls.includes('loading'));
await p.screenshot({path:'shot10-small-fit.png'});

console.log('\n=== 1:1 toggle for reading small text ===');
await p.locator('#lightboxZoomBtn').click(); await p.waitForTimeout(400);
m=await box();
await step('actual size renders at natural pixels', async()=> m.rend==='420x260' ? m.rend : 'got '+m.rend);
await step('button now offers Fit', async()=> (await p.locator('#lightboxZoomBtn').innerText()).includes('Fit'));
await p.locator('#lightboxZoomBtn').click(); await p.waitForTimeout(400);
await step('toggles back to fit', async()=> (await box()).cls.includes('fit'));

console.log('\n=== a large screenshot fits, and 1:1 lets you scroll it ===');
await p.evaluate(()=>closeLightbox()); await p.waitForTimeout(200);
await p.locator('.detail-attachments .task-attach-img').nth(1).click(); await p.waitForTimeout(1000);
m=await box();
await step('large image scaled down to fit', async()=>{
  const rw=parseInt(m.rend.split('x')[0]);
  console.log('       '+m.nat+' -> '+m.rend);
  return m.nat==='2000x1400' && rw<=1400 && rw>800;});
await p.locator('#lightboxZoomBtn').click(); await p.waitForTimeout(400);
await step('1:1 shows full pixels', async()=> (await box()).rend==='2000x1400');
await step('the stage can scroll to reach the rest', async()=>
  await p.evaluate(()=>{const st=document.querySelector('.lightbox-stage');return st.scrollWidth>st.clientWidth;}));
await p.screenshot({path:'shot11-big-actual.png'});

console.log('\n=== blurred placeholder while the full image loads ===');
await p.evaluate(()=>closeLightbox()); await p.waitForTimeout(200);
// clear the cache AND add latency, so the placeholder frame is observable
await p.evaluate(()=>{
  delete attachCache['sm'];
  const slow=(fn)=>function(){const r=fn.apply(this,arguments);
    const g=r.get.bind(r);
    r.get=function(){return new Promise(res=>setTimeout(()=>g().then(res),400));};
    return r;};
  const coll=db.collection.bind(db);
  db.collection=function(n){const c=coll(n); if(n==='attachments'){const d=c.doc.bind(c); c.doc=slow(d);} return c;};
});
await p.locator('.detail-attachments .task-attach-img').nth(0).click();
await p.waitForTimeout(30);
const first=await p.evaluate(()=>{const im=document.getElementById('lightboxImg');
  return {cls:im.className,status:document.getElementById('lightboxStatus').textContent};});
await step('first frame is the thumbnail, blurred and labelled', async()=>{
  console.log('       '+JSON.stringify(first));
  return first.cls.includes('loading') && first.status.includes('Loading');});
await p.waitForTimeout(1200);
await step('blur and label clear once loaded', async()=>{
  const after=await p.evaluate(()=>({cls:document.getElementById('lightboxImg').className,
    status:document.getElementById('lightboxStatus').textContent}));
  console.log('       '+JSON.stringify(after));
  // the status line now reports the real dimensions once the full image has decoded
  return !after.cls.includes('loading') && /\d+ × \d+/.test(after.status);});

console.log('\n=== the three ways out ===');
await p.evaluate(()=>closeLightbox()); await p.waitForTimeout(200);
await p.locator('.detail-attachments .task-attach-img').nth(0).click(); await p.waitForTimeout(700);
await step('clicking the image zooms rather than closing', async()=>{
  await p.locator('#lightboxImg').click(); await p.waitForTimeout(300);
  const open=await p.locator('#lightbox').isVisible();
  const cls=await p.evaluate(()=>document.getElementById('lightboxImg').className);
  return open && cls.includes('actual');});
await step('clicking the backdrop does close', async()=>{
  await p.mouse.click(8,8); await p.waitForTimeout(300);
  return (await p.locator('#lightbox').isVisible())===false;});
await step('the Close button closes', async()=>{
  await p.locator('.detail-attachments .task-attach-img').nth(0).click(); await p.waitForTimeout(600);
  await p.locator('.lightbox-bar .btn').last().click(); await p.waitForTimeout(300);
  return (await p.locator('#lightbox').isVisible())===false;});
await step('zoom resets to fit for the next image', async()=>{
  await p.locator('.detail-attachments .task-attach-img').nth(0).click(); await p.waitForTimeout(600);
  return (await p.evaluate(()=>document.getElementById('lightboxImg').className)).includes('fit');});

console.log('\n=== escape closes the lightbox, not the detail modal ===');
await p.keyboard.press('Escape'); await p.waitForTimeout(300);
await step('lightbox closed', async()=> (await p.locator('#lightbox').isVisible())===false);
await step('detail modal still open behind it', async()=> await p.locator('#detailOverlay').isVisible());

console.log('\n'+pass+' passed, '+fail+' failed');
console.log('page errors: '+(errs.length?JSON.stringify(errs.slice(0,4)):'none'));
await b.close();
process.exit(fail?1:0);
