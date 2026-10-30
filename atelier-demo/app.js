/* Alakhil Mobile · Réparations
 * Phone-first app for a phone shop: repair tickets, payments, WhatsApp/SMS messages,
 * sales, stock and cash totals. All data stays on the phone (localStorage) with JSON backup.
 */
(function () {
  'use strict';

  // Demo copy: separate storage key so it never touches the shop's real data.
  const KEY = 'alakhil-atelier-demo-v1';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const nowISO = () => new Date().toISOString();
  const round = (n) => Math.round(n * 100) / 100;
  const euro = (n) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n || 0);
  const parseMoney = (v) => { const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) && n > 0 ? round(n) : 0; };
  const pad = (n) => String(n).padStart(2, '0');
  const fmtDate = (iso) => { const d = new Date(iso); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const fmtDay = (iso) => { const d = new Date(iso); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`; };

  const STATUS = {
    recu: 'Reçu',
    reparation: 'En réparation',
    pret: 'Prêt',
    rendu: 'Récupéré',
    annule: 'Annulé'
  };
  const FLOW = ['recu', 'reparation', 'pret', 'rendu'];
  const METHODS = { especes: 'Espèces', carte: 'Carte', autre: 'Autre' };
  const CATS = { telephone: 'Téléphones', accessoire: 'Accessoires', piece: 'Pièces détachées' };

  const DEFAULT_SETTINGS = {
    shopName: 'Votre Boutique',
    shopAddress: '',
    shopPhone: '',
    footer: 'Conservez ce ticket pour récupérer votre appareil.',
    msgTicket: 'Bonjour {nom}, {boutique} a bien reçu votre {modele}.\nTicket n° {ticket}\nRéparation : {probleme}\nPrix : {prix} · Payé : {paye} · Reste : {reste}\nMerci de votre confiance !',
    msgReady: 'Bonjour {nom}, votre {modele} est prêt ✅\nTicket n° {ticket} · Reste à payer : {reste}\nVous pouvez venir le récupérer chez {boutique}. À bientôt !'
  };

  /* ---------------- Storage ---------------- */
  function blank() {
    return { version: 1, settings: { ...DEFAULT_SETTINGS }, seq: { repair: 0, sale: 0 }, repairs: [], sales: [], stock: [] };
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const d = JSON.parse(raw);
        const b = blank();
        return { ...b, ...d, settings: { ...b.settings, ...(d.settings || {}) }, seq: { ...b.seq, ...(d.seq || {}) } };
      }
    } catch (e) { /* private mode or corrupt data */ }
    return blank();
  }
  let db = load();
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(db)); return true; } catch (e) { toast('⚠️ Impossible d’enregistrer sur ce téléphone'); return false; }
  }

  /* ---------------- Helpers ---------------- */
  const paidOf = (r) => round((r.payments || []).reduce((s, p) => s + p.amount, 0));
  const restOf = (r) => (r.status === 'annule' ? 0 : Math.max(0, round(r.price - paidOf(r))));
  const saleTotal = (s) => round(s.items.reduce((t, i) => t + i.qty * i.price, 0));
  const findRepair = (id) => db.repairs.find((r) => r.id === id);
  const findSale = (id) => db.sales.find((s) => s.id === id);
  const findStock = (id) => db.stock.find((s) => s.id === id);

  function intlPhone(phone) {
    let p = String(phone || '').replace(/[^\d+]/g, '');
    if (p.startsWith('00')) p = '+' + p.slice(2);
    if (/^0\d{9}$/.test(p)) p = '+33' + p.slice(1);
    if (!p.startsWith('+')) p = '+' + p;
    return p;
  }
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const waLink = (phone, text) => `https://wa.me/${intlPhone(phone).slice(1)}?text=${encodeURIComponent(text)}`;
  const smsLink = (phone, text) => `sms:${intlPhone(phone)}${isIOS ? '&' : '?'}body=${encodeURIComponent(text)}`;
  const telLink = (phone) => `tel:${intlPhone(phone)}`;

  function fillTemplate(tpl, r) {
    const map = {
      nom: r.client.name, modele: r.device.model, ticket: r.number, probleme: r.problem,
      prix: euro(r.price), paye: euro(paidOf(r)), reste: euro(restOf(r)), boutique: db.settings.shopName
    };
    return tpl.replace(/\{(\w+)\}/g, (m, k) => (k in map ? map[k] : m));
  }

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2300);
  }

  /* ---------------- Navigation ---------------- */
  const state = { tab: 'repairs', view: 'list', id: null, filter: 'open', q: '', period: 'today' };
  function go(patch) { Object.assign(state, patch); render(); window.scrollTo(0, 0); }
  function back() {
    if (state.view === 'form' && state.id) go({ view: 'detail' });
    else go({ view: 'list', id: null });
  }

  $('#back').addEventListener('click', back);
  $$('#tabs button').forEach((b) => b.addEventListener('click', () => go({ tab: b.dataset.tab, view: 'list', id: null, q: '' })));
  $('#fab').addEventListener('click', () => go({ view: 'form', id: null, draft: null }));

  function header(title, opts = {}) {
    $('#title').textContent = title;
    $('#subtitle').textContent = opts.subtitle || db.settings.shopName;
    $('#back').hidden = !opts.back;
    const a = $('#topAction');
    a.hidden = !opts.action;
    if (opts.action) { a.textContent = opts.action.label; a.onclick = opts.action.onClick; }
    $('#fab').hidden = !opts.fab;
    $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === state.tab));
  }

  function render() {
    const v = $('#view');
    const views = {
      repairs: { list: repairList, form: repairForm, detail: repairDetail },
      sales: { list: saleList, form: saleForm, detail: saleDetail },
      stock: { list: stockList, form: stockForm },
      cash: { list: cashView },
      settings: { list: settingsView }
    };
    const fn = (views[state.tab] || views.repairs)[state.view] || views[state.tab].list;
    v.innerHTML = '';
    fn(v);
  }

  const icon = {
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
    wa: '<svg viewBox="0 0 24 24"><path d="M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 20.5l1.7-5.4A8.4 8.4 0 1 1 21 11.5z"/></svg>',
    sms: '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    tel: '<svg viewBox="0 0 24 24"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/></svg>',
    print: '<svg viewBox="0 0 24 24"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>',
    edit: '<svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
    euro: '<svg viewBox="0 0 24 24"><path d="M18 7a7 7 0 1 0 0 10M4 10h10M4 14h10"/></svg>',
    share: '<svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>'
  };

  /* ================= REPAIRS ================= */
  function repairList(v) {
    header('Réparations', { fab: true });
    const counts = { open: 0, pret: 0, rendu: 0, all: db.repairs.length };
    db.repairs.forEach((r) => {
      if (r.status === 'recu' || r.status === 'reparation') counts.open++;
      if (r.status === 'pret') counts.pret++;
      if (r.status === 'rendu') counts.rendu++;
    });
    const q = state.q.trim().toLowerCase();
    let list = db.repairs.slice().sort((a, b) => b.n - a.n);
    if (!q) {
      if (state.filter === 'open') list = list.filter((r) => r.status === 'recu' || r.status === 'reparation');
      if (state.filter === 'pret') list = list.filter((r) => r.status === 'pret');
      if (state.filter === 'rendu') list = list.filter((r) => r.status === 'rendu' || r.status === 'annule');
    } else {
      list = list.filter((r) => [r.number, r.client.name, r.client.phone, r.device.model, r.device.imei, r.problem].join(' ').toLowerCase().includes(q));
    }
    v.innerHTML = `
      <div class="search">${icon.search}<input id="q" type="search" placeholder="Nom, téléphone, modèle, n° ticket…" value="${esc(state.q)}" autocomplete="off"></div>
      <div class="chips" ${q ? 'hidden' : ''}>
        ${[['open', 'En cours'], ['pret', 'Prêts'], ['rendu', 'Récupérés'], ['all', 'Tous']].map(([k, l]) =>
          `<button class="chip ${state.filter === k ? 'on' : ''}" data-f="${k}">${l}<i>${counts[k]}</i></button>`).join('')}
      </div>
      <div id="list">${list.length ? list.map(repairItem).join('') : `<div class="empty"><b>${q ? 'Aucun résultat' : 'Aucune réparation ici'}</b>${q ? '' : 'Appuyez sur + pour enregistrer un téléphone.'}</div>`}</div>`;
    const qi = $('#q', v);
    qi.addEventListener('input', () => { state.q = qi.value; const pos = qi.selectionStart; render(); const n = $('#q'); n.focus(); n.setSelectionRange(pos, pos); });
    $$('.chip', v).forEach((c) => c.addEventListener('click', () => go({ filter: c.dataset.f })));
    $$('[data-id]', v).forEach((el) => el.addEventListener('click', () => go({ view: 'detail', id: el.dataset.id })));
  }

  function repairItem(r) {
    const rest = restOf(r);
    return `<button class="item" data-id="${r.id}">
      <div class="item__main">
        <div class="item__top"><span class="ticket">${esc(r.number)}</span><span class="item__name">${esc(r.client.name)}</span></div>
        <div class="item__sub">${esc(r.device.model)} · ${esc(r.problem)}</div>
        <div class="item__sub small">${fmtDay(r.createdAt)} · ${esc(r.client.phone)}</div>
      </div>
      <div class="item__side">
        <span class="badge st-${r.status}">${STATUS[r.status]}</span><br>
        ${rest > 0 ? `<span class="due">${euro(rest)}</span>` : (r.status === 'annule' ? '' : '<span class="paid">Payé ✓</span>')}
      </div>
    </button>`;
  }

  function repairForm(v) {
    const r = state.id ? findRepair(state.id) : null;
    header(r ? `Modifier ${r.number}` : 'Nouvelle réparation', { back: true, subtitle: r ? r.client.name : db.settings.shopName });
    v.innerHTML = `
      <form id="f" autocomplete="off" novalidate>
        <div class="h2">Client</div>
        <div class="card">
          <label class="field"><span>Nom du client *</span><input name="name" required value="${esc(r?.client.name)}" autocapitalize="words"></label>
          <label class="field"><span>Téléphone *</span><input name="phone" type="tel" inputmode="tel" required value="${esc(r?.client.phone)}" placeholder="06 12 34 56 78"></label>
        </div>
        <div class="h2">Appareil</div>
        <div class="card">
          <label class="field"><span>Modèle *</span><input name="model" required value="${esc(r?.device.model)}" placeholder="iPhone 13, Samsung A52…" list="models"></label>
          <datalist id="models">${modelSuggestions().map((m) => `<option value="${esc(m)}">`).join('')}</datalist>
          <label class="field"><span>Réparation / problème *</span><input name="problem" required value="${esc(r?.problem)}" placeholder="Changement écran, batterie…" list="problems"></label>
          <datalist id="problems">${['Changement écran', 'Changement batterie', 'Connecteur de charge', 'Vitre arrière', 'Caméra', 'Haut-parleur', 'Désoxydation', 'Déblocage / logiciel'].map((p) => `<option value="${p}">`).join('')}</datalist>
          <div class="two">
            <label class="field"><span>IMEI / n° série</span><input name="imei" inputmode="numeric" value="${esc(r?.device.imei)}"></label>
            <label class="field"><span>Code de l’appareil</span><input name="code" value="${esc(r?.device.code)}" placeholder="facultatif"></label>
          </div>
          <label class="field"><span>État / remarques</span><textarea name="notes" placeholder="Rayures, fissures, accessoires laissés…">${esc(r?.notes)}</textarea></label>
        </div>
        <div class="h2">Prix</div>
        <div class="card">
          <label class="field"><span>Prix de la réparation (€) *</span><input name="price" inputmode="decimal" required value="${r ? String(r.price).replace('.', ',') : ''}" placeholder="0,00"></label>
          ${r ? `<p class="muted small">Les paiements se gèrent depuis la fiche de la réparation.</p>` : `
          <label class="field"><span>Payé maintenant / acompte (€)</span><input name="advance" inputmode="decimal" placeholder="0,00"></label>
          <div class="seg" role="radiogroup" aria-label="Mode de paiement">
            ${Object.entries(METHODS).map(([k, l], i) => `<label><input type="radio" name="method" value="${k}" ${i === 0 ? 'checked' : ''}><span>${l}</span></label>`).join('')}
          </div>
          <div class="sum rest" style="margin-top:10px"><span>Reste à payer</span><b id="rest">${euro(0)}</b></div>`}
        </div>
        <button class="btn btn-primary btn-block" type="submit">${r ? 'Enregistrer' : 'Créer le ticket'}</button>
      </form>`;
    const f = $('#f', v);
    const upd = () => { const el = $('#rest', v); if (el) el.textContent = euro(Math.max(0, parseMoney(f.price.value) - parseMoney(f.advance.value))); };
    f.addEventListener('input', upd);
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(f));
      const missing = ['name', 'phone', 'model', 'problem'].find((k) => !String(data[k] || '').trim());
      if (missing) { toast('Merci de remplir les champs avec *'); f[missing].focus(); return; }
      const price = parseMoney(data.price);
      if (!price) { toast('Indiquez le prix de la réparation'); f.price.focus(); return; }
      if (r) {
        r.client = { name: data.name.trim(), phone: data.phone.trim() };
        r.device = { model: data.model.trim(), imei: data.imei.trim(), code: data.code.trim() };
        r.problem = data.problem.trim(); r.notes = data.notes.trim(); r.price = price;
        save(); toast('Réparation modifiée'); go({ view: 'detail' });
        return;
      }
      const advance = Math.min(parseMoney(data.advance), price);
      db.seq.repair += 1;
      const now = nowISO();
      const rep = {
        id: uid(), n: db.seq.repair, number: 'R-' + String(db.seq.repair).padStart(4, '0'), createdAt: now,
        client: { name: data.name.trim(), phone: data.phone.trim() },
        device: { model: data.model.trim(), imei: data.imei.trim(), code: data.code.trim() },
        problem: data.problem.trim(), notes: data.notes.trim(), price,
        payments: advance ? [{ id: uid(), date: now, amount: advance, method: data.method || 'especes' }] : [],
        status: 'recu', history: [{ status: 'recu', date: now }]
      };
      db.repairs.push(rep);
      save(); toast(`Ticket ${rep.number} créé`);
      go({ view: 'detail', id: rep.id });
    });
    if (!r) setTimeout(() => f.name.focus(), 50);
  }

  function modelSuggestions() {
    const seen = new Set(db.repairs.map((r) => r.device.model));
    ['iPhone 11', 'iPhone 12', 'iPhone 13', 'iPhone 14', 'iPhone 15', 'Samsung Galaxy A52', 'Samsung Galaxy S21', 'Xiaomi Redmi Note 12'].forEach((m) => seen.add(m));
    return [...seen].slice(0, 40);
  }

  function setStatus(r, status) {
    if (r.status === status) return;
    r.status = status;
    r.history.push({ status, date: nowISO() });
    save();
  }

  function repairDetail(v) {
    const r = findRepair(state.id);
    if (!r) { go({ view: 'list', id: null }); return; }
    const rest = restOf(r), paid = paidOf(r);
    const msgKind = state.msgKind || (r.status === 'pret' ? 'ready' : 'ticket');
    const msg = fillTemplate(msgKind === 'ready' ? db.settings.msgReady : db.settings.msgTicket, r);
    header(r.number, { back: true, subtitle: STATUS[r.status], action: { label: 'Modifier', onClick: () => go({ view: 'form' }) } });
    v.innerHTML = `
      <div class="hero">
        <div class="row between"><span class="ticket">${esc(r.number)}</span><span class="badge st-${r.status}">${STATUS[r.status]}</span></div>
        <h2>${esc(r.client.name)}</h2>
        <p>${esc(r.device.model)} · ${esc(r.problem)}</p>
        <div class="money">
          <div><small>Prix</small><b>${euro(r.price)}</b></div>
          <div><small>Payé</small><b>${euro(paid)}</b></div>
          <div class="r"><small>Reste</small><b>${euro(rest)}</b></div>
        </div>
      </div>

      ${r.status === 'annule' ? '' : `<div class="steps">${FLOW.map((s) => {
        const idx = FLOW.indexOf(r.status), si = FLOW.indexOf(s);
        return `<button data-st="${s}" class="${s === r.status ? 'on' : si < idx ? 'done' : ''}">${STATUS[s]}</button>`;
      }).join('')}</div>`}

      ${rest > 0 ? `<div class="card" id="payBox">
        <div class="row between"><b>Encaisser</b><span class="due">${euro(rest)} restant</span></div>
        <div class="two" style="margin-top:10px">
          <label class="field"><span>Montant (€)</span><input id="payAmount" inputmode="decimal" value="${String(rest).replace('.', ',')}"></label>
          <label class="field"><span>Mode</span><select id="payMethod">${Object.entries(METHODS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
        </div>
        <button class="btn btn-gold btn-block" id="payBtn">${icon.euro} Encaisser le paiement</button>
      </div>` : ''}

      <div class="h2">Envoyer au client</div>
      <div class="card">
        <div class="seg" role="radiogroup" aria-label="Message">
          <label><input type="radio" name="mk" value="ticket" ${msgKind === 'ticket' ? 'checked' : ''}><span>Ticket</span></label>
          <label><input type="radio" name="mk" value="ready" ${msgKind === 'ready' ? 'checked' : ''}><span>Téléphone prêt</span></label>
        </div>
        <p class="small muted" style="white-space:pre-line;margin:10px 2px">${esc(msg)}</p>
        <div class="btns three">
          <a class="btn btn-wa" href="${waLink(r.client.phone, msg)}" target="_blank" rel="noopener">${icon.wa} WhatsApp</a>
          <a class="btn btn-sms" href="${smsLink(r.client.phone, msg)}">${icon.sms} SMS</a>
          <a class="btn btn-light" href="${telLink(r.client.phone)}">${icon.tel} Appeler</a>
        </div>
      </div>

      <div class="h2">Détails</div>
      <div class="card">
        <dl class="kv">
          <dt>Téléphone</dt><dd>${esc(r.client.phone)}</dd>
          <dt>Modèle</dt><dd>${esc(r.device.model)}</dd>
          ${r.device.imei ? `<dt>IMEI</dt><dd>${esc(r.device.imei)}</dd>` : ''}
          ${r.device.code ? `<dt>Code</dt><dd>${esc(r.device.code)}</dd>` : ''}
          ${r.notes ? `<dt>Remarques</dt><dd>${esc(r.notes)}</dd>` : ''}
          <dt>Déposé le</dt><dd>${fmtDate(r.createdAt)}</dd>
        </dl>
      </div>

      <div class="h2">Paiements</div>
      <div class="card">
        ${r.payments.length ? r.payments.map((p) => `<div class="pay"><span>${fmtDate(p.date)} · ${METHODS[p.method] || p.method}</span><b>${euro(p.amount)}</b></div>`).join('') : '<p class="muted" style="margin:0">Aucun paiement pour le moment.</p>'}
      </div>

      <div class="btns">
        <button class="btn btn-light" id="printBtn">${icon.print} Imprimer</button>
        <button class="btn btn-light" id="shareBtn">${icon.share} Partager</button>
      </div>
      <div class="btns">
        ${r.status === 'annule'
          ? '<button class="btn btn-light" id="restoreBtn">Réactiver</button>'
          : '<button class="btn btn-danger" id="cancelBtn">Annuler la réparation</button>'}
        <button class="btn btn-danger" id="delBtn">Supprimer</button>
      </div>`;

    $$('[data-st]', v).forEach((b) => b.addEventListener('click', () => {
      const s = b.dataset.st;
      if (s === 'rendu' && restOf(r) > 0) {
        if (!confirm(`Il reste ${euro(restOf(r))} à payer.\nMarquer quand même comme récupéré ?`)) { $('#payAmount')?.focus(); return; }
      }
      setStatus(r, s);
      state.msgKind = s === 'pret' ? 'ready' : null;
      if (s === 'pret') toast('Prêt ✅ Envoyez le message au client');
      else toast(STATUS[s]);
      render();
    }));
    $$('input[name=mk]', v).forEach((i) => i.addEventListener('change', () => { state.msgKind = i.value; render(); }));
    $('#payBtn', v)?.addEventListener('click', () => {
      const amount = Math.min(parseMoney($('#payAmount', v).value), restOf(r));
      if (!amount) { toast('Montant invalide'); return; }
      r.payments.push({ id: uid(), date: nowISO(), amount, method: $('#payMethod', v).value });
      save(); toast(`${euro(amount)} encaissé`);
      if (restOf(r) === 0 && r.status === 'pret' && confirm('Tout est payé. Marquer le téléphone comme récupéré ?')) setStatus(r, 'rendu');
      render();
    });
    $('#printBtn', v).addEventListener('click', () => printTicket(r));
    $('#shareBtn', v).addEventListener('click', async () => {
      const text = ticketText(r);
      if (navigator.share) { try { await navigator.share({ title: r.number, text }); } catch (e) { /* cancelled */ } }
      else { try { await navigator.clipboard.writeText(text); toast('Ticket copié'); } catch (e) { toast('Partage indisponible'); } }
    });
    $('#cancelBtn', v)?.addEventListener('click', () => { if (confirm('Annuler cette réparation ?')) { setStatus(r, 'annule'); render(); } });
    $('#restoreBtn', v)?.addEventListener('click', () => { setStatus(r, 'recu'); render(); });
    $('#delBtn', v).addEventListener('click', () => {
      if (!confirm(`Supprimer définitivement ${r.number} ? Les paiements seront aussi supprimés de la caisse.`)) return;
      db.repairs = db.repairs.filter((x) => x.id !== r.id); save(); toast('Supprimé'); go({ view: 'list', id: null });
    });
    state.msgKind = null;
  }

  function ticketText(r) {
    const s = db.settings;
    return [s.shopName, s.shopAddress, s.shopPhone, '', `Ticket ${r.number} · ${fmtDate(r.createdAt)}`, `Client : ${r.client.name} · ${r.client.phone}`,
      `Appareil : ${r.device.model}${r.device.imei ? ' · IMEI ' + r.device.imei : ''}`, `Réparation : ${r.problem}`,
      `Prix : ${euro(r.price)}`, `Payé : ${euro(paidOf(r))}`, `Reste à payer : ${euro(restOf(r))}`, '', s.footer].filter((l, i) => l || i > 2).join('\n');
  }

  function printTicket(r) {
    const s = db.settings;
    $('#print').innerHTML = `
      <h1>${esc(s.shopName)}</h1>
      ${s.shopAddress ? `<div class="c">${esc(s.shopAddress)}</div>` : ''}${s.shopPhone ? `<div class="c">${esc(s.shopPhone)}</div>` : ''}
      <hr><div class="c big">TICKET ${esc(r.number)}</div><div class="c">${fmtDate(r.createdAt)}</div><hr>
      <div>Client : ${esc(r.client.name)}</div><div>Tél : ${esc(r.client.phone)}</div>
      <div>Appareil : ${esc(r.device.model)}</div>${r.device.imei ? `<div>IMEI : ${esc(r.device.imei)}</div>` : ''}
      <div>Réparation : ${esc(r.problem)}</div>${r.notes ? `<div>Remarques : ${esc(r.notes)}</div>` : ''}
      <hr><div class="l"><span>Prix</span><span>${euro(r.price)}</span></div>
      ${r.payments.map((p) => `<div class="l"><span>Payé ${fmtDay(p.date)} (${METHODS[p.method]})</span><span>${euro(p.amount)}</span></div>`).join('')}
      <div class="l big"><span>RESTE</span><span>${euro(restOf(r))}</span></div><hr>
      <div class="c">${esc(s.footer)}</div>`;
    window.print();
  }

  /* ================= SALES ================= */
  function saleList(v) {
    header('Ventes', { fab: true });
    const list = db.sales.slice().sort((a, b) => b.n - a.n);
    const today = startOf('today');
    const todayTotal = list.filter((s) => new Date(s.date) >= today).reduce((t, s) => t + saleTotal(s), 0);
    v.innerHTML = `
      <div class="stats" style="margin-bottom:12px"><div class="stat big"><small>Ventes aujourd’hui</small><b>${euro(todayTotal)}</b></div></div>
      ${list.length ? list.map((s) => `<button class="item" data-id="${s.id}">
        <div class="item__main">
          <div class="item__top"><span class="ticket">${esc(s.number)}</span><span class="item__name">${esc(s.items.map((i) => (i.qty > 1 ? i.qty + '× ' : '') + i.name).join(', '))}</span></div>
          <div class="item__sub small">${fmtDate(s.date)} · ${METHODS[s.method]}${s.client?.name ? ' · ' + esc(s.client.name) : ''}</div>
        </div>
        <div class="item__side"><b>${euro(saleTotal(s))}</b></div>
      </button>`).join('') : '<div class="empty"><b>Aucune vente</b>Appuyez sur + pour enregistrer une vente.</div>'}`;
    $$('[data-id]', v).forEach((el) => el.addEventListener('click', () => go({ view: 'detail', id: el.dataset.id })));
  }

  function saleForm(v) {
    header('Nouvelle vente', { back: true });
    const lines = state.draft || [{ stockId: '', name: '', qty: 1, price: 0 }];
    state.draft = lines;
    const opts = db.stock.slice().sort((a, b) => a.name.localeCompare(b.name));
    const lineHtml = (l, i) => `
      <div class="card" data-line="${i}">
        <label class="field"><span>Article</span>
          <select data-k="stockId">
            <option value="">— Autre article (saisie libre) —</option>
            ${Object.entries(CATS).map(([c, cl]) => {
              const items = opts.filter((o) => o.cat === c);
              return items.length ? `<optgroup label="${cl}">${items.map((o) => `<option value="${o.id}" ${o.id === l.stockId ? 'selected' : ''}>${esc(o.name)} · ${euro(o.price)} (stock ${o.qty})</option>`).join('')}</optgroup>` : '';
            }).join('')}
          </select></label>
        ${l.stockId ? '' : `<label class="field"><span>Nom de l’article</span><input data-k="name" value="${esc(l.name)}" placeholder="Coque, chargeur, téléphone…"></label>`}
        <div class="two">
          <label class="field"><span>Quantité</span><input data-k="qty" inputmode="numeric" value="${l.qty}"></label>
          <label class="field"><span>Prix unitaire (€)</span><input data-k="price" inputmode="decimal" value="${l.price ? String(l.price).replace('.', ',') : ''}" placeholder="0,00"></label>
        </div>
        ${lines.length > 1 ? `<button class="btn btn-light btn-block" type="button" data-del="${i}">Retirer cet article</button>` : ''}
      </div>`;
    const total = () => round(lines.reduce((t, l) => t + (parseInt(l.qty, 10) || 0) * (l.price || 0), 0));
    v.innerHTML = `
      <form id="f" novalidate>
        <div class="h2">Articles</div>
        <div id="lines">${lines.map(lineHtml).join('')}</div>
        <button class="btn btn-light btn-block" type="button" id="addLine">+ Ajouter un article</button>
        <div class="h2">Client (facultatif · pour la garantie d’un téléphone)</div>
        <div class="card">
          <div class="two">
            <label class="field"><span>Nom</span><input name="cname" autocapitalize="words"></label>
            <label class="field"><span>Téléphone</span><input name="cphone" type="tel" inputmode="tel"></label>
          </div>
          <label class="field"><span>IMEI du téléphone vendu</span><input name="imei" inputmode="numeric"></label>
        </div>
        <div class="h2">Paiement</div>
        <div class="card">
          <div class="seg">${Object.entries(METHODS).map(([k, l], i) => `<label><input type="radio" name="method" value="${k}" ${i === 0 ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
          <div class="sum rest" style="margin-top:10px"><span>Total</span><b id="total">${euro(total())}</b></div>
        </div>
        <button class="btn btn-primary btn-block" type="submit">Enregistrer la vente</button>
      </form>`;
    const f = $('#f', v);
    $$('[data-line]', v).forEach((card) => {
      const i = +card.dataset.line;
      $$('[data-k]', card).forEach((el) => el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
        const k = el.dataset.k;
        if (k === 'stockId') {
          lines[i].stockId = el.value;
          const s = findStock(el.value);
          if (s) { lines[i].name = s.name; lines[i].price = s.price; }
          render(); return;
        }
        lines[i][k] = k === 'price' ? parseMoney(el.value) : k === 'qty' ? el.value : el.value;
        $('#total', v).textContent = euro(total());
      }));
    });
    $$('[data-del]', v).forEach((b) => b.addEventListener('click', () => { lines.splice(+b.dataset.del, 1); render(); }));
    $('#addLine', v).addEventListener('click', () => { lines.push({ stockId: '', name: '', qty: 1, price: 0 }); render(); });
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const items = lines.map((l) => ({ stockId: l.stockId || null, name: (l.stockId ? findStock(l.stockId)?.name : l.name || '').trim(), qty: Math.max(1, parseInt(l.qty, 10) || 1), price: l.price || 0 }))
        .filter((l) => l.name);
      if (!items.length) { toast('Ajoutez au moins un article'); return; }
      if (items.some((l) => !l.price)) { toast('Indiquez le prix de chaque article'); return; }
      for (const l of items) {
        const s = l.stockId && findStock(l.stockId);
        if (s && s.qty < l.qty && !confirm(`Stock de « ${s.name} » : ${s.qty}. Vendre quand même ${l.qty} ?`)) return;
      }
      const data = Object.fromEntries(new FormData(f));
      db.seq.sale += 1;
      const sale = {
        id: uid(), n: db.seq.sale, number: 'V-' + String(db.seq.sale).padStart(4, '0'), date: nowISO(), items,
        method: data.method || 'especes', imei: (data.imei || '').trim(),
        client: { name: (data.cname || '').trim(), phone: (data.cphone || '').trim() }
      };
      items.forEach((l) => { const s = l.stockId && findStock(l.stockId); if (s) s.qty = Math.max(0, s.qty - l.qty); });
      db.sales.push(sale);
      state.draft = null;
      save(); toast(`Vente ${euro(saleTotal(sale))} enregistrée`);
      go({ view: 'detail', id: sale.id });
    });
  }

  function saleDetail(v) {
    const s = findSale(state.id);
    if (!s) { go({ view: 'list', id: null }); return; }
    header(s.number, { back: true, subtitle: fmtDate(s.date) });
    const text = [db.settings.shopName, `Reçu ${s.number} · ${fmtDate(s.date)}`, ...s.items.map((i) => `${i.qty} × ${i.name} : ${euro(i.qty * i.price)}`),
      `Total : ${euro(saleTotal(s))} (${METHODS[s.method]})`, s.imei ? `IMEI : ${s.imei}` : '', 'Merci et à bientôt !'].filter(Boolean).join('\n');
    v.innerHTML = `
      <div class="hero"><span class="ticket">${esc(s.number)}</span><h2>${euro(saleTotal(s))}</h2><p>${METHODS[s.method]} · ${fmtDate(s.date)}</p></div>
      <div class="card">${s.items.map((i) => `<div class="pay"><span>${i.qty} × ${esc(i.name)}</span><b>${euro(i.qty * i.price)}</b></div>`).join('')}</div>
      ${s.client?.name || s.client?.phone || s.imei ? `<div class="card"><dl class="kv">
        ${s.client.name ? `<dt>Client</dt><dd>${esc(s.client.name)}</dd>` : ''}${s.client.phone ? `<dt>Téléphone</dt><dd>${esc(s.client.phone)}</dd>` : ''}
        ${s.imei ? `<dt>IMEI</dt><dd>${esc(s.imei)}</dd>` : ''}</dl></div>` : ''}
      ${s.client?.phone ? `<div class="btns"><a class="btn btn-wa" href="${waLink(s.client.phone, text)}" target="_blank" rel="noopener">${icon.wa} Reçu WhatsApp</a>
        <a class="btn btn-sms" href="${smsLink(s.client.phone, text)}">${icon.sms} Reçu SMS</a></div>` : ''}
      <button class="btn btn-danger btn-block" id="delBtn">Supprimer la vente (remet le stock)</button>`;
    $('#delBtn', v).addEventListener('click', () => {
      if (!confirm('Supprimer cette vente ? Les articles retournent dans le stock.')) return;
      s.items.forEach((l) => { const st = l.stockId && findStock(l.stockId); if (st) st.qty += l.qty; });
      db.sales = db.sales.filter((x) => x.id !== s.id); save(); toast('Vente supprimée'); go({ view: 'list', id: null });
    });
  }

  /* ================= STOCK ================= */
  function stockList(v) {
    header('Stock', { fab: true });
    const q = state.q.trim().toLowerCase();
    const items = db.stock.filter((s) => !q || s.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
    const low = db.stock.filter((s) => s.qty <= (s.min || 0)).length;
    v.innerHTML = `
      <div class="search">${icon.search}<input id="q" type="search" placeholder="Chercher un article…" value="${esc(state.q)}"></div>
      ${low ? `<div class="card" style="border-color:#f3b9ae;background:var(--red-soft)"><b style="color:var(--red)">⚠️ ${low} article(s) en stock bas</b></div>` : ''}
      ${Object.entries(CATS).map(([c, cl]) => {
        const list = items.filter((s) => s.cat === c);
        return list.length ? `<div class="h2">${cl}</div>` + list.map((s) => `
          <div class="item">
            <div class="item__main" data-edit="${s.id}">
              <div class="item__name">${esc(s.name)}</div>
              <div class="item__sub">${euro(s.price)}${s.qty <= (s.min || 0) ? ' · <span class="low">Stock bas</span>' : ''}</div>
            </div>
            <div class="qty"><button data-dec="${s.id}" aria-label="Moins">−</button><b>${s.qty}</b><button data-inc="${s.id}" aria-label="Plus">+</button></div>
          </div>`).join('') : '';
      }).join('') || `<div class="empty"><b>${q ? 'Aucun article' : 'Stock vide'}</b>${q ? '' : 'Ajoutez vos téléphones, accessoires et pièces avec +.'}</div>`}`;
    const qi = $('#q', v);
    qi.addEventListener('input', () => { state.q = qi.value; const pos = qi.selectionStart; render(); const n = $('#q'); n.focus(); n.setSelectionRange(pos, pos); });
    $$('[data-inc]', v).forEach((b) => b.addEventListener('click', () => { findStock(b.dataset.inc).qty += 1; save(); render(); }));
    $$('[data-dec]', v).forEach((b) => b.addEventListener('click', () => { const s = findStock(b.dataset.dec); s.qty = Math.max(0, s.qty - 1); save(); render(); }));
    $$('[data-edit]', v).forEach((b) => b.addEventListener('click', () => go({ view: 'form', id: b.dataset.edit })));
  }

  function stockForm(v) {
    const s = state.id ? findStock(state.id) : null;
    header(s ? 'Modifier l’article' : 'Nouvel article', { back: true });
    v.innerHTML = `
      <form id="f" class="card" novalidate>
        <label class="field"><span>Nom *</span><input name="name" required value="${esc(s?.name)}" placeholder="Coque iPhone 13, Chargeur 20W…"></label>
        <label class="field"><span>Catégorie</span><select name="cat">${Object.entries(CATS).map(([k, l]) => `<option value="${k}" ${s?.cat === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <div class="two">
          <label class="field"><span>Prix de vente (€)</span><input name="price" inputmode="decimal" value="${s ? String(s.price).replace('.', ',') : ''}" placeholder="0,00"></label>
          <label class="field"><span>Quantité</span><input name="qty" inputmode="numeric" value="${s ? s.qty : 1}"></label>
        </div>
        <label class="field"><span>Alerte stock bas à partir de</span><input name="min" inputmode="numeric" value="${s ? s.min : 1}"></label>
        <button class="btn btn-primary btn-block" type="submit">Enregistrer</button>
        ${s ? '<button class="btn btn-danger btn-block" type="button" id="delBtn" style="margin-top:10px">Supprimer l’article</button>' : ''}
      </form>`;
    const f = $('#f', v);
    f.addEventListener('submit', (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f));
      if (!d.name.trim()) { toast('Indiquez le nom'); return; }
      const item = { name: d.name.trim(), cat: d.cat, price: parseMoney(d.price), qty: Math.max(0, parseInt(d.qty, 10) || 0), min: Math.max(0, parseInt(d.min, 10) || 0) };
      if (s) Object.assign(s, item); else db.stock.push({ id: uid(), ...item });
      save(); toast('Article enregistré'); go({ view: 'list', id: null });
    });
    $('#delBtn', v)?.addEventListener('click', () => { if (confirm('Supprimer cet article du stock ?')) { db.stock = db.stock.filter((x) => x.id !== s.id); save(); go({ view: 'list', id: null }); } });
  }

  /* ================= CASH ================= */
  function startOf(period) {
    const d = new Date(); d.setHours(0, 0, 0, 0);
    if (period === 'week') d.setDate(d.getDate() - 6);
    if (period === 'month') d.setDate(1);
    if (period === 'all') return new Date(0);
    return d;
  }

  function cashView(v) {
    header('Caisse');
    const from = startOf(state.period);
    const entries = [];
    db.repairs.forEach((r) => r.payments.forEach((p) => { if (new Date(p.date) >= from) entries.push({ date: p.date, amount: p.amount, method: p.method, label: `${r.number} · ${r.client.name}`, kind: 'Réparation' }); }));
    db.sales.forEach((s) => { if (new Date(s.date) >= from) entries.push({ date: s.date, amount: saleTotal(s), method: s.method, label: `${s.number} · ${s.items.map((i) => i.name).join(', ')}`, kind: 'Vente' }); });
    entries.sort((a, b) => b.date.localeCompare(a.date));
    const sum = (f) => round(entries.filter(f).reduce((t, e) => t + e.amount, 0));
    const total = sum(() => true);
    const owed = round(db.repairs.reduce((t, r) => t + restOf(r), 0));
    const received = db.repairs.filter((r) => new Date(r.createdAt) >= from).length;
    const returned = db.repairs.filter((r) => r.history.some((h) => h.status === 'rendu' && new Date(h.date) >= from)).length;
    v.innerHTML = `
      <div class="chips">${[['today', 'Aujourd’hui'], ['week', '7 jours'], ['month', 'Ce mois'], ['all', 'Tout']].map(([k, l]) =>
        `<button class="chip ${state.period === k ? 'on' : ''}" data-p="${k}">${l}</button>`).join('')}</div>
      <div class="stats">
        <div class="stat big"><small>Total encaissé</small><b>${euro(total)}</b></div>
        <div class="stat"><small>Espèces</small><b>${euro(sum((e) => e.method === 'especes'))}</b></div>
        <div class="stat"><small>Carte</small><b>${euro(sum((e) => e.method === 'carte'))}</b></div>
        <div class="stat"><small>Réparations</small><b>${euro(sum((e) => e.kind === 'Réparation'))}</b></div>
        <div class="stat"><small>Ventes</small><b>${euro(sum((e) => e.kind === 'Vente'))}</b></div>
        <div class="stat"><small>Téléphones reçus</small><b>${received}</b></div>
        <div class="stat"><small>Téléphones rendus</small><b>${returned}</b></div>
        <div class="stat warn" style="grid-column:1/-1"><small>Reste à encaisser (toutes réparations)</small><b>${euro(owed)}</b></div>
      </div>
      <div class="h2">Détail</div>
      ${entries.length ? `<div class="card">${entries.map((e) => `<div class="pay"><span><b style="font-size:13px">${e.kind}</b> · ${esc(e.label)}<br><span class="muted small">${fmtDate(e.date)} · ${METHODS[e.method] || e.method}</span></span><b>${euro(e.amount)}</b></div>`).join('')}</div>`
        : '<div class="empty"><b>Aucun encaissement</b>sur cette période.</div>'}`;
    $$('[data-p]', v).forEach((c) => c.addEventListener('click', () => go({ period: c.dataset.p })));
  }

  /* ================= SETTINGS ================= */
  function settingsView(v) {
    header('Réglages');
    const s = db.settings;
    v.innerHTML = `
      <form id="f" novalidate>
        <div class="h2">Boutique (apparaît sur les tickets)</div>
        <div class="card">
          <label class="field"><span>Nom</span><input name="shopName" value="${esc(s.shopName)}"></label>
          <label class="field"><span>Adresse</span><input name="shopAddress" value="${esc(s.shopAddress)}"></label>
          <label class="field"><span>Téléphone</span><input name="shopPhone" type="tel" value="${esc(s.shopPhone)}"></label>
          <label class="field"><span>Texte en bas du ticket</span><textarea name="footer">${esc(s.footer)}</textarea></label>
        </div>
        <div class="h2">Messages WhatsApp / SMS</div>
        <div class="card">
          <p class="small muted" style="margin-top:0">Mots remplacés automatiquement : {nom} {modele} {ticket} {probleme} {prix} {paye} {reste} {boutique}</p>
          <label class="field"><span>Message « Ticket »</span><textarea name="msgTicket" rows="5">${esc(s.msgTicket)}</textarea></label>
          <label class="field"><span>Message « Téléphone prêt »</span><textarea name="msgReady" rows="4">${esc(s.msgReady)}</textarea></label>
        </div>
        <button class="btn btn-primary btn-block" type="submit">Enregistrer les réglages</button>
      </form>
      <div class="h2">Sauvegarde</div>
      <div class="card">
        <p class="small muted" style="margin-top:0">Les données restent uniquement sur ce téléphone. Faites une sauvegarde chaque semaine (WhatsApp à vous-même, Drive, e-mail…).</p>
        <div class="btns"><button class="btn btn-gold" id="exportBtn">Sauvegarder</button><label class="btn btn-light">Restaurer<input type="file" id="importFile" accept="application/json,.json" hidden></label></div>
      </div>
      <div class="h2">Démonstration</div>
      <div class="card">
        <div class="btns"><button class="btn btn-light" id="demoBtn">Charger des exemples</button><button class="btn btn-danger" id="wipeBtn">Tout effacer</button></div>
        <p class="small muted" style="margin:0">${db.repairs.length} réparations · ${db.sales.length} ventes · ${db.stock.length} articles</p>
      </div>
      <p class="small muted" style="text-align:center">Alakhil Mobile · Atelier v1</p>`;
    $('#f', v).addEventListener('submit', (e) => {
      e.preventDefault();
      Object.assign(db.settings, Object.fromEntries(new FormData(e.target)));
      save(); toast('Réglages enregistrés'); render();
    });
    $('#exportBtn', v).addEventListener('click', exportBackup);
    $('#importFile', v).addEventListener('change', (e) => importBackup(e.target.files[0]));
    $('#demoBtn', v).addEventListener('click', () => {
      if ((db.repairs.length || db.sales.length || db.stock.length) && !confirm('Ajouter des exemples à vos données actuelles ?')) return;
      loadDemo(); save(); toast('Exemples chargés'); go({ tab: 'repairs', view: 'list', filter: 'open' });
    });
    $('#wipeBtn', v).addEventListener('click', () => {
      if (!confirm('Effacer TOUTES les données de ce téléphone ?')) return;
      if (!confirm('Vraiment ? Pensez à sauvegarder avant.')) return;
      const keep = db.settings; db = blank(); db.settings = keep; save(); toast('Données effacées'); render();
    });
  }

  async function exportBackup() {
    const d = new Date();
    const name = `alakhil-sauvegarde-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`;
    const blob = new Blob([JSON.stringify(db, null, 1)], { type: 'application/json' });
    const file = typeof File === 'function' ? new File([blob], name, { type: 'application/json' }) : null;
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast('Sauvegarde téléchargée');
  }

  function importBackup(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const d = JSON.parse(reader.result);
        if (!Array.isArray(d.repairs) || !Array.isArray(d.sales) || !Array.isArray(d.stock)) throw new Error('format');
        if (!confirm(`Restaurer cette sauvegarde ?\n${d.repairs.length} réparations, ${d.sales.length} ventes, ${d.stock.length} articles.\nLes données actuelles seront remplacées.`)) return;
        const b = blank();
        db = { ...b, ...d, settings: { ...b.settings, ...(d.settings || {}) }, seq: { ...b.seq, ...(d.seq || {}) } };
        save(); toast('Sauvegarde restaurée'); go({ tab: 'repairs', view: 'list' });
      } catch (e) { toast('Fichier de sauvegarde invalide'); }
    };
    reader.readAsText(file);
  }

  function loadDemo() {
    const ago = (days, h = 10, m = 0) => { const d = new Date(); d.setDate(d.getDate() - days); d.setHours(h, m, 0, 0); return d.toISOString(); };
    const stock = [
      ['Coque iPhone 13', 'accessoire', 12, 8, 3], ['Verre trempé iPhone', 'accessoire', 10, 15, 5], ['Chargeur USB-C 20W', 'accessoire', 15, 6, 3],
      ['Câble Lightning 1 m', 'accessoire', 8, 2, 4], ['Écouteurs Bluetooth', 'accessoire', 25, 4, 2],
      ['Écran iPhone 11', 'piece', 69, 2, 2], ['Batterie iPhone 12', 'piece', 45, 3, 2], ['Écran Samsung A52', 'piece', 89, 1, 1],
      ['iPhone 12 reconditionné 64 Go', 'telephone', 299, 2, 1], ['Samsung Galaxy A14', 'telephone', 169, 3, 1]
    ].map(([name, cat, price, qty, min]) => ({ id: uid(), name, cat, price, qty, min }));
    db.stock.push(...stock);
    const reps = [
      ['Ahmad K.', '06 11 22 33 44', 'iPhone 11', 'Changement écran', 89, [[40, 'especes', 2]], 'reparation', 2],
      ['Sarah M.', '07 55 66 77 88', 'Samsung Galaxy A52', 'Changement écran', 119, [[119, 'carte', 1]], 'pret', 1],
      ['Jean D.', '06 98 76 54 32', 'iPhone 12', 'Changement batterie', 59, [[20, 'especes', 0]], 'recu', 0],
      ['Fatima B.', '06 45 67 89 01', 'iPhone 13', 'Vitre arrière', 79, [[30, 'especes', 3], [49, 'especes', 0]], 'rendu', 3],
      ['Karim B.', '07 12 34 56 78', 'Xiaomi Redmi Note 12', 'Connecteur de charge', 49, [], 'pret', 1]
    ];
    reps.forEach(([name, phone, model, problem, price, pays, status, days]) => {
      db.seq.repair += 1;
      const created = ago(days, 11, 10 * db.seq.repair);
      const r = {
        id: uid(), n: db.seq.repair, number: 'R-' + String(db.seq.repair).padStart(4, '0'), createdAt: created,
        client: { name, phone }, device: { model, imei: '', code: '' }, problem, notes: '', price,
        payments: pays.map(([amount, method, d]) => ({ id: uid(), date: ago(d, d === days ? 11 : 16, 20), amount, method })),
        status, history: [{ status: 'recu', date: created }]
      };
      if (status !== 'recu') r.history.push({ status, date: ago(Math.max(0, days - 1), 15) });
      db.repairs.push(r);
    });
    const sale = (items, method, days, h) => {
      db.seq.sale += 1;
      db.sales.push({ id: uid(), n: db.seq.sale, number: 'V-' + String(db.seq.sale).padStart(4, '0'), date: ago(days, h, 30), items, method, imei: '', client: { name: '', phone: '' } });
    };
    sale([{ stockId: stock[0].id, name: stock[0].name, qty: 1, price: 12 }, { stockId: stock[1].id, name: stock[1].name, qty: 1, price: 10 }], 'especes', 0, 12);
    sale([{ stockId: stock[2].id, name: stock[2].name, qty: 1, price: 15 }], 'carte', 0, 15);
    sale([{ stockId: stock[9].id, name: stock[9].name, qty: 1, price: 169 }], 'carte', 2, 17);
  }

  /* ---------------- Start ---------------- */
  if (!db.repairs.length && !db.sales.length && !db.stock.length) { loadDemo(); save(); }
  render();
})();
