/* Envío compacto desde el icono de Confección, sin cambiar de vista. */
(()=>{
  const normalizar=value=>String(value||'').trim().toUpperCase();
  const aviso=message=>window.alert(message);
  window.addEventListener('indoor:preparar-confeccion',async event=>{
    const row=Number(event.detail?.row);
    if(!row)return;
    try{
      const consulta=await fetch(`/api/produccion/fila/${encodeURIComponent(row)}/confeccion`,{cache:'no-store',credentials:'same-origin'});
      const datos=await consulta.json();
      if(!consulta.ok)throw Error(datos.detail||'No se pudo consultar la preparación');
      const previo=datos.preparacion||{},nombres=datos.confeccionistas||[];
      const confeccionista=normalizar(prompt(`Confeccionista:\n${nombres.join('\n')}`,previo.confeccionista||nombres[0]||''));
      if(!confeccionista)return;
      if(!nombres.includes(confeccionista))throw Error('Selecciona una confeccionista de la lista');
      const whatsapp=prompt(`WhatsApp de ${confeccionista}:`,(datos.whatsapps||{})[confeccionista]||'');
      if(whatsapp===null)return;
      const precio=prompt('Precio por prenda:',previo.precio_prenda||'');
      if(precio===null)return;
      const guardado=await fetch(`/api/produccion/fila/${encodeURIComponent(row)}/confeccion`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({confeccionista,whatsapp,precio_prenda:precio})});
      const resultado=await guardado.json();
      if(!guardado.ok)throw Error(resultado.detail||'No se pudo enviar a Confección');
      aviso('Preparación enviada al PC de Confección. WhatsApp se abrirá en el PC de la operaria.');
    }catch(error){aviso(error.message||'No se pudo enviar a Confección')}
  });
})();
