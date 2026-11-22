/* Chorrómetro · notificaciones push al móvil
   - Cada minuto mira las liadas en curso y avisa a quien tenga activadas las notificaciones:
     ⏰ "Te toca" y 😬 "Llevas mucho sin tomar" (una sola vez por cada último chorro).
   - Al pulsar "Enviar prueba" en la app se manda una notificación de prueba. */
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();
const REGION = 'europe-west1';
const URL = 'https://victorguinot.github.io/chorrometro/';

const nrm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
function dur(ms) { const m = Math.round(ms / 60000); if (m < 60) return m + ' min'; const h = Math.floor(m / 60), r = m % 60; return h + ' h' + (r ? ' ' + r + ' min' : ''); }

async function send(uid, tokens, msg) {
  if (!tokens || !tokens.length) return;
  const res = await admin.messaging().sendEachForMulticast({
    tokens,
    data: { title: msg.title, body: msg.body || '', tag: msg.tag || 'chorro', url: msg.url || URL },
    webpush: { headers: { Urgency: 'high', TTL: '1800' }, notification: { title: msg.title, body: msg.body || '', icon: URL + 'icon-192.png', tag: msg.tag || 'chorro' }, fcmOptions: { link: msg.url || URL } }
  });
  console.log('push', uid, 'ok', res.successCount, 'fail', res.failureCount, res.responses.filter((r) => !r.success).map((r) => r.error && r.error.code));
  const bad = [];
  res.responses.forEach((r, i) => {
    if (!r.success) {
      const c = r.error && r.error.code;
      if (c === 'messaging/registration-token-not-registered' || c === 'messaging/invalid-registration-token' || c === 'messaging/invalid-argument') bad.push(tokens[i]);
    }
  });
  if (bad.length) await db.doc('push/' + uid).update({ tokens: admin.firestore.FieldValue.arrayRemove(...bad) });
}

exports.avisos = onSchedule({ schedule: 'every 1 minutes', region: REGION, timeZone: 'Europe/Madrid', retryCount: 0 }, async () => {
  const pushSnap = await db.collection('push').get();
  const subs = pushSnap.docs.map((d) => ({ uid: d.id, ...d.data() })).filter((x) => (x.tokens || []).length && (x.toca !== false || x.mucho !== false));
  if (!subs.length) return;
  const sesSnap = await db.collection('sessions').orderBy('start', 'desc').limit(10).get();
  const active = sesSnap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((s) => !s.end && !s.deleted);
  if (!active.length) return;
  const [accSnap, alSnap] = await Promise.all([db.collection('accounts').get(), db.doc('aliases/map').get()]);
  const acc = {}; accSnap.docs.forEach((d) => { if (d.data().name) acc[d.id] = d.data().name; });
  const al = alSnap.exists ? alSnap.data() : {};
  const canon = (n) => { const k = nrm(n); return al[k] ? nrm(al[k]) : k; };
  const now = Date.now();
  for (const S of active) {
    const want = subs.filter((x) => acc[x.uid]);
    if (!want.length) continue;
    const [pSnap, lSnap] = await Promise.all([
      db.collection('people').where('sid', '==', S.id).get(),
      db.collection('logs').where('sid', '==', S.id).get()
    ]);
    const last = {}; lSnap.docs.forEach((d) => { const l = d.data(); if (l.ts && l.ts <= now && (!last[l.pid] || l.ts > last[l.pid])) last[l.pid] = l.ts; });
    const people = pSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const locs = (S.locs || []).slice().sort((a, b) => a.at - b.at);
    const groupLoc = (t) => { let l = S.loc || ''; locs.forEach((x) => { if (x.at <= t + 60000) l = x.loc; }); return l; };
    for (const x of want) {
      const k = canon(acc[x.uid]);
      const p = people.find((q) => q.name && canon(q.name) === k);
      if (!p || p.gone) continue;
      if ((p.away || []).some((a) => a.f <= now && !a.t)) continue;
      const back = Math.max(0, ...(p.away || []).map((a) => a.t || 0));
      const ref = Math.max(last[p.id] || Math.max(p.at || 0, S.start || 0), back);
      const el = now - ref, sent = x.sent || {}, upd = {};
      let mv = null; (p.moves || []).slice().sort((a, b) => a.at - b.at).forEach((m) => { if (m.at <= now + 60000) mv = m; });
      const loc = (mv && mv.loc) || groupLoc(now);
      const minT = (x.min || 60) * 60000, minM = (x.muchoMin || 120) * 60000;
      if (x.mucho !== false && el >= minM && sent.mucho !== ref && el < minM + 6 * 3600000) {
        await send(x.uid, x.tokens, { title: '😬 ' + p.name + ', llevas ' + dur(el) + ' sin tomar', body: (loc ? 'En ' + loc + '. ' : '') + 'Toca para apuntar tu chorro.', tag: 'mucho', url: URL + '?anotar' });
        upd['sent.mucho'] = ref; upd['sent.toca'] = ref;
      } else if (x.toca !== false && el >= minT && sent.toca !== ref && el < minT + 3 * 3600000) {
        await send(x.uid, x.tokens, { title: '⏰ ¡Te toca, ' + p.name + '!', body: 'Hace ' + dur(el) + ' de tu último chorro' + (loc ? ' · ' + loc : '') + '. Toca para apuntarlo.', tag: 'toca', url: URL + '?anotar' });
        upd['sent.toca'] = ref;
      }
      if (Object.keys(upd).length) await db.doc('push/' + x.uid).update(upd);
    }
  }
});

