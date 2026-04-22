export default async function handler(req, res) {
  const { EVOLUTION_URL, EVOLUTION_TOKEN, INSTANCE_NAME, GROK_API_KEY } = process.env;

  // 1. Evitar errores de mensajes vacíos o propios
  if (!req.body?.data?.message) return res.status(200).send('OK');
  const data = req.body.data;
  if (data.key?.fromMe) return res.status(200).send('OK');

  const clienteMsg = data.message?.conversation || data.message?.extendedTextMessage?.text || "";
  const remoteJid = data.key?.remoteJid;

  // 2. BIBLIOTECA TÉCNICA (Aquí está toda tu info para que no falle buscando archivos)
  const infoVenta = `
    PRODUCTO: Combo Regeneración (Aceite de Orégano + Multicolágeno).
    PRECIOS: Combo $37.99 / Solo Colágeno $25 / Solo Orégano $18.50.
    BENEFICIOS: El orégano limpia bacterias (Helicobacter) y hongos (Candida) para que el colágeno sí se absorba y regenere piel, articulaciones y energía.
    PAGO: Contra entrega. ENVÍO: Gratis a todo Ecuador.
  `;

  try {
    // 3. MASTER PROMPT (Neuroventas, Personalidad y Modelo AIDA)
    const masterPrompt = `Eres Fiorella de JRJMarket. ¡Habla como una humana real, no como un bot! 
    Usa frases ecuatorianas como "Chuta", "Qué chévere", "Te cuento algo". 
    
    REGLAS CRÍTICAS:
    - Si el cliente te da un dato (como su ciudad), NO te vuelvas a presentar. ¡Continúa la charla!
    - Si te dice "Quito", dile algo como "¡Qué chévere Quito! Justo hoy enviamos varios para allá".
    - Si no te contestan, usa la urgencia: "Oye, ¿sigues ahí? No quisiera que te quedes fuera de la promo, me quedan poquitos combos".
    - MODELO AIDA: Valida el dolor (gastritis, falta de energía, arrugas), explica el beneficio técnico y CIERRA preguntando datos de envío.
    - Siempre termina con una PREGUNTA de ventas.
    
    INFORMACIÓN DEL PRODUCTO:
    ${infoVenta}`;

    // 4. Llamada a la IA (Grok)
    const respIA = await fetch('https://api.xai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${GROK_API_KEY}`, 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({
        model: "grok-beta",
        messages: [
          { role: "system", content: masterPrompt },
          { role: "user", content: clienteMsg }
        ]
      })
    });

    const resJson = await respIA.json();
    const textoIA = resJson.choices?.[0]?.message?.content;

    // 5. Envío a Evolution API
    if (textoIA) {
      const baseUrl = EVOLUTION_URL.replace(/\/$/, "");
      await fetch(`${baseUrl}/message/sendText/${INSTANCE_NAME.trim()}`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json', 
          'apikey': EVOLUTION_TOKEN 
        },
        body: JSON.stringify({
          number: remoteJid,
          text: textoIA,
          delay: 1000
        })
      });
    }

    return res.status(200).send('OK');
  } catch (error) {
    // Si algo falla, el bot no se muere, solo envía el OK a la API
    return res.status(200).send('OK');
  }
}
