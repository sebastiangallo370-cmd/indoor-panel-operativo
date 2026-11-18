// Alerta de pedidos nuevos: cuando un comercial recibe una reposición pendiente, aparece una notificación de Windows
// (notificación del navegador). Funciona mientras la app esté abierta en esa pestaña. Revisa cada minuto.
(() => {
  'use strict';
  if (!('Notification' in window)) return;
  const CLAVE = 'alertaPedidosVistos';
  const CADA = 60000;

  const vistos = () => {
    try { return new Set(JSON.parse(localStorage.getItem(CLAVE) || '[]')); } catch (e) { return new Set(); }
  };
  const guardar = (conjunto) => {
    try { localStorage.setItem(CLAVE, JSON.stringify([...conjunto].slice(-500))); } catch (e) { /* sin almacenamiento */ }
  };

  async function revisar(primeraVez) {
    try {
      const r = await fetch('/api/club/pedidos?estado=pendiente', { credentials: 'same-origin' });
      if (!r.ok) return;
      const pedidos = (await r.json()).pedidos || [];
      const ya = vistos();
      const nuevos = pedidos.filter((p) => !ya.has(String(p.id)));
      pedidos.forEach((p) => ya.add(String(p.id)));
      guardar(ya);
      // la primera vez solo se recuerdan los que ya estaban (para no avisar de los viejos)
      if (primeraVez || Notification.permission !== 'granted') return;
      nuevos.forEach((p) => new Notification('Nuevo pedido de comercial', {
        body: `${p.cliente || 'Cliente'} · ${p.prendas || 0} prendas · reposición #${p.id}`,
        tag: 'pedido-' + p.id,
      }));
    } catch (e) { /* sin conexión: se vuelve a intentar en el siguiente ciclo */ }
  }

  // Chrome pide permiso solo con un clic del usuario
  const pedirPermiso = () => {
    if (Notification.permission === 'default') Notification.requestPermission();
    document.removeEventListener('click', pedirPermiso);
  };
  if (Notification.permission === 'default') document.addEventListener('click', pedirPermiso);

  revisar(true);
  setInterval(() => revisar(false), CADA);
})();
