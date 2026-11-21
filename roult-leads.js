/* roult-leads.js — medición y formulario de contacto de roult.us
 *
 * Qué hace:
 *  1. Guarda de dónde vino la visita (utm_*, gclid, fbclid, ttclid…), la primera
 *     y la última, para saber qué anuncio trajo a cada contacto.
 *  2. Toma el formulario #form: en vez de abrir la app de correo, envía los datos
 *     a la hoja de contactos (Google Apps Script) y muestra un mensaje de gracias.
 *     Si el envío falla, vuelve a lo de antes (abre el correo) para no perder a nadie.
 *  3. Avisa a Google Tag Manager (dataLayer) de cada acción que importa:
 *     generate_lead, whatsapp_click, email_click, phone_click, form_open.
 *     Los píxeles (Google Ads, Meta, TikTok) se configuran en GTM, no aquí.
 *  4. Si alguien llega a /#contacto (botones de las páginas de servicio), abre el formulario.
 *
 * Se carga así, al final del <body>:
 *   <script src="/roult-leads.js" data-endpoint="URL_DEL_APPS_SCRIPT" defer></script>
 * Sin data-endpoint funciona igual que antes (abre el correo) pero ya mide.
 */
(function () {
  'use strict';
  var me = document.currentScript;
  var ENDPOINT = (me && me.getAttribute('data-endpoint')) || '';
  var MAIL = 'contact@roult.us';
  var LANG = /^\/en(\/|$)/.test(location.pathname) ? 'en' : 'es';
  var T0 = Date.now();

  window.dataLayer = window.dataLayer || [];
  function push(o) { try { o.page_lang = LANG; window.dataLayer.push(o); } catch (e) {} }

  // ---------------------------------------------------------------- 1. origen
  var KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
              'gclid', 'gbraid', 'wbraid', 'fbclid', 'ttclid', 'msclkid'];
  function get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  var q = new URLSearchParams(location.search), now = {}, has = false;
  KEYS.forEach(function (k) { var v = q.get(k); if (v) { now[k] = v.slice(0, 200); has = true; } });
  var touch = { landing: location.pathname, referrer: (document.referrer || '').slice(0, 300), ts: new Date().toISOString() };
  for (var k in now) touch[k] = now[k];
  if (!get('roult_first')) set('roult_first', touch);
  if (has) set('roult_last', touch);

  function cookie(name) {
    var m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  }
  function uid() {
    try { return crypto.randomUUID(); } catch (e) {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
      });
    }
  }

  // ---------------------------------------------------------------- 2. formulario
  var TXT = {
    es: { ok: '¡Listo, gracias!', okp: 'Recibimos su solicitud. Le escribiremos a ', sending: 'Enviando…' },
    en: { ok: 'Done, thank you!', okp: 'We got your request. We will email you at ', sending: 'Sending…' }
  }[LANG];

  function addHoneypot(f) {
    if (f.querySelector('input[name="website"]')) return;
    var hp = document.createElement('input');
    hp.type = 'text'; hp.name = 'website'; hp.tabIndex = -1; hp.autocomplete = 'off';
    hp.setAttribute('aria-hidden', 'true');
    hp.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;opacity:0';
    f.appendChild(hp);
  }

  function mailtoFallback(d) {
    var body = 'Nombre: ' + d.name + '\nCorreo: ' + d.email + '\nLe interesa: ' + (d.services || 'Sin indicar') +
               '\n\nMensaje:\n' + d.message + '\n';
    location.href = 'mailto:' + MAIL + '?subject=' + encodeURIComponent('Nuevo contacto desde roult.us: ' + d.name) +
                    '&body=' + encodeURIComponent(body);
  }

  function thanks(f, email) {
    var box = document.createElement('div');
    box.className = 'roult-ok';
    box.setAttribute('role', 'status');
    box.style.cssText = 'padding:28px 4px;text-align:center';
    var h = document.createElement('h3'); h.textContent = TXT.ok;
    var p = document.createElement('p'); p.textContent = TXT.okp + email + '.';
    p.style.marginTop = '8px';
    box.appendChild(h); box.appendChild(p);
    f.style.display = 'none';
    f.parentNode.insertBefore(box, f.nextSibling);
  }

  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (!f || f.id !== 'form') return;
    // fase de captura: el manejador viejo (mailto) ya no se ejecuta
    e.preventDefault();
    e.stopImmediatePropagation();

    var val = function (n) { var el = f.elements[n]; return el ? String(el.value || '').trim() : ''; };
    var services = [].slice.call(f.querySelectorAll('.chips input:checked')).map(function (i) { return i.value; }).join(', ');
    var d = {
      name: val('Nombre').slice(0, 120),
      email: val('Correo').slice(0, 160),
      message: val('Mensaje').slice(0, 3000),
      services: services,
      website: val('website'),
      lang: LANG,
      page: location.pathname,
      first: get('roult_first'),
      last: get('roult_last'),
      cookies: { fbp: cookie('_fbp'), fbc: cookie('_fbc'), ttp: cookie('_ttp'), ga: cookie('_ga') },
      seconds: Math.round((Date.now() - T0) / 1000),
      event_id: uid()
    };
    if (d.website) { thanks(f, d.email); return; }  // bot: no se envía nada

    var btn = f.querySelector('[type="submit"]');
    if (btn) { btn.disabled = true; btn.dataset.txt = btn.innerHTML; btn.textContent = TXT.sending; }

    var done = function () {
      push({ event: 'generate_lead', event_id: d.event_id, lead_services: services || 'none',
             form_location: 'popup', user_data: { email: d.email } });
      thanks(f, d.email);
    };
    var fail = function () {
      if (btn) { btn.disabled = false; btn.innerHTML = btn.dataset.txt || ''; }
      push({ event: 'lead_fallback_mailto', event_id: d.event_id });
      mailtoFallback(d);
    };

    if (!ENDPOINT || !window.fetch) { fail(); return; }
    // text/plain evita la consulta previa (CORS) que Apps Script no responde
    fetch(ENDPOINT, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                      body: JSON.stringify(d), keepalive: true })
      .then(done, fail);
  }, true);

  // ---------------------------------------------------------------- 3. clics que importan
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a,button') : null;
    if (!a) return;
    var h = a.getAttribute('href') || '';
    if (/(^|\/\/)(wa\.me|api\.whatsapp\.com|web\.whatsapp\.com)\//.test(h)) push({ event: 'whatsapp_click', link_url: h });
    else if (h.indexOf('mailto:') === 0) push({ event: 'email_click' });
    else if (h.indexOf('tel:') === 0) push({ event: 'phone_click' });
    else if (a.hasAttribute('data-pop')) push({ event: 'form_open' });
  }, true);

  // ---------------------------------------------------------------- 4. /#contacto abre el formulario
  function openFromHash() {
    if (!/^#(contacto|contact)$/.test(location.hash)) return;
    var b = document.querySelector('[data-pop]');
    if (b) setTimeout(function () { b.click(); }, 400);
  }

  function init() {
    var f = document.getElementById('form');
    if (f) addHoneypot(f);
    openFromHash();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.addEventListener('hashchange', openFromHash);
})();