exports.prueba = onDocumentWritten({ document: 'push/{uid}', region: REGION }, async (ev) => {
  const a = ev.data && ev.data.after && ev.data.after.exists ? ev.data.after.data() : null;
  const b = ev.data && ev.data.before && ev.data.before.exists ? ev.data.before.data() : null;
  if (!a || !a.test || (b && b.test === a.test)) return;
  if (Date.now() - a.test > 120000) return;
  await send(ev.params.uid, a.tokens || [], { title: '🔔 Prueba del Chorrómetro', body: 'Las notificaciones funcionan en este móvil 💧', tag: 'prueba' });
});

/* Al finalizar una liada: resumen a cada participante con notificaciones activadas */
const { onDocumentUpdated } = require('firebase-functions/v2/firestore');
exports.resumen = onDocumentUpdated({ document: 'sessions/{sid}', region: REGION }, async (ev) => {
  const b = ev.data.before.data(), a = ev.data.after.data(), sid = ev.params.sid;
  if (!a || !b || b.end || !a.end || a.deleted) return;
  const [pSnap, lSnap, pushSnap, accSnap, alSnap] = await Promise.all([
    db.collection('people').where('sid', '==', sid).get(), db.collection('logs').where('sid', '==', sid).get(),
    db.collection('push').get(), db.collection('accounts').get(), db.doc('aliases/map').get()]);
  const al = alSnap.exists ? alSnap.data() : {}; const canon = (n) => { const k = nrm(n); return al[k] ? nrm(al[k]) : k; };
  const acc = {}; accSnap.docs.forEach((d) => { if (d.data().name) acc[d.id] = d.data().name; });
  const people = pSnap.docs.map((d) => ({ id: d.id, ...d.data() })), logs = lSnap.docs.map((d) => d.data());
  const title = a.title || a.name || 'La liada';
  let totMl = 0; logs.forEach((l) => { totMl += l.amt || 0; });
  for (const d of pushSnap.docs) {
    const x = d.data(); if (!(x.tokens || []).length || x.resumen === false || !acc[d.id]) continue;
    const k = canon(acc[d.id]); const p = people.find((q) => q.name && canon(q.name) === k); if (!p) continue;
    const mine = logs.filter((l) => l.pid === p.id); const ml = mine.reduce((s, l) => s + (l.amt || 0), 0);
    const hh = Math.max(0, ((p.gone || a.end) - Math.max(p.at || a.start, a.start)) / 3600000);
    const f = (n) => String(Math.round(n * 100) / 100).replace('.', ',');
    await send(d.id, x.tokens, { title: '🏁 ' + title + ' ha terminado', body: 'Tú: ' + mine.length + ' chorros · ' + f(ml) + ' ml · ' + f(Math.round(hh * 10) / 10) + ' h (de ' + f(totMl) + ' ml en total). Toca para ver el resumen y tus medallas.', tag: 'fin-' + sid, url: URL + '?resumen=' + sid });
  }
});

