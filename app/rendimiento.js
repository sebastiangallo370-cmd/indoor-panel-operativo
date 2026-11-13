/* MODO FLUIDO: que el panel se vea igual de bien en equipos potentes y siga fluido en equipos modestos o celulares.
   No toca datos ni pantallas: solo apaga el desenfoque de vidrio (backdrop-filter) y las animaciones infinitas de las tarjetas líquidas
   cuando el equipo no da abasto. Se decide solo:
   - equipo flojo (4 núcleos o menos, 4 GB o menos de memoria, o ahorro de datos) → modo fluido desde el inicio;
   - cualquier equipo que, ya cargada la página, mida menos de 45 cuadros por segundo → modo fluido (se recuerda en este navegador);
   - con la pestaña oculta se pausan todas las animaciones (no gastan batería ni CPU).
   Manual (consola del navegador): localStorage.setItem('indoor-fluido','on') fuerza el modo fluido, 'off' lo apaga, 'auto' (o borrar) lo deja automático.
   El modo fluido deja de verse con la clase html.perf-lite; la pausa por pestaña oculta usa html.perf-oculta. */
(function () {
  if (window.__indoorFluido) return;
  window.__indoorFluido = true;
  var R = document.documentElement;
  var pref = 'auto', recordado = false;
  try { pref = localStorage.getItem('indoor-fluido') || 'auto'; recordado = localStorage.getItem('indoor-fluido-auto') === 'lite'; } catch (e) { /* sin almacenamiento: queda automático */ }

  var st = document.createElement('style');
  st.id = 'indoor-fluido-css';
  st.textContent =
    'html.perf-lite *,html.perf-lite *::before,html.perf-lite *::after{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}' +
    'html.perf-lite .lq::before,html.perf-lite .lq>.lq-wave,html.perf-lite .lq>.lq-wave *{animation:none!important}' +
    'html.perf-lite .lq::before{filter:none!important}' +
    'html.perf-oculta *,html.perf-oculta *::before,html.perf-oculta *::after{animation-play-state:paused!important}';
  (document.head || R).appendChild(st);

  function lite(on) { R.classList.toggle('perf-lite', !!on); }

  function equipoFlojo() {
    var n = navigator, c = n.connection || {};
    return (n.hardwareConcurrency && n.hardwareConcurrency <= 4) || (n.deviceMemory && n.deviceMemory <= 4) || c.saveData === true;
  }

  if (pref === 'on') lite(true);
  else if (pref === 'auto' && (recordado || equipoFlojo())) lite(true);

  document.addEventListener('visibilitychange', function () { R.classList.toggle('perf-oculta', document.hidden); });
  if (document.hidden) R.classList.add('perf-oculta');

  // medición real: cuadros por segundo con la página ya dibujada (se descarta si la pestaña se oculta durante la prueba)
  function medir() {
    if (pref !== 'auto' || R.classList.contains('perf-lite') || document.hidden) return;
    var n = 0, t0 = 0, ocultada = false;
    var alOcultar = function () { ocultada = true; };
    document.addEventListener('visibilitychange', alOcultar, { once: true });
    var paso = function (t) {
      if (ocultada) return;
      if (!t0) t0 = t;
      n++;
      if (t - t0 < 2500) { requestAnimationFrame(paso); return; }
      document.removeEventListener('visibilitychange', alOcultar);
      var fps = n * 1000 / (t - t0);
      window.indoorFluidoFps = Math.round(fps);
      if (fps < 45) {
        lite(true);
        try { localStorage.setItem('indoor-fluido-auto', 'lite'); } catch (e) { /* sin almacenamiento */ }
      }
    };
    requestAnimationFrame(paso);
  }
  var iniciar = function () { setTimeout(medir, 2500); };
  if (document.readyState === 'complete') iniciar(); else window.addEventListener('load', iniciar, { once: true });

  window.indoorFluido = {
    activar: function () { try { localStorage.setItem('indoor-fluido', 'on'); } catch (e) { /* nada */ } lite(true); },
    apagar: function () { try { localStorage.setItem('indoor-fluido', 'off'); localStorage.removeItem('indoor-fluido-auto'); } catch (e) { /* nada */ } lite(false); },
    automatico: function () { try { localStorage.removeItem('indoor-fluido'); localStorage.removeItem('indoor-fluido-auto'); } catch (e) { /* nada */ } }
  };
})();
