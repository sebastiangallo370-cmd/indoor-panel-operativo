// Panel ligero: en computadores con poca memoria o pocos procesadores quita animaciones, transiciones
// y desenfoques (lo que más carga el navegador). Se activa solo; en otros equipos no cambia nada.
// Para forzarlo o quitarlo: localStorage.setItem('panelLigero', '1') o '0' y recargar.
(() => {
  // En Producción se quitan los desenfoques y animaciones de las tarjetas (son lo que más tilda al desplazarse); el resto del panel no cambia.
  const st0 = document.createElement('style');
  st0.id = 'produccion-fluida-css';
  st0.textContent = 'body.production-mode .trace-card,body.production-mode .trace-card *,body.production-mode .trace-workspace,body.production-mode .trace-workspace *{backdrop-filter:none!important;-webkit-backdrop-filter:none!important;animation:none!important;transition:none!important}';
  document.head.appendChild(st0);
  let forzado = null;
  try { forzado = localStorage.getItem('panelLigero'); } catch (e) { /* sin almacenamiento */ }
  const lento = (navigator.deviceMemory && navigator.deviceMemory <= 4) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);
  const ligero = forzado === '1' || (forzado !== '0' && lento);
  if (!ligero) return;
  document.documentElement.classList.add('panel-ligero');
  const st = document.createElement('style');
  st.id = 'panel-ligero-css';
  st.textContent = '.panel-ligero *,.panel-ligero *::before,.panel-ligero *::after{animation:none!important;transition:none!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important}';
  document.head.appendChild(st);
})();
