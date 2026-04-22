export default async function handler(req, res) {
  const { EVOLUTION_URL, EVOLUTION_TOKEN, INSTANCE_NAME, GROK_API_KEY } = process.env;

  // 1. Validar que el mensaje sea válido y no sea nuestro
  if (!req.body?.data?.message) return res.status(200).send('OK');
  const data = req.body.data;
  if (data.key?.fromMe) return res.status(200).send('OK');

  const clienteMsg = data.message?.conversation || data.message?.extendedTextMessage?.text || "";
  const remoteJid = data.key?.remoteJid;

  // 2. BIBLIOTECA INTEGRADA (Toda la info aquí mismo)
  const infoVenta = `
    PRODUCTO: Combo Regeneración (Aceite de Orégano + Multicolágeno).
    PRECIOS: Combo $37.99 / Solo Colágeno $25 / Solo Orégano $18.50.
    BENEFICIOS: El orégano limpia bacterias y parásitos para que el colágeno regenere piel y huesos.
    PAGO: Contra entrega. ENVÍO: Gratis a todo Ecuador.
  `;

  try {
    // 3. EL MASTER PROMPT (Psicología y comportamiento)
    const masterPrompt = `Eres Fiorella, asesora experta de JRJMarket. 
    ¡REGLA DE ORO!: No parezcas un robot. Habla como una amiga cercana. 
    Si el cliente te da un dato (como su ciudad), NO te vuelvas a presentar. ¡Sigue la plática!
    
    ESTRATEGIA:
    - Valida el dolor del cliente (gastritis, manchas, dolor de huesos).
    - Usa el modelo AIDA para llevarlo al cierre.
    - Si no quiere el combo, ofrece el producto individual.
    - Siempre termina con una pregunta de cierre (ej: "¿En qué parte de Quito estás para el envío?").
    
    INFO PRODUCTO: ${infoVenta}`;

    // 4. LLAMADA A GROK
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

    // 5. ENVÍO A EVOLUTION API
    if (textoIA) {
      const baseUrl = EVOLUTION_URL.replace(/\/$/, "");
      await fetch(`${baseUrl}/message/sendText/${INSTANCE_NAME}`, {
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
    console.error("ERROR CRÍTICO:", error.message);
    return res.status(200).send('OK');
  }
}
