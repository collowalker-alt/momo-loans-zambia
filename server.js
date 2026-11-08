import express from 'express';
import pg from 'pg';
import crypto from 'node:crypto';
const app=express(),{Pool}=pg;
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});
const origin=process.env.WEBSITE_ORIGIN||'https://momo-loans-zambia-6w63.onrender.com';
app.use((req,res,next)=>{res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization');if(req.method==='OPTIONS')return res.sendStatus(204);next();});
app.use(express.json({limit:'10kb'}));
const hits=new Map();
app.use('/api/',(req,res,next)=>{if(req.path==='/telegram/webhook')return next();const ip=req.ip||'unknown',now=Date.now(),a=(hits.get(ip)||[]).filter(t=>now-t<60000);if(a.length>=8)return res.status(429).json({error:'Too many requests. Try later.'});a.push(now);hits.set(ip,a);next();});
async function telegramCall(method,payload){
  const token=process.env.TELEGRAM_BOT_TOKEN;
  if(!token)throw new Error('Telegram bot token is not configured');
  const response=await fetch('https://api.telegram.org/bot'+token+'/'+method,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(10000)});
  const result=await response.json();
  if(!response.ok||!result.ok)throw new Error(result.description||'Telegram API request failed');
  return result;
}
async function notifyTelegram(application){
  const chatId=process.env.TELEGRAM_CHAT_ID;
  if(!process.env.TELEGRAM_BOT_TOKEN||!chatId){console.warn('Telegram notifications are not configured');return;}
  const monthly=application.amount!=null&&application.term?Number(application.amount)/Number(application.term):null;
  const message=[
    '🔔 NEW MOMO LOANS ZAMBIA APPLICATION',
    '',
    '👤 Applicant details',
    'Name: '+application.name,
    'Email: '+(application.email||'Not provided'),
    'Date of birth: '+(application.dob||'Not provided'),
    'Monthly income: '+(application.monthlyIncome==null?'Not provided':'ZMW '+Number(application.monthlyIncome).toLocaleString('en-ZM')),
    '',
    '💰 Loan details',
    'Loan option: '+application.loan,
    'Loan amount: '+(application.amount==null?'Not provided':'ZMW '+Number(application.amount).toLocaleString('en-ZM')),
    'Term: '+(application.term==null?'Not provided':application.term+' months'),
    'Monthly payment: '+(monthly==null?'Not available':'ZMW '+monthly.toFixed(2)+' (principal-only estimate; excludes interest and fees)'),
    '',
    '📱 MoMo number: '+application.momoNumber,
    '🧾 Reference: '+application.id,
    '📌 Status: New — awaiting your decision',
    '',
    'Security: No MoMo PIN is requested or stored.'
  ].join('\n');
  try {
    await telegramCall('sendMessage',{chat_id:chatId,text:message,disable_web_page_preview:true,reply_markup:{inline_keyboard:[[{text:'✅ Accept application',callback_data:'accept:'+application.id},{text:'❌ Reject application',callback_data:'reject:'+application.id}]]}});
  } catch(error) { console.error('Telegram notification failed:',error.message); }
}
async function init(){await pool.query('CREATE TABLE IF NOT EXISTS applications(id UUID PRIMARY KEY,full_name VARCHAR(120) NOT NULL,phone VARCHAR(30) NOT NULL,email VARCHAR(254),loan_type VARCHAR(40) NOT NULL,amount NUMERIC(12,2),term_months INTEGER,consent BOOLEAN NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),status VARCHAR(30) NOT NULL DEFAULT \'new\',notes TEXT,dob DATE,monthly_income NUMERIC(12,2),momo_number VARCHAR(30))');await pool.query('ALTER TABLE applications ADD COLUMN IF NOT EXISTS notes TEXT');await pool.query('ALTER TABLE applications ADD COLUMN IF NOT EXISTS dob DATE');await pool.query('ALTER TABLE applications ADD COLUMN IF NOT EXISTS monthly_income NUMERIC(12,2)');await pool.query('ALTER TABLE applications ADD COLUMN IF NOT EXISTS momo_number VARCHAR(30)');}
app.post('/api/telegram/webhook',async(req,res)=>{
  const expected=process.env.ADMIN_TOKEN;
  const supplied=req.get('X-Telegram-Bot-Api-Secret-Token');
  if(!expected||!supplied||supplied!==expected)return res.sendStatus(401);
  res.sendStatus(200);
  const q=req.body?.callback_query;
  if(!q?.data||!q?.message)return;
  const match=/^(accept|reject):([0-9a-f-]{36})$/i.exec(q.data);
  if(!match)return;
  const decision=match[1]==='accept'?'accepted':'rejected',id=match[2];
  try{
    const r=await pool.query('UPDATE applications SET status=$1 WHERE id=$2 RETURNING full_name',[decision,id]);
    if(!r.rowCount){await telegramCall('answerCallbackQuery',{callback_query_id:q.id,text:'Application record was not found.'});return;}
    const label=decision==='accepted'?'✅ APPLICATION ACCEPTED':'❌ APPLICATION REJECTED';
    const original=String(q.message.text||'').replace(/\n📌 Status:.*$/s,'');
    await telegramCall('editMessageText',{chat_id:q.message.chat.id,message_id:q.message.message_id,text:original+'\n\n'+label+'\n📌 Decision recorded: '+new Date().toISOString(),reply_markup:{inline_keyboard:[]}});
    await telegramCall('answerCallbackQuery',{callback_query_id:q.id,text:decision==='accepted'?'Application accepted.':'Application rejected.'});
  }catch(error){console.error('Telegram decision handling failed:',error.message);try{await telegramCall('answerCallbackQuery',{callback_query_id:q.id,text:'Could not save decision. Please try again.'});}catch{}}
});
app.get('/health',async(req,res)=>{try{await pool.query('SELECT 1');res.json({ok:true,service:'momo-loans-zambia-api'});}catch{res.status(503).json({ok:false});}});
app.post('/api/applications',async(req,res)=>{try{
  const b=req.body||{},name=String(b.name||'').trim(),phone=String(b.phone||'').trim(),email=String(b.email||'').trim(),loan=String(b.loan||''),amount=b.amount===''||b.amount==null?null:Number(b.amount),term=b.term==null?null:Number(b.term),dob=String(b.dob||'').trim(),monthlyIncome=b.monthlyIncome===''||b.monthlyIncome==null?null:Number(b.monthlyIncome),momoNumber=String(b.momoNumber||'').trim(),consent=b.consent===true;
  const birthDate=new Date(dob+'T00:00:00Z'),today=new Date(),age=Number.isNaN(birthDate.getTime())?0:today.getUTCFullYear()-birthDate.getUTCFullYear()-((today.getUTCMonth()<birthDate.getUTCMonth()||(today.getUTCMonth()===birthDate.getUTCMonth()&&today.getUTCDate()<birthDate.getUTCDate()))?1:0);
  if(name.length<2||name.length>120||!/^[+0-9 ()-]{7,20}$/.test(phone)||email.length>254||!['Personal loan','Salary advance','Business support'].includes(loan)||!/^\\d{4}-\\d{2}-\\d{2}$/.test(dob)||age<18||age>100||!Number.isFinite(monthlyIncome)||monthlyIncome<=0||monthlyIncome>10000000||!/^[+0-9 ()-]{7,20}$/.test(momoNumber)||!consent||(amount!==null&&(!Number.isFinite(amount)||amount<500||amount>50000))||(term!==null&&(!Number.isInteger(term)||term<1||term>24)))return res.status(400).json({error:'Check required fields and consent.'});
  const id=crypto.randomUUID();
  await pool.query('INSERT INTO applications(id,full_name,phone,email,loan_type,amount,term_months,consent,dob,monthly_income,momo_number) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[id,name,phone,email||null,loan,amount,term,consent,dob,monthlyIncome,momoNumber]);
  notifyTelegram({id,name,phone,email,loan,amount,term,dob,monthlyIncome,momoNumber});
  res.status(201).json({ok:true,reference:id});
}catch(e){console.error('Submission failed',e.message);res.status(503).json({error:'Could not submit right now. Please try later.'});}});
app.get('/api/admin/applications',async(req,res)=>{if(!process.env.ADMIN_TOKEN||req.headers.authorization!==`Bearer ${process.env.ADMIN_TOKEN}`)return res.sendStatus(401);try{const r=await pool.query('SELECT id,full_name,phone,email,loan_type,amount,term_months,created_at,status,notes FROM applications ORDER BY created_at DESC LIMIT 500');res.json({applications:r.rows});}catch{res.status(503).json({error:'Unable to retrieve applications.'});}});
app.post('/api/admin/applications/:id/update',async(req,res)=>{if(!process.env.ADMIN_TOKEN||req.headers.authorization!==`Bearer ${process.env.ADMIN_TOKEN}`)return res.sendStatus(401);const id=String(req.params.id||'');const status=String(req.body?.status||'');const notes=String(req.body?.notes||'');if(!/^[0-9a-f-]{36}$/i.test(id)||!['new','contacted','under_review','accepted','approved','rejected'].includes(status)||notes.length>3000)return res.status(400).json({error:'Invalid application update.'});try{const r=await pool.query('UPDATE applications SET status=$1,notes=$2 WHERE id=$3 RETURNING id,status,notes',[status,notes,id]);if(!r.rowCount)return res.sendStatus(404);res.json({ok:true,application:r.rows[0]});}catch(e){console.error('Admin update failed',e.message);res.status(503).json({error:'Unable to update application.'});}});

init().then(async()=>{const server=app.listen(process.env.PORT||10000,'0.0.0.0');const token=process.env.TELEGRAM_BOT_TOKEN;if(token&&process.env.ADMIN_TOKEN){try{await telegramCall('setWebhook',{url:'https://momo-loans-zambia-api.onrender.com/api/telegram/webhook',secret_token:process.env.ADMIN_TOKEN,allowed_updates:['message','callback_query'],drop_pending_updates:false});console.log('Telegram decision webhook configured');}catch(e){console.error('Telegram webhook setup failed:',e.message);}}return server;}).catch(e=>{console.error('Database initialization failed',e.message);process.exit(1);});
