const urlInput=document.getElementById('transcriptUrl');
const getBtn=document.getElementById('transcriptBtn');
const statusEl=document.getElementById('transcriptStatus');
const result=document.getElementById('transcriptResult');
const frame=document.getElementById('videoFrame');
const titleEl=document.getElementById('transcriptTitle');
const authorEl=document.getElementById('transcriptAuthor');
const langSelect=document.getElementById('languageSelect');
const segmentsEl=document.getElementById('segments');
const copyBtn=document.getElementById('copyTranscript');
const copyPlain=document.getElementById('copyPlain');
const timestampToggle=document.getElementById('timestampToggle');
const stats=document.getElementById('segmentStats');
const currentLang=document.getElementById('currentLanguage');
let data=null, showTimestamps=true;

function getId(value){
  try{
    const u=new URL(value.trim());
    const host=u.hostname.replace(/^www\./,'').toLowerCase();
    if(host==='youtu.be') return u.pathname.split('/').filter(Boolean)[0]||null;
    if(['youtube.com','m.youtube.com','youtube-nocookie.com'].includes(host)){
      if(u.pathname==='/watch') return u.searchParams.get('v');
      const parts=u.pathname.split('/').filter(Boolean);
      if(['shorts','embed','live','v'].includes(parts[0])) return parts[1]||null;
    }
  }catch{}
  return null;
}
function escapeHtml(s=''){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function renderSegments(){
  if(!data)return;
  stats.textContent=`${data.segments.length} segments`;
  currentLang.textContent=data.languageName||data.language||'';
  segmentsEl.innerHTML=data.segments.map((s,i)=>`
    <button class="transcript-line" type="button" data-start="${Math.floor(s.start||0)}">
      ${showTimestamps?`<span class="ts">${escapeHtml(s.timestamp)}</span>`:''}
      <span>${escapeHtml(s.text)}</span>
    </button>`).join('');
  segmentsEl.querySelectorAll('.transcript-line').forEach(el=>{
    el.addEventListener('click',()=>{frame.contentWindow?.postMessage(JSON.stringify({event:'command',func:'seekTo',args:[Number(el.dataset.start),true]}),'*');});
  });
}
function plainText(){return data?.segments?.map(s=>s.text).join(' ')||'';}
function timestampText(){return data?.segments?.map(s=>`${s.timestamp}  ${s.text}`).join('\n')||'';}
async function copyText(text){
  try{await navigator.clipboard.writeText(text); statusEl.textContent='Transcript copied to clipboard.';}
  catch{statusEl.textContent='Copy failed. Please select and copy the transcript manually.';}
}
async function loadTranscript(){
  const id=getId(urlInput.value);
  result.classList.add('hidden'); statusEl.textContent=''; segmentsEl.innerHTML='';
  if(!id||!/^[A-Za-z0-9_-]{11}$/.test(id)){statusEl.textContent='Please paste a valid public YouTube URL.';return;}
  getBtn.disabled=true;getBtn.textContent='Loading...';
  try{
    const r=await fetch(`/api/transcript?url=${encodeURIComponent(urlInput.value)}`);
    const j=await r.json();
    if(!r.ok)throw new Error(j.error||'Transcript unavailable.');
    data=j;
    titleEl.textContent=j.title||'YouTube Video';
    authorEl.textContent=j.author?`by ${j.author}`:'';
    frame.src=`https://www.youtube.com/embed/${encodeURIComponent(j.videoId)}?enablejsapi=1&rel=0`;
    langSelect.innerHTML=(j.languages||[]).map(l=>`<option value="${escapeHtml(l.code)}">${escapeHtml(l.name)}</option>`).join('');
    if(j.language)langSelect.value=j.language;
    renderSegments();
    result.classList.remove('hidden');
    result.scrollIntoView({behavior:'smooth',block:'start'});
  }catch(e){statusEl.textContent=e.message;}
  finally{getBtn.disabled=false;getBtn.textContent='Get Transcript';}
}
langSelect?.addEventListener('change',async()=>{
  if(!data)return;
  getBtn.disabled=true;statusEl.textContent='Loading selected language...';
  try{
    const r=await fetch(`/api/transcript?url=${encodeURIComponent(urlInput.value)}&lang=${encodeURIComponent(langSelect.value)}`);
    const j=await r.json();if(!r.ok)throw new Error(j.error||'Language unavailable.');
    data=j;renderSegments();statusEl.textContent='';
  }catch(e){statusEl.textContent=e.message;}
  finally{getBtn.disabled=false;}
});
copyBtn?.addEventListener('click',()=>copyText(showTimestamps?timestampText():plainText()));
copyPlain?.addEventListener('click',()=>copyText(plainText()));
timestampToggle?.addEventListener('click',()=>{showTimestamps=!showTimestamps;timestampToggle.textContent=`Timestamps: ${showTimestamps?'ON':'OFF'}`;renderSegments();});
getBtn?.addEventListener('click',loadTranscript);
urlInput?.addEventListener('keydown',e=>{if(e.key==='Enter')loadTranscript();});
