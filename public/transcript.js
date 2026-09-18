const urlInput=document.getElementById('transcriptUrl');
const getBtn=document.getElementById('transcriptBtn');
const languageSelect=document.getElementById('transcriptLanguage');
const sourceEl=document.getElementById('transcriptSource');
const statusEl=document.getElementById('transcriptStatus');
const result=document.getElementById('transcriptResult');
const frame=document.getElementById('videoFrame');
const titleEl=document.getElementById('transcriptTitle');
const authorEl=document.getElementById('transcriptAuthor');
const segmentsEl=document.getElementById('segments');
const copyBtn=document.getElementById('copyTranscript');
const copyPlain=document.getElementById('copyPlain');
const stats=document.getElementById('segmentStats');
const searchInput=document.getElementById('transcriptSearch');
let data=null;

function getId(value){
  try{const u=new URL(value.trim()),host=u.hostname.replace(/^www\./,'').toLowerCase();
    if(host==='youtu.be')return u.pathname.split('/').filter(Boolean)[0]||null;
    if(['youtube.com','m.youtube.com','youtube-nocookie.com'].includes(host)){if(u.pathname==='/watch')return u.searchParams.get('v');const p=u.pathname.split('/').filter(Boolean);if(['shorts','embed','live','v'].includes(p[0]))return p[1]||null;}
  }catch{} return null;
}
function escapeHtml(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function renderSegments(){
  if(!data)return;
  const q=(searchInput?.value||'').trim().toLowerCase();
  const list=data.segments.filter(s=>!q||s.text.toLowerCase().includes(q));
  stats.textContent=`${list.length}${q?' matching':''} / ${data.segments.length} segments`;
  segmentsEl.innerHTML=list.length?list.map((s,i)=>`<button class="transcript-line" type="button" data-start="${Math.floor(s.start||0)}"><span class="ts">${escapeHtml(s.timestamp)}</span><span>${escapeHtml(s.text)}</span></button>`).join(''):`<div class="transcript-empty">No matching transcript lines.</div>`;
  segmentsEl.querySelectorAll('.transcript-line').forEach(el=>el.addEventListener('click',()=>{frame.contentWindow?.postMessage(JSON.stringify({event:'command',func:'seekTo',args:[Number(el.dataset.start),true]}),'*');}));
}
function plainText(){return data?.segments?.map(s=>s.text).join('\n')||'';}
function timestampText(){return data?.segments?.map(s=>`${s.timestamp}  ${s.text}`).join('\n')||'';}
async function copyText(text){try{await navigator.clipboard.writeText(text);statusEl.textContent='Transcript copied to clipboard.';}catch{statusEl.textContent='Copy failed. Please select and copy the transcript manually.';}}
async function loadTranscript(lang=languageSelect?.value||''){
  const id=getId(urlInput.value); result.classList.add('hidden'); statusEl.textContent='';
  if(!id||!/^[A-Za-z0-9_-]{11}$/.test(id)){statusEl.textContent='Please paste a valid public YouTube URL.';return;}
  getBtn.disabled=true;getBtn.textContent='Loading...';
  try{
    const endpoint=`/api/transcript?url=${encodeURIComponent(urlInput.value)}${lang?'&lang='+encodeURIComponent(lang):''}`;
    const r=await fetch(endpoint);const j=await r.json();
    if(!r.ok){
      if(j.languages?.length) statusEl.textContent=`Available languages: ${j.languages.map(x=>x.name).join(', ')}`;
      throw new Error(j.error||'Transcript unavailable.');
    }
    data=j;titleEl.textContent=j.title||'YouTube Video';authorEl.textContent=j.author?`by ${j.author}`:'';sourceEl.textContent=j.source?`Transcript source: ${j.source==='asr'?'AI speech recognition':j.source==='captions'?'YouTube captions':'automatic'}`:'';frame.src=`https://www.youtube.com/embed/${encodeURIComponent(j.videoId)}?enablejsapi=1&rel=0`;
    renderSegments();result.classList.remove('hidden');result.scrollIntoView({behavior:'smooth',block:'start'});statusEl.textContent='';
  }catch(e){statusEl.textContent=e.message;}
  finally{getBtn.disabled=false;getBtn.textContent='Get Transcript';}
}
copyBtn?.addEventListener('click',()=>copyText(timestampText()));copyPlain?.addEventListener('click',()=>copyText(plainText()));
searchInput?.addEventListener('input',renderSegments);getBtn?.addEventListener('click',()=>loadTranscript());urlInput?.addEventListener('keydown',e=>{if(e.key==='Enter')loadTranscript();});
