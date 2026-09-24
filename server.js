const express = require('express');
const path = require('path');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const INGEST_TOKEN = process.env.INGEST_TOKEN || '';
const LOCATION_TOKEN = process.env.LOCATION_TOKEN || process.env.INGEST_TOKEN || '';
const CELL_PROVIDER = process.env.CELL_PROVIDER || 'manual';
const IG_CLIENT_ID = process.env.IG_CLIENT_ID || '';
const IG_CLIENT_SECRET = process.env.IG_CLIENT_SECRET || '';
const IG_REDIRECT_URI = process.env.IG_REDIRECT_URI || '';
const IG_API_VERSION = process.env.IG_API_VERSION || 'v24.0';
let igAccessToken = process.env.IG_ACCESS_TOKEN || '';

const TARGET = {
  primaryNumber: '504-494-4022',
  historicalNumbers: ['504-400-3107'],
  names: ['Rebecca Canady', 'ohmygodbeckky'],
  since: '2020-01-01T00:00:00.000Z'
};

let events = [];
let latestLocation = null;

function normalizePhone(value=''){ return String(value).replace(/\D/g,'').replace(/^1(?=\d{10}$)/,''); }
function isTargetRecord(record={}) {
  const blob = JSON.stringify(record).toLowerCase();
  const numbers=[TARGET.primaryNumber,...TARGET.historicalNumbers].map(normalizePhone).filter(Boolean);
  return TARGET.names.some(n=>blob.includes(n.toLowerCase())) || numbers.some(n=>normalizePhone(blob).includes(n));
}
function afterCutoff(record={}) {
  const raw=record.timestamp||record.date||record.created_at||record.createdAt;
  if(!raw) return true;
  const t=new Date(raw).getTime();
  return Number.isFinite(t) ? t>=new Date(TARGET.since).getTime() : true;
}
function requireToken(req,res,next){
  if(!INGEST_TOKEN) return res.status(503).json({error:'INGEST_TOKEN is not configured.'});
  const supplied=req.get('x-ingest-token')||req.query.token;
  if(supplied!==INGEST_TOKEN) return res.status(401).json({error:'Unauthorized'});
  next();
}
function requireLocationToken(req,res,next){
  if(!LOCATION_TOKEN) return res.status(503).json({error:'LOCATION_TOKEN is not configured.'});
  const supplied=req.get('x-location-token')||req.query.token;
  if(supplied!==LOCATION_TOKEN) return res.status(401).json({error:'Unauthorized'});
  next();
}
function store(raw, source='authorized-feed') {
  if(!raw || typeof raw!=='object') return false;
  const record={id:raw.id||`${Date.now()}-${Math.random().toString(36).slice(2)}`,source:raw.source||source,type:raw.type||'activity',timestamp:raw.timestamp||raw.date||raw.created_time||raw.created_at||new Date().toISOString(),title:raw.title||raw.name||raw.from||raw.handle||raw.username||'Activity',summary:raw.summary||raw.text||raw.message||raw.caption||'',phone:raw.phone||raw.number||'',handle:raw.handle||raw.username||'',raw};
  if(!afterCutoff(record)||!isTargetRecord(record)) return false;
  events=[record,...events].slice(0,5000); return true;
}

app.get('/api/target',(_req,res)=>res.json(TARGET));
app.get('/api/location',(_req,res)=>res.json({location:latestLocation,provider:CELL_PROVIDER,liveSource:latestLocation?.source||null}));
app.post('/api/cell-observation',requireLocationToken,(req,res)=>{
  const cells=Array.isArray(req.body?.cells)?req.body.cells:[];
  const usable=cells.filter(c=>Number.isFinite(Number(c.latitude))&&Number.isFinite(Number(c.longitude)));
  if(!usable.length) return res.status(400).json({error:'Provide cells with latitude and longitude resolved from an authorized cellular-location source.'});
  let total=0,lat=0,lon=0;
  for(const c of usable){ const w=Math.max(0.01,Number(c.weight)||Number(c.samples)||1); total+=w; lat+=Number(c.latitude)*w; lon+=Number(c.longitude)*w; }
  latestLocation={latitude:lat/total,longitude:lon/total,accuracy:Number.isFinite(Number(req.body.accuracy))?Number(req.body.accuracy):null,timestamp:req.body.timestamp||new Date().toISOString(),device:req.body.device||'Verizon cellular observation',source:'cell-network'};
  res.json({ok:true,location:latestLocation,matchedCells:usable.length});
});
app.get('/api/cell-location/test',(_req,res)=>{
  const latitude=Number(process.env.DEMO_LAT||29.9511),longitude=Number(process.env.DEMO_LON||-90.0715);
  latestLocation={latitude,longitude,accuracy:500,timestamp:new Date().toISOString(),device:'Demo cellular provider',source:'demo-cell-provider'};
  res.json({ok:true,demo:true,location:latestLocation});
});
app.post('/api/location',requireLocationToken,(req,res)=>{
  const {latitude,longitude,accuracy,altitude,heading,speed,timestamp,device}=req.body||{};
  if(!Number.isFinite(Number(latitude))||!Number.isFinite(Number(longitude))) return res.status(400).json({error:'Valid latitude and longitude are required.'});
  latestLocation={latitude:Number(latitude),longitude:Number(longitude),accuracy:Number.isFinite(Number(accuracy))?Number(accuracy):null,altitude:Number.isFinite(Number(altitude))?Number(altitude):null,heading:Number.isFinite(Number(heading))?Number(heading):null,speed:Number.isFinite(Number(speed))?Number(speed):null,timestamp:timestamp||new Date().toISOString(),device:device||'iPhone'};
  res.json({ok:true,location:latestLocation});
});
app.get('/locate',(_req,res)=>res.sendFile(path.join(__dirname,'public','locate.html')));
app.get('/api/events',(req,res)=>{ const limit=Math.min(Math.max(parseInt(req.query.limit||'100',10),1),500); const source=req.query.source?String(req.query.source).toLowerCase():null; const out=events.filter(e=>!source||String(e.source||'').toLowerCase()===source).sort((a,b)=>new Date(b.timestamp||0)-new Date(a.timestamp||0)).slice(0,limit); res.json({count:out.length,events:out,updatedAt:new Date().toISOString()}); });
app.post('/api/ingest',requireToken,(req,res)=>{ const incoming=Array.isArray(req.body)?req.body:[req.body]; let accepted=0; incoming.forEach(r=>{if(store(r)) accepted++;}); res.json({accepted,ignored:incoming.length-accepted,totalStored:events.length}); });
app.post('/api/import',(req,res)=>{ const incoming=Array.isArray(req.body)?req.body:req.body?.records; if(!Array.isArray(incoming)) return res.status(400).json({error:'Send {"records":[...]} or a JSON array.'}); let imported=0; incoming.forEach(r=>{if(store({...r,source:r.source||'manual-import'},'manual-import')) imported++;}); res.json({imported,scanned:incoming.length,totalStored:events.length}); });

