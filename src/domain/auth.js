const enc = new TextEncoder();
const hex = bytes => Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
const bytes = value => new Uint8Array(value.match(/../g).map(c=>parseInt(c,16)));
const randomHex = n => hex(crypto.getRandomValues(new Uint8Array(n)));
const digest = async value => hex(await crypto.subtle.digest('SHA-256',enc.encode(value)));
async function derive(password,salt){
 const key=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);
 return hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:bytes(salt),iterations:100000},key,256));
}
export async function allowAttempt(db,request,scope='auth'){
 const address=request.headers.get('CF-Connecting-IP')||'local';
 const key=await digest(address+':'+scope),now=Date.now(),windowStart=now-300000;
 const row=await db.prepare(`INSERT INTO auth_rate_limits(key_hash,window_start,attempts) VALUES(?,?,1)
 ON CONFLICT(key_hash) DO UPDATE SET attempts=CASE WHEN window_start<? THEN 1 ELSE attempts+1 END,window_start=CASE WHEN window_start<? THEN excluded.window_start ELSE window_start END RETURNING attempts`).bind(key,now,windowStart,windowStart).first();
 return row.attempts<=15;
}
function same(a,b){if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
async function newAccountId(db){
 for(let i=0;i<5;i++){
  const id=10000000+crypto.getRandomValues(new Uint32Array(1))[0];
  if(!await db.prepare('SELECT id FROM accounts WHERE id=?').bind(id).first())return id;
 }
 throw new Error('ACCOUNT_ID_EXHAUSTED');
}

export async function register(db,username,password){
 if(typeof username!=='string'||!/^[a-zA-Z0-9_]{3,24}$/.test(username)||typeof password!=='string'||password.length<8||password.length>128)return {error:'帳號請使用 3 至 24 個英數字或底線，密碼至少 8 個字元'};
 const salt=randomHex(16),hash=await derive(password,salt);
 try{
  const id=await newAccountId(db);
  const initialCash = await marketInitialCash(db);
  await db.batch([db.prepare('INSERT INTO accounts(id,name,initial_cash,cash) VALUES(?,?,?,?)').bind(id,username,initialCash,initialCash),db.prepare('INSERT INTO player_credentials(account_id,username,password_salt,password_hash) VALUES(?,?,?,?)').bind(id,username,salt,hash)]);
  return {accountId:id,username};
 }catch(e){if(String(e).includes('UNIQUE'))return {error:'帳號名稱已存在，請換一個'};throw e;}
}
export async function login(db,username,password){
 if(typeof username!=='string'||typeof password!=='string'||password.length>128)return null;
 await db.prepare('DELETE FROM player_sessions WHERE expires_at<=?').bind(Date.now()).run();
 const user=await db.prepare('SELECT account_id,username,password_salt,password_hash FROM player_credentials WHERE username=?').bind(username).first();
 if(!user || !same(await derive(password,user.password_salt),user.password_hash))return null;
 const token=randomHex(32),tokenHash=await digest(token),expires=Date.now()+7*86400000;
 await db.prepare('INSERT INTO player_sessions(token_hash,account_id,expires_at) VALUES(?,?,?)').bind(tokenHash,user.account_id,expires).run();
 return {token,accountId:user.account_id,username:user.username};
}
export async function session(db,request){
 const token=(request.headers.get('Cookie')||'').match(/(?:^|;\s*)stock_session=([a-f0-9]{64})(?:;|$)/)?.[1];
 if(!token)return null;
 return await db.prepare('SELECT c.account_id,c.username FROM player_sessions s JOIN player_credentials c ON c.account_id=s.account_id WHERE s.token_hash=? AND s.expires_at>?').bind(await digest(token),Date.now()).first();
}
export async function logout(db,request){
 const token=(request.headers.get('Cookie')||'').match(/(?:^|;\s*)stock_session=([a-f0-9]{64})(?:;|$)/)?.[1];
 if(token)await db.prepare('DELETE FROM player_sessions WHERE token_hash=?').bind(await digest(token)).run();
}

// 初始資金依市場總量計算：六檔股票 流動性×現價 的總市值的 1/1000，最低 10 萬。
export async function marketInitialCash(db) {
 const rows = (await db.prepare("SELECT price, liquidity FROM stocks WHERE symbol IN ('2330','2317','2454','3711','YZU','YOUJIAN')").all()).results;
 const total = rows.reduce((sum, s) => sum + Number(s.price) * (Number(s.liquidity) || 0), 0);
 return Math.max(100000, Math.round(total / 1000));
}

export async function guestLogin(db, nickname) {
 await db.prepare('DELETE FROM player_sessions WHERE expires_at<=?').bind(Date.now()).run();
 const rand = Math.floor(1000 + Math.random() * 9000);
 const cleanNick = (typeof nickname === 'string' && nickname.trim()) ? nickname.trim().slice(0, 12) : '大戶_' + rand;
 const baseName = cleanNick.replace(/[^a-zA-Z0-9_一-龥]/g, '') || ('Whale_' + rand);
 const username = baseName.slice(0, 7) + '_' + randomHex(8);
 const salt = randomHex(16), hash = await derive(randomHex(16), salt);
 const id = await newAccountId(db);
 const initialCash = await marketInitialCash(db);
 await db.batch([
  db.prepare('INSERT INTO accounts(id,name,initial_cash,cash) VALUES(?,?,?,?)').bind(id, username, initialCash, initialCash),
  db.prepare('INSERT INTO player_credentials(account_id,username,password_salt,password_hash) VALUES(?,?,?,?)').bind(id, username, salt, hash)
 ]);
 const token = randomHex(32), tokenHash = await digest(token), expires = Date.now() + 7 * 86400000;
 await db.prepare('INSERT INTO player_sessions(token_hash,account_id,expires_at) VALUES(?,?,?)').bind(tokenHash, id, expires).run();
 return { token, accountId: id, username };
}
