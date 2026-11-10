/* Chorrómetro · capa Firebase: sustituye window.claude (db + user) y gestiona el acceso */
(function () {
  'use strict';
  window.CHORRO_STANDALONE = true;
  var cfg = window.CHORRO_FIREBASE;
  firebase.initializeApp(cfg);
  var auth = firebase.auth(), fs = firebase.firestore();
  try { fs.settings({ ignoreUndefinedProperties: true, merge: true }); } catch (e) {}
  try { fs.enablePersistence({ synchronizeTabs: true }).catch(function () {}); } catch (e) {}

  var resolveReady, ready = new Promise(function (r) { resolveReady = r; });
  var me = null, member = null, members = {}, unMem = null;

  /* ---------- pantalla de acceso ---------- */
  var css = document.createElement('style');
  css.textContent =
    '#fbgate{position:fixed;inset:0;z-index:100;background:var(--bg,#eef2f3);display:flex;align-items:center;justify-content:center;padding:24px}' +
    '#fbgate .g{max-width:380px;width:100%;background:var(--surf,#fff);border:1px solid var(--line,#d3dde0);border-radius:16px;padding:28px 24px;text-align:center;font-family:"IBM Plex Sans",system-ui,sans-serif;color:var(--ink,#14262b)}' +
    '#fbgate h1{font-size:26px;margin:0 0 4px}#fbgate p{color:var(--mut,#5d7176);margin:8px 0 18px;line-height:1.45}' +
    '#fbgate button{font:600 16px "IBM Plex Sans",system-ui,sans-serif;padding:12px 18px;border-radius:10px;border:0;background:var(--acc,#0b6e7f);color:#fff;cursor:pointer;width:100%;margin-top:8px}' +
    '#fbgate button.s{background:transparent;color:var(--mut,#5d7176);border:1px solid var(--line,#d3dde0)}' +
    '#memModal{position:fixed;inset:0;z-index:90;background:rgba(0,0,0,.45);display:flex;align-items:flex-start;justify-content:center;padding:24px 12px;overflow:auto}' +
    '#memModal .mc{background:var(--surf,#fff);border-radius:12px;padding:16px;max-width:560px;width:100%;font-family:"IBM Plex Sans",system-ui,sans-serif;color:var(--ink,#14262b)}' +
    '#memModal .mr{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 0;border-bottom:1px solid var(--line,#d3dde0)}#memModal .mr .nm{flex:1;min-width:150px}' +
    '#memModal .em{font-size:12px;color:var(--mut,#5d7176)}#memModal h3{margin:16px 0 6px;font-size:15px}#memModal select{font-size:14px;padding:4px}';
  document.head.appendChild(css);
  var gate = document.createElement('div'); gate.id = 'fbgate';
  function show(html) { gate.innerHTML = '<div class="g"><h1>💧 Chorrómetro</h1>' + html + '</div>'; if (!gate.parentNode) document.body.appendChild(gate); }
  function hide() { if (gate.parentNode) gate.parentNode.removeChild(gate); }
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function login() {
    var p = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(p).catch(function (e) {
      if (e && (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment')) auth.signInWithRedirect(p);
      else if (e && e.code !== 'auth/popup-closed-by-user') show('<p>No se pudo entrar: ' + esc(e.message) + '</p><button id="gIn">Probar otra vez</button>'), bind();
    });
  }
  function bind() {
    var b = document.getElementById('gIn'); if (b) b.onclick = login;
    var o = document.getElementById('gOut'); if (o) o.onclick = function () { auth.signOut(); };
    var c = document.getElementById('gClaim'); if (c) c.onclick = claimOwner;
  }
  function claimOwner() {
    var u = auth.currentUser; if (!u) return;
    var bt = fs.batch();
    bt.set(fs.doc('meta/owner'), { uid: u.uid, at: Date.now() });
    bt.set(fs.doc('members/' + u.uid), { name: u.displayName || u.email, email: u.email || '', photo: u.photoURL || '', role: 'owner', status: 'approved', at: Date.now() });
    bt.commit().catch(function (e) { show('<p>No se pudo: ' + esc(e.message) + '</p><button class="s" id="gOut">Salir</button>'); bind(); });
  }

  if (!gate.parentNode) show('<p>Cargando…</p>');

  auth.onAuthStateChanged(function (u) {
    if (unMem) { unMem(); unMem = null; }
    me = u;
    if (!u) { show('<p>Registro de chorros del grupo. Entra con tu cuenta de Google; el organizador aprobará tu acceso.</p><button id="gIn">Entrar con Google</button>'); bind(); return; }
    var ref = fs.doc('members/' + u.uid);
    unMem = ref.onSnapshot(function (d) {
      if (!d.exists) {
        fs.doc('meta/owner').get().then(function (o) {
          if (!o.exists) { show('<p>Hola, ' + esc(u.displayName) + '. Todavía no hay organizador.</p><button id="gClaim">Soy el organizador</button><button class="s" id="gOut">Salir</button>'); bind(); return; }
          ref.set({ name: u.displayName || u.email, email: u.email || '', photo: u.photoURL || '', status: 'pending', at: Date.now() });
        }, function (e) { show('<p>Error: ' + esc(e.message) + '</p><button class="s" id="gOut">Salir</button>'); bind(); });
        return;
      }
      member = d.data();
      if (member.status === 'approved') { hide(); resolveReady(); addMembersBtn(); return; }
      if (member.status === 'blocked') { show('<p>Tu acceso al Chorrómetro está desactivado. Habla con el organizador.</p><button class="s" id="gOut">Salir</button>'); bind(); return; }
      show('<p>Hola, ' + esc(u.displayName) + '. Tu solicitud está enviada.<br>En cuanto el organizador la acepte, entrarás automáticamente.</p><button class="s" id="gOut">Salir</button>'); bind();
    }, function (e) { show('<p>Error: ' + esc(e.message) + '</p><button class="s" id="gOut">Salir</button>'); bind(); });
  });

  /* miembros (para nombres y para el panel) */
  function watchMembers() {
    fs.collection('members').onSnapshot(function (s) {
      var o = {}; s.docs.forEach(function (d) { o[d.id] = d.data(); }); members = o;
      var b = document.getElementById('memBtn'); if (b) { var n = Object.keys(o).filter(function (k) { return o[k].status === 'pending'; }).length; b.textContent = '👥 Miembros' + (n ? ' (' + n + ')' : ''); }
      if (document.getElementById('memModal')) renderMembers();
    }, function () {});
  }
  ready.then(watchMembers);

  /* ---------- window.claude ---------- */
  var userNs = {
    isOwner: function () { return ready.then(function () { return member.role === 'owner'; }); },
    canEdit: function () { return ready.then(function () { return member.role === 'owner'; }); },
    can: function (n) { return ready.then(function () { return n === 'data.write' ? (member.role === 'owner' || member.role === 'colab') : null; }); },
    id: function () { return ready.then(function () { return me.uid; }); },
    me: function () { return ready.then(function () { return { id: me.uid, name: me.displayName || '', isMe: true }; }); },
    profiles: function (ids) { return ready.then(function () { var o = {}; (ids || []).forEach(function (i) { var m = members[i]; o[i] = { id: i, name: m ? m.name : '', isMe: me && i === me.uid }; }); return o; }); }
  };
  window.claude = {
    use: function (n) {
      if (n === 'db') return ready.then(function () { return fs; });
      if (n === 'user') return ready.then(function () { return userNs; });
      return Promise.resolve(null);
    }
  };

  /* ---------- panel de miembros (solo organizador) ---------- */
  function addMembersBtn() {
    if (member.role !== 'owner' || document.getElementById('memBtn')) return;
    var tools = document.querySelector('.tools'); if (!tools) return;
    var b = document.createElement('button'); b.className = 's'; b.id = 'memBtn'; b.textContent = '👥 Miembros';
    b.onclick = openMembers; tools.appendChild(b);
    var o = document.createElement('button'); o.className = 's'; o.textContent = '🚪 Salir'; o.onclick = function () { auth.signOut(); location.reload(); }; tools.appendChild(o);
  }
  function openMembers() {
    var m = document.createElement('div'); m.id = 'memModal';
    m.innerHTML = '<div class="mc"></div>'; document.body.appendChild(m);
    m.onclick = function (e) { if (e.target === m) m.remove(); };
    renderMembers();
  }
  var ROLES = { owner: 'Organizador', colab: 'Colaborador', viewer: 'Solo lectura' };
  function renderMembers() {
    var box = document.querySelector('#memModal .mc'); if (!box) return;
    var ids = Object.keys(members), pend = ids.filter(function (i) { return members[i].status === 'pending'; }),
      ok = ids.filter(function (i) { return members[i].status === 'approved'; }), bl = ids.filter(function (i) { return members[i].status === 'blocked'; });
    function row(i) {
      var x = members[i], h = '<div class="mr"><div class="nm"><b>' + esc(x.name) + '</b>' + (i === me.uid ? ' (tú)' : '') + '<div class="em">' + esc(x.email) + '</div></div>';
      if (x.status === 'pending') h += '<select data-r="' + i + '"><option value="colab">Colaborador</option><option value="viewer">Solo lectura</option></select><button class="go" data-ok="' + i + '">Aceptar</button><button class="s" data-no="' + i + '">Rechazar</button>';
      else if (x.status === 'approved' && x.role !== 'owner') h += '<select data-role="' + i + '">' + ['colab', 'viewer'].map(function (r) { return '<option value="' + r + '"' + (x.role === r ? ' selected' : '') + '>' + ROLES[r] + '</option>'; }).join('') + '</select><button class="s" data-no="' + i + '">Quitar acceso</button>';
      else if (x.status === 'approved') h += '<span class="em">Organizador</span>';
      else h += '<button class="s" data-ok="' + i + '">Volver a dar acceso</button><button class="s" data-del="' + i + '">Borrar</button>';
      return h + '</div>';
    }
    box.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:17px">👥 Miembros</b><button class="s" id="memClose">Cerrar</button></div>' +
      '<p class="em" style="margin:6px 0 0">Comparte la dirección de esta web. Quien entre con Google aparecerá aquí para que lo aceptes.</p>' +
      (pend.length ? '<h3>Solicitudes (' + pend.length + ')</h3>' + pend.map(row).join('') : '') +
      '<h3>Con acceso (' + ok.length + ')</h3>' + ok.map(row).join('') +
      (bl.length ? '<h3>Sin acceso</h3>' + bl.map(row).join('') : '') +
      '<h3>Importar datos</h3><p class="em">Sube una copia <code>chorrometro-AAAA-MM-DD.json</code> para cargar chills, personas y chorros.</p><input type="file" id="impF" accept=".json,application/json"><div class="em" id="impMsg"></div>';
    document.getElementById('memClose').onclick = function () { document.getElementById('memModal').remove(); };
    box.querySelectorAll('[data-ok]').forEach(function (b) { b.onclick = function () { var i = b.dataset.ok, s = box.querySelector('[data-r="' + i + '"]'); fs.doc('members/' + i).update({ status: 'approved', role: s ? s.value : (members[i].role || 'colab') }); }; });
    box.querySelectorAll('[data-no]').forEach(function (b) { b.onclick = function () { fs.doc('members/' + b.dataset.no).update({ status: 'blocked' }); }; });
    box.querySelectorAll('[data-del]').forEach(function (b) { b.onclick = function () { fs.doc('members/' + b.dataset.del).delete(); }; });
    box.querySelectorAll('[data-role]').forEach(function (s) { s.onchange = function () { fs.doc('members/' + s.dataset.role).update({ role: s.value }); }; });
    document.getElementById('impF').onchange = function () { var f = this.files[0]; if (f) importFile(f); };
  }

  /* ---------- importar una copia del Chorrómetro ---------- */
  var SKIP = { app: 1, artefacto: 1, exportado: 1, members: 1 };
  function importFile(f) {
    var msg = document.getElementById('impMsg');
    f.text().then(function (t) {
      var d = JSON.parse(t), oldOwner = d.owner || 'u_5ghsBA6FuCzjoBiTKbhxXA', writes = [];
      Object.keys(d).forEach(function (c) {
        if (SKIP[c] || !Array.isArray(d[c])) return;
        d[c].forEach(function (x) {
          var o = {}, id = x._id; if (!id) return;
          for (var k in x) if (k !== '_id') o[k] = x[k];
          if (o.by === oldOwner) o.by = me.uid; if (o.delBy === oldOwner) o.delBy = me.uid;
          if (c === 'accounts' && id === oldOwner) id = me.uid;
          if (c === 'meta' && id === 'owner') return;
          writes.push([c + '/' + id, o]);
        });
      });
      if (!confirm('Se van a importar ' + writes.length + ' documentos. ¿Seguir?')) return;
      var i = 0;
      (function next() {
        if (i >= writes.length) { msg.textContent = 'Importados ' + writes.length + ' documentos. Recargando…'; setTimeout(function () { location.reload(); }, 1200); return; }
        var bt = fs.batch(); writes.slice(i, i + 400).forEach(function (w) { bt.set(fs.doc(w[0]), w[1]); });
        bt.commit().then(function () { i += 400; msg.textContent = 'Importando… ' + Math.min(i, writes.length) + '/' + writes.length; next(); }, function (e) { msg.textContent = 'Error: ' + e.message; });
      })();
    }).catch(function (e) { msg.textContent = 'Archivo no válido: ' + e.message; });
  }
})();