// Authorized Instagram OAuth. No credentials are hard-coded in the repository.
app.get('/auth/instagram',(req,res)=>{
  if(!IG_CLIENT_ID||!IG_REDIRECT_URI) return res.status(503).send('Set IG_CLIENT_ID and IG_REDIRECT_URI first.');
  const scope='instagram_basic,instagram_manage_comments,instagram_manage_insights';
  const u=new URL('https://www.facebook.com/'+IG_API_VERSION+'/dialog/oauth');
  u.searchParams.set('client_id',IG_CLIENT_ID); u.searchParams.set('redirect_uri',IG_REDIRECT_URI); u.searchParams.set('scope',scope); u.searchParams.set('response_type','code');
  res.redirect(u.toString());
});
app.get('/auth/instagram/callback',async(req,res)=>{
  if(!req.query.code||!IG_CLIENT_ID||!IG_CLIENT_SECRET||!IG_REDIRECT_URI) return res.status(400).send('OAuth configuration/code missing.');
  try {
    const u=new URL('https://graph.facebook.com/'+IG_API_VERSION+'/oauth/access_token');
    u.searchParams.set('client_id',IG_CLIENT_ID); u.searchParams.set('client_secret',IG_CLIENT_SECRET); u.searchParams.set('redirect_uri',IG_REDIRECT_URI); u.searchParams.set('code',String(req.query.code));
    const r=await fetch(u); const data=await r.json(); if(!r.ok||!data.access_token) return res.status(400).json(data);
    igAccessToken=data.access_token; res.redirect('/?instagram=connected');
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.get('/api/instagram/status',(_req,res)=>res.json({configured:Boolean(IG_CLIENT_ID&&IG_CLIENT_SECRET&&IG_REDIRECT_URI),connected:Boolean(igAccessToken)}));
app.post('/api/instagram/sync',async(_req,res)=>{
  if(!igAccessToken) return res.status(401).json({error:'Connect an authorized Instagram account first at /auth/instagram.'});
  try {
    const pagesUrl=`https://graph.facebook.com/${IG_API_VERSION}/me/accounts?fields=id,name,instagram_business_account&access_token=${encodeURIComponent(igAccessToken)}`;
    const pr=await fetch(pagesUrl); const pages=await pr.json(); if(!pr.ok) return res.status(400).json(pages);
    let scanned=0,accepted=0;
    for(const page of pages.data||[]) {
      const ig=page.instagram_business_account?.id; if(!ig) continue;
      const mediaUrl=`https://graph.facebook.com/${IG_API_VERSION}/${ig}/media?fields=id,caption,media_type,media_url,permalink,timestamp,username&limit=100&access_token=${encodeURIComponent(igAccessToken)}`;
      const mr=await fetch(mediaUrl); const media=await mr.json(); if(!mr.ok) continue;
      for(const item of media.data||[]) { scanned++; if(store({...item,source:'instagram-authorized',type:'instagram-media'},'instagram-authorized')) accepted++; }
    }
    res.json({scanned,accepted,totalStored:events.length,syncedAt:new Date().toISOString()});
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.get('/api/health',(_req,res)=>res.json({ok:true,now:new Date().toISOString(),storedEvents:events.length,locationConnected:Boolean(latestLocation),instagramConnected:Boolean(igAccessToken)}));
app.get('*',(_req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>console.log(`Target Activity Hub listening on port ${PORT}`));
