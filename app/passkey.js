/* Activar Face ID / huella en este dispositivo (llave de acceso). Se carga en el panel. */
(() => {
  const b64e = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const b64d = text => { let t = text.replace(/-/g, '+').replace(/_/g, '/'); while (t.length % 4) t += '='; return Uint8Array.from(atob(t), c => c.charCodeAt(0)); };
  const post = async (url, body) => {
    const r = await fetch(url, {method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body || {})});
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.detail || 'No se pudo completar');
    return d;
  };
  const store = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const read = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const nombre = () => { const ua = navigator.userAgent; return /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Dispositivo'; };

  async function activar() {
    const opts = await post('/api/passkey/registro/opciones');
    const pk = opts.publicKey;
    pk.challenge = b64d(pk.challenge); pk.user.id = b64d(pk.user.id);
    pk.excludeCredentials = (pk.excludeCredentials || []).map(c => ({...c, id: b64d(c.id)}));
    const cred = await navigator.credentials.create({publicKey: pk});
    await post('/api/passkey/registro/verificar', {token: opts.token, id: cred.id, clientDataJSON: b64e(cred.response.clientDataJSON), attestationObject: b64e(cred.response.attestationObject), label: nombre()});
    store('indoor-passkey', '1');
  }

  function toast(text, ok) {
    const t = document.createElement('div');
    t.setAttribute('role', 'status');
    t.style.cssText = 'position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:99999;max-width:calc(100vw - 28px);padding:12px 16px;border-radius:12px;font:700 14px Arial;' + (ok ? 'background:#1d3a16;color:#dff7d3;border:1px solid #5fa84a' : 'background:#3a1a16;color:#ffd9d4;border:1px solid #b5524a');
    t.textContent = text; document.body.appendChild(t); setTimeout(() => t.remove(), 5000);
  }

  async function intentar(boton) {
    if (boton) boton.disabled = true;
    try { await activar(); toast('✓ Face ID activado en este dispositivo', true); const p = document.querySelector('[data-passkey-prompt]'); if (p) p.remove(); }
    catch (e) { toast(e.name === 'NotAllowedError' ? 'Se canceló la activación' : e.name === 'InvalidStateError' ? 'Este dispositivo ya estaba activado' : e.message, false); }
    if (boton) boton.disabled = false;
  }

  async function init() {
    if (!window.PublicKeyCredential || !(await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable().catch(() => false))) return;
    const nav = document.querySelector('.sidebar nav.tabs');
    if (nav && !nav.querySelector('[data-passkey-link]')) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'tab'; b.dataset.passkeyLink = '1';
      b.innerHTML = '<span class="nav-icon">ID</span><strong>ACTIVAR FACE ID</strong>';
      b.onclick = () => intentar(b); nav.appendChild(b);
    }
    if (read('indoor-passkey') || read('indoor-passkey-no') || !matchMedia('(pointer:coarse)').matches) return;
    const card = document.createElement('div'); card.dataset.passkeyPrompt = '1';
    card.style.cssText = 'position:fixed;left:12px;right:12px;bottom:14px;z-index:99998;max-width:420px;margin:auto;padding:16px;border-radius:16px;background:#141a13;color:#eef5e8;border:1px solid #5a7a3a;box-shadow:0 10px 30px #0008;font:15px/1.4 Arial';
    card.innerHTML = '<strong style="display:block;font-size:16px;margin-bottom:6px">¿Entrar con Face ID?</strong><span style="color:#b8c6ad">La próxima vez iniciarás sesión con tu rostro o huella, sin escribir la contraseña.</span><div style="display:flex;gap:10px;margin-top:12px"><button data-si type="button" style="flex:1;min-height:44px;border:0;border-radius:10px;background:#d0f44c;color:#17210c;font:800 14px Arial">Activar</button><button data-no type="button" style="flex:1;min-height:44px;border:1px solid #4a5a40;border-radius:10px;background:transparent;color:#eef5e8;font:700 14px Arial">Ahora no</button></div>';
    card.querySelector('[data-si]').onclick = e => intentar(e.target);
    card.querySelector('[data-no]').onclick = () => { store('indoor-passkey-no', '1'); card.remove(); };
    setTimeout(() => document.body.appendChild(card), 2500);
  }
  init();
})();
