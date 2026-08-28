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
const step=async(n,f)=>{try{const r=await f();if(r===false){fail++;console.log('FAIL '+n);}else{pass++;console.log('OK   '+n+(typeof r==='string'?' :: '+r:''));}}catch(e){fail++;console.log('FAIL '+n+' :: '+e.message);}};

console.log('=== thumbnails no longer degrade small images ===');
const t = await p.evaluate(async ()=>{
  async function mk(w,h){
    const c=document.createElement('canvas'); c.width=w; c.height=h;
    const x=c.getContext('2d'); x.fillStyle='#fff'; x.fillRect(0,0,w,h);
    x.fillStyle='#000'; x.font='11px monospace';
    for(let i=0;i*14<h-8;i++) x.fillText('tiny text line '+i, 4, 12+i*14);
    return c.toDataURL('image/png');
  }
  const tiny=await mk(120,101), mid=await mk(400,300), big=await mk(1600,1000);
  return {
    tiny:{src:tiny, thumb:await makeThumb(tiny,'image/png')},
    mid:{src:mid, thumb:await makeThumb(mid,'image/png')},
    big:{src:big, thumb:await makeThumb(big,'image/png')}
  };
});
await step('a 120x101 image keeps its original bytes as the thumbnail', async()=>
  t.tiny.thumb===t.tiny.src ? 'identical, no JPEG re-encode' : 'RE-ENCODED to '+t.tiny.thumb.slice(0,22));
await step('a 400x300 image is downscaled to a JPEG', async()=>
  t.mid.thumb.startsWith('data:image/jpeg') ? 'jpeg, '+Math.round(t.mid.thumb.length/1024)+'KB' : t.mid.thumb.slice(0,22));
await step('a 1600x1000 image is downscaled to a JPEG', async()=>
  t.big.thumb.startsWith('data:image/jpeg') ? 'jpeg, '+Math.round(t.big.thumb.length/1024)+'KB' : false);
await step('downscaled thumbnails stay small', async()=>
  t.big.thumb.length < 40000 ? Math.round(t.big.thumb.length/1024)+'KB' : 'too big');

console.log('\n=== upscaling is capped, and the bar says so ===');
await p.evaluate(async (fx)=>{
  window.__DATA.attachments.push({id:'tiny',name:'tiny-dialog.png',type:'image/png',size:4000,data:fx.tiny.src});
  window.__DATA.attachments.push({id:'mid',name:'mid-shot.png',type:'image/png',size:20000,data:fx.mid.src});
  window.__DATA.attachments.push({id:'big',name:'big-shot.png',type:'image/png',size:200000,data:fx.big.src});
  window.__DATA.tasks.push({id:'zt',title:'Zoom cap test',note:'',priority:'none',date:'',
    sites:[],persons:[],tags:[],actions:[],links:[],comments:[],history:[],done:false,
    createdAt:{toMillis:()=>1787000000000},
    attachments:[{id:'tiny',name:'tiny-dialog.png',type:'image/png',size:4000,thumb:fx.tiny.thumb},
                 {id:'mid',name:'mid-shot.png',type:'image/png',size:20000,thumb:fx.mid.thumb},
                 {id:'big',name:'big-shot.png',type:'image/png',size:200000,thumb:fx.big.thumb}]});
  startListeners();
}, t);
await p.waitForTimeout(600);
await p.evaluate(()=>openDetail('zt')); await p.waitForTimeout(400);

const measure = async (idx) => {
  await p.evaluate(()=>closeLightbox()); await p.waitForTimeout(150);
  await p.locator('.detail-attachments .task-attach-img').nth(idx).click(); await p.waitForTimeout(900);
  return p.evaluate(()=>{
    const im=document.getElementById('lightboxImg'); const r=im.getBoundingClientRect();
    return { nat:im.naturalWidth+'x'+im.naturalHeight, w:Math.round(r.width),
             factor:+(r.width/im.naturalWidth).toFixed(2),
             status:document.getElementById('lightboxStatus').textContent };});
};

let m = await measure(0);
console.log('       tiny:', JSON.stringify(m));
await step('120px image is not blown up 11x', async()=> m.factor<=3.01);
await step('it is still enlarged, just sanely', async()=> m.factor>=2.5);
await step('the bar reports size and enlargement', async()=>
  /120 × 101/.test(m.status) && /enlarged/.test(m.status) ? m.status : 'got: '+m.status);

m = await measure(1);
console.log('       mid: ', JSON.stringify(m));
await step('400px image enlarged within the cap', async()=> m.factor>1 && m.factor<=3.01);

m = await measure(2);
console.log('       big: ', JSON.stringify(m));
await step('1600px image is scaled DOWN to fit', async()=> m.factor<1);
await step('no enlargement note for a downscaled image', async()=>
  /1600 × 1000/.test(m.status) && !/enlarged/.test(m.status) ? m.status : 'got: '+m.status);

console.log('\n=== 1:1 still exact, and the readout follows ===');
await p.locator('#lightboxZoomBtn').click(); await p.waitForTimeout(400);
await step('actual size is exactly natural', async()=>{
  const r=await p.evaluate(()=>{const im=document.getElementById('lightboxImg');
    return {w:Math.round(im.getBoundingClientRect().width),nat:im.naturalWidth,
            status:document.getElementById('lightboxStatus').textContent};});
  return r.w===r.nat ? r.w+'px = natural, status "'+r.status+'"' : 'w='+r.w+' nat='+r.nat;});
await step('no inline max-width left over in actual mode', async()=>
  (await p.evaluate(()=>document.getElementById('lightboxImg').style.maxWidth))==='');

console.log('\n'+pass+' passed, '+fail+' failed');
console.log('page errors: '+(errs.length?JSON.stringify(errs.slice(0,4)):'none'));
await b.close();
process.exit(fail?1:0);
