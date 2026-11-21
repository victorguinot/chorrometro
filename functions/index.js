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
    data: { title: msg.title, body: msg.body || '', tag: msg.tag || 'chorro', url: URL },
    webpush: { headers: { Urgency: 'high', TTL: '1800' }, notification: { title: msg.title, body: msg.body || '', icon: URL + 'icon-192.png', tag: msg.tag || 'chorro' }, fcmOptions: { link: URL } }
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
    const locs = S.locs || []; const loc = locs.length ? locs[locs.length - 1].loc : (S.loc || '');
    for (const x of want) {
      const k = canon(acc[x.uid]);
      const p = people.find((q) => q.name && canon(q.name) === k);
      if (!p || p.gone) continue;
      if ((p.away || []).some((a) => a.f <= now && !a.t)) continue;
      const back = Math.max(0, ...(p.away || []).map((a) => a.t || 0));
      const ref = Math.max(last[p.id] || Math.max(p.at || 0, S.start || 0), back);
      const el = now - ref, sent = x.sent || {}, upd = {};
      const minT = (x.min || 60) * 60000, minM = (x.muchoMin || 120) * 60000;
      if (x.mucho !== false && el >= minM && sent.mucho !== ref && el < minM + 6 * 3600000) {
        await send(x.uid, x.tokens, { title: '😬 ' + p.name + ', llevas ' + dur(el) + ' sin tomar', body: loc ? 'En ' + loc + '. Apunta tu chorro en el Chorrómetro.' : 'Apunta tu chorro en el Chorrómetro.', tag: 'mucho' });
        upd['sent.mucho'] = ref; upd['sent.toca'] = ref;
      } else if (x.toca !== false && el >= minT && sent.toca !== ref && el < minT + 3 * 3600000) {
        await send(x.uid, x.tokens, { title: '⏰ ¡Te toca, ' + p.name + '!', body: 'Hace ' + dur(el) + ' de tu último chorro' + (loc ? ' · ' + loc : '') + '.', tag: 'toca' });
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
