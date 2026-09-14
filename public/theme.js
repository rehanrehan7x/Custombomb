(()=>{
  const key='thumbgrab-theme';
  const apply=t=>{
    document.documentElement.dataset.theme=t;
    const b=document.getElementById('themeToggle');
    if(b){
      b.textContent=t==='dark'?'☀ White':'● Black';
      b.setAttribute('aria-label',t==='dark'?'Switch to white theme':'Switch to black theme');
    }
  };
  let t=localStorage.getItem(key)||'dark';
  if(t!=='dark'&&t!=='light') t='dark';
  apply(t);
  document.addEventListener('click',e=>{
    const b=e.target.closest('#themeToggle');
    if(!b)return;
    t=document.documentElement.dataset.theme==='dark'?'light':'dark';
    localStorage.setItem(key,t);
    apply(t);
  });
})();
