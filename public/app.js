const form=document.getElementById("form"), input=document.getElementById("url"), error=document.getElementById("error");
const result=document.getElementById("result"), preview=document.getElementById("preview"), sizes=document.getElementById("sizes"), copy=document.getElementById("copy");

function videoId(value){
  try{
    const u=new URL(value.trim());
    if(u.hostname==="youtu.be") return u.pathname.slice(1).split("/")[0];
    if(u.hostname.endsWith("youtube.com")){
      if(u.pathname==="/watch") return u.searchParams.get("v");
      const parts=u.pathname.split("/").filter(Boolean);
      if(["shorts","embed","live"].includes(parts[0])) return parts[1];
    }
  }catch(e){}
  return null;
}
const variants=[
  ["Max Quality","maxresdefault.jpg"],
  ["Standard HD","sddefault.jpg"],
  ["High Quality","hqdefault.jpg"],
  ["Medium Quality","mqdefault.jpg"],
  ["Default","default.jpg"]
];
function thumb(id,file){return `https://i.ytimg.com/vi/${encodeURIComponent(id)}/${file}`}

function makeDownload(url,label){
  const a=document.createElement("a");
  a.href="/api/download?url="+encodeURIComponent(url);
  a.textContent="Download";
  a.className="download-link";
  a.setAttribute("download", label.toLowerCase().replace(/\s+/g,"-")+".jpg");
  return a;
}
form.addEventListener("submit", async e=>{
  e.preventDefault(); error.textContent=""; result.classList.add("hidden");
  const id=videoId(input.value);
  if(!id){error.textContent="Please enter a valid YouTube video, Shorts, live or youtu.be link.";return;}
  const urls=variants.map(([label,file])=>({label,url:thumb(id,file)}));
  preview.src=urls[0].url;
  preview.onerror=()=>{preview.src=urls[2].url};
  sizes.innerHTML="";
  urls.forEach((item,i)=>{
    const box=document.createElement("div"); box.className="size";
    const small=document.createElement("small"); small.textContent=item.label;
    const button=document.createElement("button"); button.textContent="Download";
    button.addEventListener("click",()=>window.location.href="/api/download?url="+encodeURIComponent(item.url));
    box.append(small,button); sizes.append(box);
  });
  copy.onclick=async()=>{try{await navigator.clipboard.writeText(preview.src);copy.textContent="Copied ✓";setTimeout(()=>copy.textContent="Copy Image URL",1500)}catch{}};
  result.classList.remove("hidden"); result.scrollIntoView({behavior:"smooth",block:"start"});
});
