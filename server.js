import express from 'express';
import pg from 'pg';
import crypto from 'node:crypto';
const app=express(),{Pool}=pg;
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
const origin=process.env.WEBSITE_ORIGIN||'https://momo-loans-zambia-6w63.onrender.com';
app.use((req,res,next)=>{res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization');if(req.method==='OPTIONS')return res.sendStatus(204);next();});
app.use(express.json({limit:'10kb'}));
const hits=new Map();
app.use('/api/',(req,res,next)=>{const ip=req.ip||'unknown',now=Date.now(),a=(hits.get(ip)||[]).filter(t=>now-t<60000);if(a.length>=8)return res.status(429).json({error:'Too many requests. Try later.'});a.push(now);hits.set(ip,a);next();});
async function notifyTelegram(application){
  const token=process.env.TELEGRAM_BOT_TOKEN,chatId=process.env.TELEGRAM_CHAT_ID;
  if(!token||!chatId){console.warn('Telegram notifications are not configured');return;}
  const message=[
    '🔔 NEW MOMO LOANS ZAMBIA INTEREST',
    '',
    '👤 Name: '+application.name,
    '📞 Phone: '+application.phone,
    '✉️ Email: '+(application.email||'Not provided'),
    '💼 Loan option: '+application.loan,
    '💰 Requested amount: '+(application.amount==null?'Not provided':'ZMW '+application.amount),
    '📅 Repayment period: '+(application.term==null?'Not provided':application.term+' months'),
    '',
    '🧾 Reference: '+application.id,
    '📌 Status: New — follow-up required'
  ].join('\\n');
  try {
    const response=await fetch('https://api.telegram.org/bot'+token+'/sendMessage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chatId,text:message,disable_web_page_preview:true}),signal:AbortSignal.timeout(8000)});
    const result=await response.json();
    if(!response.ok||!result.ok)console.error('Telegram notification failed:',result.description||response.status);
  } catch(error) { console.error('Telegram notification failed:',error.message); }
}
async function init(){await pool.query('CREATE TABLE IF NOT EXISTS applications(id UUID PRIMARY KEY,full_name VARCHAR(120) NOT NULL,phone VARCHAR(30) NOT NULL,email VARCHAR(254),loan_type VARCHAR(40) NOT NULL,amount NUMERIC(12,2),term_months INTEGER,consent BOOLEAN NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),status VARCHAR(30) NOT NULL DEFAULT \'new\')');}
app.get('/health',async(req,res)=>{try{await pool.query('SELECT 1');res.json({ok:true,service:'momo-loans-zambia-api'});}catch{res.status(503).json({ok:false});}});
app.post('/api/applications',async(req,res)=>{try{const b=req.body||{},name=String(b.name||'').trim(),phone=String(b.phone||'').trim(),email=String(b.email||'').trim(),loan=String(b.loan||''),amount=b.amount===''||b.amount==null?null:Number(b.amount),term=b.term==null?null:Number(b.term),consent=b.consent===true;if(name.length<2||name.length>120||!/^[+0-9 ()-]{7,20}$/.test(phone)||email.length>254||!['Personal loan','Salary advance','Business support'].includes(loan)||!consent||(amount!==null&&(!Number.isFinite(amount)||amount<500||amount>50000))||(term!==null&&(!Number.isInteger(term)||term<1||term>24)))return res.status(400).json({error:'Check required fields and consent.'});const id=crypto.randomUUID();await pool.query('INSERT INTO applications(id,full_name,phone,email,loan_type,amount,term_months,consent) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,name,phone,email||null,loan,amount,term,consent]);notifyTelegram({id,name,phone,email,loan,amount,term});res.status(201).json({ok:true,reference:id});}catch(e){console.error('Submission failed',e.message);res.status(503).json({error:'Could not submit right now. Please try later.'});}});
app.get('/api/admin/applications',async(req,res)=>{if(!process.env.ADMIN_TOKEN||req.headers.authorization!==`Bearer ${process.env.ADMIN_TOKEN}`)return res.sendStatus(401);try{const r=await pool.query('SELECT id,full_name,phone,email,loan_type,amount,term_months,created_at,status FROM applications ORDER BY created_at DESC LIMIT 500');res.json({applications:r.rows});}catch{res.status(503).json({error:'Unable to retrieve applications.'});}});
init().then(()=>app.listen(process.env.PORT||10000,'0.0.0.0')).catch(e=>{console.error('Database initialization failed',e.message);process.exit(1);});
