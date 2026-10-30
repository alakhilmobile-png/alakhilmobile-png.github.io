/* Online booking widget (demo). Reused by the barbershop and beauty salon demos.
 *
 * Usage: <div id="booking"></div> then
 *   Booking.mount('#booking', {
 *     shop: 'Name', whatsapp: '33123456789',
 *     services: [{ id, name, cat, minutes, price }],
 *     staff: [{ id, name, role }],            // optional
 *     hours: { 1: ['09:00', '19:00'], ... },  // 0 = Sunday … 6 = Saturday, missing = closed
 *     step: 30                                // slot length in minutes
 *   });
 * Styling comes from the host page through CSS variables (--bk-*).
 */
(function () {
  'use strict';

  const DAYS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
  const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const euro = (n) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = (n) => String(n).padStart(2, '0');
  const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const hm = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
  const dur = (m) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ' ' + pad(m % 60) : ''}` : `${m} min`);

  // Deterministic "already booked" slots so the demo looks real but stays stable
  function busy(dayKey, staffId, min) {
    let h = 2166136261;
    for (const c of dayKey + '|' + staffId + '|' + min) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
    return (h >>> 0) % 100 < 34;
  }

  function mount(sel, cfg) {
    const root = document.querySelector(sel);
    if (!root) return;
    const st = { service: null, staff: null, day: null, time: null, done: false };
    const step = cfg.step || 30;

    const days = [];
    const now = new Date();
    for (let i = 0; days.length < 14 && i < 30; i++) {
      const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + i);
      if (cfg.hours[d.getDay()]) days.push(d);
    }
    const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    function slots() {
      if (!st.day || !st.service) return [];
      const [o, c] = cfg.hours[st.day.getDay()].map(toMin);
      const list = [];
      const isToday = dayKey(st.day) === dayKey(now);
      const nowMin = now.getHours() * 60 + now.getMinutes() + 30;
      for (let m = o; m + st.service.minutes <= c; m += step) {
        if (isToday && m < nowMin) continue;
        const staffIds = st.staff ? [st.staff.id] : (cfg.staff || [{ id: 'all' }]).map((s) => s.id);
        const free = staffIds.some((id) => !busy(dayKey(st.day), id, m));
        list.push({ m, free });
      }
      return list;
    }

    function render() {
      if (st.done) return renderDone();
      const cats = [...new Set(cfg.services.map((s) => s.cat))];
      const sl = slots();
      root.innerHTML = `
        <div class="bk">
          <div class="bk-step ${st.service ? 'ok' : 'on'}">
            <div class="bk-h"><span class="bk-n">1</span><b>Prestation</b>${st.service ? `<em>${esc(st.service.name)} · ${euro(st.service.price)}</em><button class="bk-edit" data-reset="service">Modifier</button>` : ''}</div>
            ${st.service ? '' : cats.map((c) => `
              ${cats.length > 1 ? `<div class="bk-cat">${esc(c)}</div>` : ''}
              <div class="bk-list">${cfg.services.filter((s) => s.cat === c).map((s) => `
                <button class="bk-svc" data-svc="${s.id}"><span><b>${esc(s.name)}</b><small>${dur(s.minutes)}</small></span><strong>${euro(s.price)}</strong></button>`).join('')}
              </div>`).join('')}
          </div>

          ${cfg.staff ? `<div class="bk-step ${!st.service ? 'off' : st.staff !== null ? 'ok' : 'on'}">
            <div class="bk-h"><span class="bk-n">2</span><b>Avec qui ?</b>${st.staff !== null && st.service ? `<em>${st.staff ? esc(st.staff.name) : 'Peu importe'}</em><button class="bk-edit" data-reset="staff">Modifier</button>` : ''}</div>
            ${st.service && st.staff === null ? `<div class="bk-staff">
              <button data-staff="any"><span class="bk-av">★</span><b>Peu importe</b><small>Premier disponible</small></button>
              ${cfg.staff.map((p) => `<button data-staff="${p.id}"><span class="bk-av">${esc(p.name[0])}</span><b>${esc(p.name)}</b><small>${esc(p.role)}</small></button>`).join('')}
            </div>` : ''}
          </div>` : ''}

          <div class="bk-step ${!st.service || (cfg.staff && st.staff === null) ? 'off' : st.time ? 'ok' : 'on'}">
            <div class="bk-h"><span class="bk-n">${cfg.staff ? 3 : 2}</span><b>Date &amp; heure</b>${st.time ? `<em>${DAYS[st.day.getDay()]} ${st.day.getDate()} ${MONTHS[st.day.getMonth()]} · ${hm(st.time)}</em><button class="bk-edit" data-reset="time">Modifier</button>` : ''}</div>
            ${st.service && (!cfg.staff || st.staff !== null) && !st.time ? `
              <div class="bk-days">${days.map((d) => `<button data-day="${dayKey(d)}" class="${st.day && dayKey(d) === dayKey(st.day) ? 'sel' : ''}"><small>${DAYS[d.getDay()]}</small><b>${d.getDate()}</b><small>${MONTHS[d.getMonth()]}</small></button>`).join('')}</div>
              ${st.day ? (sl.some((s) => s.free)
                ? `<div class="bk-times">${sl.map((s) => `<button data-time="${s.m}" ${s.free ? '' : 'disabled'}>${hm(s.m)}</button>`).join('')}</div>`
                : '<p class="bk-note">Complet ce jour-là, choisissez une autre date.</p>') : '<p class="bk-note">Choisissez un jour.</p>'}` : ''}
          </div>

          <div class="bk-step ${st.time ? 'on' : 'off'}">
            <div class="bk-h"><span class="bk-n">${cfg.staff ? 4 : 3}</span><b>Vos coordonnées</b></div>
            ${st.time ? `<form class="bk-form" novalidate>
              <label><span>Prénom et nom</span><input name="name" required autocomplete="name"></label>
              <label><span>Téléphone</span><input name="phone" type="tel" required autocomplete="tel" inputmode="tel"></label>
              <button class="bk-go" type="submit">Confirmer le rendez-vous</button>
              <p class="bk-err" hidden></p>
            </form>` : ''}
          </div>
        </div>`;
      bind();
    }

    function renderDone() {
      const s = st.service, d = st.day;
      const when = `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} à ${hm(st.time)}`;
      const msg = `Bonjour ${cfg.shop}, je souhaite confirmer mon rendez-vous :\n${s.name} (${euro(s.price)})\n${when}${st.staff ? '\nAvec ' + st.staff.name : ''}\nNom : ${st.name}\nTél : ${st.phone}`;
      root.innerHTML = `
        <div class="bk bk-done">
          <div class="bk-check">✓</div>
          <h3>Rendez-vous réservé !</h3>
          <p>${esc(s.name)} · ${euro(s.price)}<br><b>${when}</b>${st.staff ? `<br>avec ${esc(st.staff.name)}` : ''}</p>
          <div class="bk-actions">
            <a class="bk-go" href="https://wa.me/${cfg.whatsapp}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">Recevoir la confirmation WhatsApp</a>
            <button class="bk-ghost" data-ics>Ajouter à mon agenda</button>
            <button class="bk-ghost" data-again>Nouveau rendez-vous</button>
          </div>
          <p class="bk-demo">Site de démonstration : aucun rendez-vous réel n’est enregistré.</p>
        </div>`;
      root.querySelector('[data-again]').onclick = () => { Object.assign(st, { service: null, staff: null, day: null, time: null, done: false }); render(); };
      root.querySelector('[data-ics]').onclick = () => {
        const start = new Date(d); start.setHours(0, st.time, 0, 0);
        const end = new Date(start.getTime() + s.minutes * 60000);
        const f = (x) => `${x.getFullYear()}${pad(x.getMonth() + 1)}${pad(x.getDate())}T${pad(x.getHours())}${pad(x.getMinutes())}00`;
        const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Demo//FR', 'BEGIN:VEVENT', `UID:${Date.now()}@demo`, `DTSTART:${f(start)}`, `DTEND:${f(end)}`,
          `SUMMARY:${s.name} – ${cfg.shop}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' })); a.download = 'rendez-vous.ics'; a.click();
      };
      root.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function bind() {
      root.querySelectorAll('[data-svc]').forEach((b) => b.onclick = () => { st.service = cfg.services.find((s) => s.id === b.dataset.svc); if (!cfg.staff) st.staff = false; render(); });
      root.querySelectorAll('[data-staff]').forEach((b) => b.onclick = () => { st.staff = b.dataset.staff === 'any' ? false : cfg.staff.find((p) => p.id === b.dataset.staff); render(); });
      root.querySelectorAll('[data-day]').forEach((b) => b.onclick = () => { st.day = days.find((d) => dayKey(d) === b.dataset.day); render(); });
      root.querySelectorAll('[data-time]').forEach((b) => b.onclick = () => { st.time = Number(b.dataset.time); render(); root.querySelector('.bk-form input')?.focus(); });
      root.querySelectorAll('[data-reset]').forEach((b) => b.onclick = () => {
        const k = b.dataset.reset;
        if (k === 'service') Object.assign(st, { service: null, staff: cfg.staff ? null : st.staff, time: null });
        if (k === 'staff') Object.assign(st, { staff: null, time: null });
        if (k === 'time') st.time = null;
        render();
      });
      const form = root.querySelector('.bk-form');
      if (form) form.onsubmit = (e) => {
        e.preventDefault();
        const name = form.name.value.trim(), phone = form.phone.value.trim();
        const err = form.querySelector('.bk-err');
        if (name.length < 2) { err.textContent = 'Indiquez votre nom.'; err.hidden = false; return; }
        if (!/^[0-9 +().-]{8,20}$/.test(phone)) { err.textContent = 'Indiquez un numéro de téléphone valide.'; err.hidden = false; return; }
        Object.assign(st, { name, phone, done: true });
        render();
      };
      const sel = root.querySelector('.bk-days .sel');
      if (sel) sel.scrollIntoView({ block: 'nearest', inline: 'center' });
    }

    render();
  }

  window.Booking = { mount };
})();
