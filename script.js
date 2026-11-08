const API_BASE='https://momo-loans-zambia-api.onrender.com';
// Start waking the free API and its database as soon as the page loads.
// This runs in the background so it does not block the landing page.
fetch(API_BASE+'/health',{cache:'no-store'}).catch(()=>{});

const amount=document.getElementById('amount');
const months=document.getElementById('months');
const fmt=n=>Math.round(n).toLocaleString('en-US');
const byName=name=>document.querySelector('[name="'+name+'"]');

function updateCalc(){
  const a=Number(amount.value),m=Number(months.value);
  document.getElementById('amountLabel').textContent=fmt(a);
  document.getElementById('monthsLabel').textContent=m;
  document.getElementById('repayment').textContent=fmt(a/m);
  document.getElementById('heroAmount').textContent=fmt(a);
  const amountField=byName('amount');
  if(amountField && !amountField.dataset.userEdited) amountField.value=a;
  const termField=byName('term');
  if(termField && !termField.dataset.userEdited) termField.value=String(m);
}
amount.addEventListener('input',updateCalc);
months.addEventListener('input',updateCalc);
updateCalc();
document.getElementById('year').textContent=new Date().getFullYear();

const form=document.getElementById('applicationForm');
const result=document.getElementById('formResult');
const submit=form.querySelector('[type="submit"]');
const amountField=byName('amount');
const termField=byName('term');
amountField.addEventListener('input',()=>{amountField.dataset.userEdited='true'});
termField.addEventListener('change',()=>{termField.dataset.userEdited='true'});

document.querySelectorAll('[data-loan]').forEach(link=>{
  link.addEventListener('click',()=>{
    const select=byName('loan');
    select.value=link.dataset.loan;
    select.dispatchEvent(new Event('change',{bubbles:true}));
  });
});

const menu=document.querySelector('.menu');
const nav=document.querySelector('.nav');
menu.setAttribute('aria-expanded','false');
menu.setAttribute('aria-controls','primary-navigation');
nav.id='primary-navigation';
nav.setAttribute('aria-label','Main navigation');
function closeMenu(){
  nav.classList.remove('open');
  menu.textContent='☰';
  menu.setAttribute('aria-expanded','false');
}
menu.addEventListener('click',()=>{
  const open=!nav.classList.contains('open');
  nav.classList.toggle('open',open);
  menu.textContent=open?'×':'☰';
  menu.setAttribute('aria-expanded',String(open));
});
nav.querySelectorAll('a').forEach(a=>a.addEventListener('click',closeMenu));
document.addEventListener('keydown',event=>{if(event.key==='Escape')closeMenu()});
window.addEventListener('resize',()=>{if(window.innerWidth>650)closeMenu()});

form.addEventListener('submit',async event=>{
  event.preventDefault();
  if(!form.reportValidity())return;
  const data=new FormData(form);
  const rawAmount=String(data.get('amount')||'').trim();
  const payload={
    name:String(data.get('name')||'').trim(),
    phone:String(data.get('phone')||'').trim(),
    email:String(data.get('email')||'').trim(),
    loan:data.get('loan'),
    amount:rawAmount,
    term:Number(data.get('term')),
    consent:form.elements.consent.checked
  };
  result.hidden=false;
  result.dataset.state='pending';
  result.textContent='Submitting your interest securely…';
  submit.disabled=true;
  submit.setAttribute('aria-busy','true');
  try{
    const response=await fetch(API_BASE+'/api/applications',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload)
    });
    const body=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(body.error||'We could not submit your details. Please try again.');
    form.reset();
    delete amountField.dataset.userEdited;
    delete termField.dataset.userEdited;
    updateCalc();
    result.dataset.state='success';
    result.textContent='Thank you. Your expression of interest was received. Your reference is '+body.reference+'. This is not a loan approval or offer; a verified lender must confirm eligibility and all terms.';
  }catch(error){
    result.dataset.state='error';
    result.textContent=error.message==='Failed to fetch'
      ?'We could not reach the submission service. Please check your connection and try again.'
      :error.message;
  }finally{
    submit.disabled=false;
    submit.removeAttribute('aria-busy');
    result.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'nearest'});
  }
});

/* Reveal sections only when motion is allowed; content remains visible without JS support. */
if('IntersectionObserver' in window && !window.matchMedia('(prefers-reduced-motion: reduce)').matches){
  const revealTargets=document.querySelectorAll('.loan-card,.steps article,.calc-panel,.apply-form,.faq-list details');
  revealTargets.forEach(el=>el.classList.add('reveal'));
  document.body.classList.add('reveal-ready');
  const observer=new IntersectionObserver(entries=>{
    entries.forEach(entry=>{
      if(entry.isIntersecting){
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    });
  },{threshold:.12});
  revealTargets.forEach(el=>observer.observe(el));
}
