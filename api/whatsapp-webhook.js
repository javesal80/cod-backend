export default async function handler(req, res) {
  const { EVOLUTION_URL, EVOLUTION_TOKEN, INSTANCE_NAME, GROK_API_KEY } = process.env;

  // 1. Evitar bucles y mensajes vacíos
  if (!req.body?.data?.message) return res.status(200).send('OK');
  const data = req.body.data;
  if (data.key?.fromMe) return res.status(200).send('OK');

  const clienteMsg = data.message?.conversation || data.message?.extendedTextMessage?.text || "";
  const remoteJid = data.key?.remoteJid;

  try {
    // 2. EL CEREBRO DE FIORELLA (Toda la info aquí para que no falle buscando archivos)
    const masterPrompt = `Eres Fiorella, asesora experta en salud de JRJMarket.
    
    ESTRATEGIA DE VENTA (AIDA):
    - Saluda con calidez y como una amiga: "¡Hola! Qué gusto saludarte, soy Fiorella de JRJMarket 🌿".
    - Si el cliente ya te dijo algo (como su ciudad), NO te presentes de nuevo. Sigue la charla: "¡Qué chévere Quito! Justo hoy enviamos varios combos para allá".
    - Si no contesta o duda, usa la escasez: "Dame un momentito porfa, estamos a full con el lanzamiento y me quedan poquitos combos".
    - Si el combo ($37.99) es mucho, ofrece el individual: Colágeno ($25) o Aceite de Orégano ($18.50).
    
    INFO TÉCNICA:
    El aceite de orégano limpia bacterias (Helicobacter) y hongos para que el colágeno hidrolizado se absorba y regenere piel, huesos y energía.
    PAGO: Contra entrega. ENVÍO: Gratis a todo Ecuador.
    
    REGLA DE ORO: Máximo 3 frases. Termina SIEMPRE con una PREGUNTA de cierre.`;

    // 3. Llamada a la IA
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

    // 4. Envío a WhatsApp (URL limpia)
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
          delay: 1200
        })
      });
    }

    return res.status(200).send('OK');
  } catch (error) {
    console.error("Error en el Webhook:", error.message);
    return res.status(200).send('OK');
  }
}
