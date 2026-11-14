const menuBtn=document.getElementById("menuBtn"),mobileMenu=document.getElementById("mobileMenu");
if(menuBtn&&mobileMenu){menuBtn.addEventListener("click",()=>{const o=mobileMenu.classList.toggle("open");menuBtn.setAttribute("aria-expanded",String(o));});}
