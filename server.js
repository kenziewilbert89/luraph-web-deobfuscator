'use strict';
const express=require('express');
const multer=require('multer');
const rateLimit=require('express-rate-limit');
const fs=require('fs');
const fsp=fs.promises;
const path=require('path');
const os=require('os');
const crypto=require('crypto');
const {spawn}=require('child_process');

const PORT=Number(process.env.PORT||3000);
const MAX_BYTES=Number(process.env.MAX_UPLOAD_BYTES||8*1024*1024);
const TIMEOUT_MS=Number(process.env.DEOB_TIMEOUT_MS||15*60*1000);
const MAX_QUEUE=Number(process.env.MAX_QUEUE||10);
const ROOT=path.resolve(__dirname,'engine');
const TMP=path.join(os.tmpdir(),'luraph-web');
fs.mkdirSync(TMP,{recursive:true});

const app=express();
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY==='1');
app.use(express.json({limit:'32kb'}));
app.use('/api/',rateLimit({windowMs:60*1000,max:Number(process.env.RATE_LIMIT||10),standardHeaders:true,legacyHeaders:false}));

const upload=multer({
  storage:multer.diskStorage({destination:(req,file,cb)=>{const d=fs.mkdtempSync(path.join(TMP,'upload-')); req.jobDir=d; cb(null,d)},filename:(req,file,cb)=>cb(null,'input.lua')}),
  limits:{fileSize:MAX_BYTES,files:1},
  fileFilter:(req,file,cb)=>cb(null,/\.(lua|luau|txt)$/i.test(file.originalname))
});

let active=0; const queue=[];
function enqueue(job){return new Promise((resolve,reject)=>{if(active>=1 && queue.length>=MAX_QUEUE)return reject(Object.assign(new Error('Server busy. Try again later.'),{status:503}));queue.push({job,resolve,reject});pump();});}
async function pump(){if(active>=1||!queue.length)return;active++;const x=queue.shift();try{x.resolve(await runJob(x.job));}catch(e){x.reject(e)}finally{active--;pump();}}
function runProcess(args,cwd,timeout){return new Promise((resolve,reject)=>{const p=spawn(process.execPath,args,{cwd,stdio:['ignore','pipe','pipe'],env:{...process.env,HOME:cwd,TMPDIR:cwd,PYTHONUNBUFFERED:'1'}});let out='',err='',done=false;const timer=setTimeout(()=>{if(done)return;done=true;try{p.kill('SIGKILL')}catch{};reject(Object.assign(new Error('Deobfuscation timed out.'),{status:504}))},timeout);p.stdout.on('data',d=>{out+=d.toString('utf8').slice(-1024*1024)});p.stderr.on('data',d=>{err+=d.toString('utf8').slice(-1024*1024)});p.on('error',e=>{if(done)return;done=true;clearTimeout(timer);reject(e)});p.on('close',(code,signal)=>{if(done)return;done=true;clearTimeout(timer);if(code!==0)reject(Object.assign(new Error(err.split('\n').filter(Boolean).slice(-5).join('\n')||`Engine exited with code ${code}`),{status:422,code,signal}));else resolve({out,err});});});}
async function detect(file,cwd){const r=await runProcess([path.join(ROOT,'deob.js'),file,'--detect'],cwd,60000);const line=r.out.trim().split(/\r?\n/).pop()||'';const parts=line.split('\t');return {name:parts[1]||'unknown',confidence:Number(parts[2]||0),label:parts[3]||'unknown'};}
async function runJob({input,dir,original}){try{const d=await detect(input,dir);if(d.name==='unknown'||d.confidence<0.5)throw Object.assign(new Error('Luraph was not confidently detected.'),{status:422});const output=path.join(dir,'result.lua');await runProcess([path.join(ROOT,'deob.js'),input,'-o',output,'--timeout',String(Math.max(90,Math.floor(TIMEOUT_MS/1000))),'--budget',String(Math.max(30,Math.floor(TIMEOUT_MS/1000)))],dir,TIMEOUT_MS);if(!fs.existsSync(output))throw Object.assign(new Error('Engine completed without producing an output file.'),{status:422});const stat=await fsp.stat(output);if(stat.size>MAX_BYTES*4)throw Object.assign(new Error('Generated output exceeded the server limit.'),{status:422});return {output,detected:d,original};}catch(e){throw e}}

app.get('/api/health',(req,res)=>res.json({ok:true,engine:'luraph',queue:queue.length,active}));
app.post('/api/deobfuscate',upload.single('file'),async(req,res)=>{const dir=req.jobDir;try{if(!req.file)throw Object.assign(new Error('Upload one .lua, .luau, or .txt file.'),{status:400});const result=await enqueue({input:req.file.path,dir,original:req.file.originalname});const base=path.basename(result.original).replace(/[^a-zA-Z0-9._-]/g,'_').replace(/\.(lua|luau|txt)$/i,'');const downloadName=`${base}.deobf.lua`;res.setHeader('X-Luraph-Version',result.detected.label);res.download(result.output,downloadName,async()=>{await fsp.rm(dir,{recursive:true,force:true}).catch(()=>{});});}catch(e){if(dir)await fsp.rm(dir,{recursive:true,force:true}).catch(()=>{});res.status(e.status||500).json({error:e.message||'Server error'});}});

app.get('/',(req,res)=>res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Luraph Deobfuscator</title><style>body{font-family:system-ui;max-width:760px;margin:60px auto;padding:20px}main{border:1px solid #ddd;border-radius:16px;padding:28px}button{padding:12px 18px;border:0;border-radius:10px;cursor:pointer}input{margin:18px 0}#status{white-space:pre-wrap;margin-top:18px}</style></head><body><main><h1>Luraph Deobfuscator</h1><p>Upload a Lua/Luau file for analysis.</p><input id="f" type="file" accept=".lua,.luau,.txt"><br><button id="b">Deobfuscate</button><div id="status"></div></main><script>const b=document.getElementById('b'),f=document.getElementById('f'),s=document.getElementById('status');b.onclick=async()=>{if(!f.files[0])return s.textContent='Select a file first.';b.disabled=true;s.textContent='Uploading and processing...';const fd=new FormData();fd.append('file',f.files[0]);try{const r=await fetch('/api/deobfuscate',{method:'POST',body:fd});if(!r.ok){const j=await r.json().catch(()=>({error:'Request failed'}));throw Error(j.error)}const blob=await r.blob();const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=(f.files[0].name.replace(/\.(lua|luau|txt)$/i,'')||'result')+'.deobf.lua';a.click();URL.revokeObjectURL(u);s.textContent='Done.'}catch(e){s.textContent='Error: '+e.message}finally{b.disabled=false}}</script></body></html>`));
app.listen(PORT,'0.0.0.0',()=>console.log(`Listening on ${PORT}`));
