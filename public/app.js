const input=document.getElementById('urlInput');
const button=document.getElementById('getBtn');
const result=document.getElementById('result');
const preview=document.getElementById('thumbPreview');
const grid=document.getElementById('downloadGrid');
const status=document.getElementById('status');
const title=document.getElementById('videoTitle');

function getId(value){
  try{
    let u=new URL(value.trim());
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

const variants=[
  ['Maximum available','maxresdefault.jpg','Maximum available resolution'],
  ['Standard HD','sddefault.jpg','Standard high-quality thumbnail'],
  ['High Quality','hqdefault.jpg','High-quality thumbnail'],
  ['Medium Quality','mqdefault.jpg','Medium-quality thumbnail'],
  ['Default','default.jpg','Default thumbnail']
];

function imageWorks(url){
  return new Promise(resolve=>{const img=new Image();img.onload=()=>resolve(img.naturalWidth>0);img.onerror=()=>resolve(false);img.src=url+'?cb='+Date.now();});
}

async function load(){
  const videoId=getId(input.value);
  result.classList.add('hidden'); status.textContent=''; grid.innerHTML='';
  if(!videoId || !/^[A-Za-z0-9_-]{6,20}$/.test(videoId)){
    status.textContent='Please paste a valid public YouTube video, Shorts, live, embed, or youtu.be URL.'; return;
  }
  button.disabled=true; button.textContent='Checking...';
  const found=[];
  for(const [name,file,desc] of variants){
    const url=`https://i.ytimg.com/vi/${videoId}/${file}`;
    if(await imageWorks(url)) found.push({name,file,url,desc});
  }
  button.disabled=false; button.textContent='Get Thumbnail';
  if(!found.length){status.textContent='No thumbnail could be found for this video. Check that the URL is public and valid.';return;}
  preview.src=found[0].url;
  title.textContent=`YouTube Thumbnail Preview — ${found[0].name}`;
  grid.innerHTML=found.map(v=>`<a class="download" href="/api/download?url=${encodeURIComponent(v.url)}"><span><b>${v.name}</b><small>${v.desc}</small></span><b>Download</b></a>`).join('');
  result.classList.remove('hidden');
  result.scrollIntoView({behavior:'smooth',block:'start'});
}

if(button){button.addEventListener('click',load);input.addEventListener('keydown',e=>{if(e.key==='Enter')load();});}