/* Copia de seguridad automática cada noche (04:00) en Firebase Storage: backups/chorrometro-AAAA-MM-DD.json. Se guardan 45 días. */
exports.copia = onSchedule({ schedule: '0 4 * * *', region: REGION, timeZone: 'Europe/Madrid', retryCount: 1, memory: '512MiB' }, async () => {
  const cols = ['sessions', 'people', 'logs', 'activity', 'trash', 'places', 'colors', 'aliases', 'accounts', 'regnames', 'members', 'meta'];
  const out = { app: 'Chorrómetro', exportado: new Date().toISOString() };
  for (const c of cols) { const s = await db.collection(c).get(); out[c] = s.docs.map((d) => ({ ...d.data(), _id: d.id })); }
  const day = new Date().toISOString().slice(0, 10), bucket = admin.storage().bucket();
  await bucket.file('backups/chorrometro-' + day + '.json').save(JSON.stringify(out), { contentType: 'application/json', resumable: false });
  const [files] = await bucket.getFiles({ prefix: 'backups/' }); const lim = Date.now() - 45 * 86400000;
  for (const f of files) { const m = f.name.match(/(\d{4}-\d{2}-\d{2})\.json$/); if (m && new Date(m[1]).getTime() < lim) await f.delete().catch(() => {}); }
  console.log('copia', day, Object.keys(out).map((k) => k + ':' + (Array.isArray(out[k]) ? out[k].length : '')).join(' '));
});

/* Acceso por liada: access/{uid} = { sids: liadas que puede leer, mine: liadas en las que estuvo } */
async function recomputeAccess(withLogs) {
  const [mSnap, sSnap, pSnap, aSnap, alSnap] = await Promise.all([db.collection('members').get(), db.collection('sessions').get(), db.collection('people').get(), db.collection('accounts').get(), db.doc('aliases/map').get()]);
  const al = alSnap.exists ? alSnap.data() : {}; const canon = (n) => { const k = nrm(n); return al[k] ? nrm(al[k]) : k; };
  const sess = sSnap.docs.filter((d) => !d.data().deleted), active = sess.filter((d) => !d.data().end).map((d) => d.id), valid = new Set(sess.map((d) => d.id));
  const byName = {}; pSnap.docs.forEach((d) => { const x = d.data(); if (!x.name || !x.sid || !valid.has(x.sid)) return; const k = canon(x.name); (byName[k] = byName[k] || new Set()).add(x.sid); });
  const byUid = {}; if (withLogs) { const lSnap = await db.collection('logs').select('by', 'sid').get(); lSnap.docs.forEach((d) => { const x = d.data(); if (x.by && x.sid && valid.has(x.sid)) (byUid[x.by] = byUid[x.by] || new Set()).add(x.sid); }); }
  const acc = {}; aSnap.docs.forEach((d) => { if (d.data().name) acc[d.id] = d.data().name; });
  const prev = {}; (await db.collection('access').get()).docs.forEach((d) => { prev[d.id] = d.data(); });
  const batch = db.batch(); let n = 0;
  mSnap.docs.forEach((d) => {
    const m = d.data(); if (m.status !== 'approved' || m.role === 'owner') return;
    const mine = new Set([...(acc[d.id] ? (byName[canon(acc[d.id])] || []) : []), ...(withLogs ? (byUid[d.id] || []) : ((prev[d.id] && prev[d.id].byLogs) || []))]);
    const sids = [...new Set([...mine, ...active])].sort(), mineA = [...mine].sort();
    const p = prev[d.id] || {}; const byLogs = withLogs ? [...(byUid[d.id] || [])] : (p.byLogs || []);
    if (JSON.stringify(p.sids) === JSON.stringify(sids) && JSON.stringify(p.mine) === JSON.stringify(mineA)) return;
    batch.set(db.doc('access/' + d.id), { sids, mine: mineA, byLogs, at: Date.now() }); n++;
  });
  if (n) await batch.commit();
  return n;
}
exports.accesoPersonas = onDocumentWritten({ document: 'people/{id}', region: REGION }, async () => { await recomputeAccess(false); });
exports.accesoLiadas = onDocumentWritten({ document: 'sessions/{id}', region: REGION }, async () => { await recomputeAccess(false); });
exports.accesoCuentas = onDocumentWritten({ document: 'accounts/{id}', region: REGION }, async () => { await recomputeAccess(false); });
exports.accesoMiembros = onDocumentWritten({ document: 'members/{id}', region: REGION }, async () => { await recomputeAccess(false); });
exports.accesoRevision = onSchedule({ schedule: 'every 30 minutes', region: REGION, timeZone: 'Europe/Madrid', retryCount: 0 }, async () => { const n = await recomputeAccess(true); console.log('acceso actualizado', n); });
