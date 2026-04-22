// /api/whatsapp-webhook.js (v2.0 - JRJMarket Multimodelo)
export default async function handler(req, res) {
  const { 
    EVOLUTION_URL, EVOLUTION_TOKEN, INSTANCE_NAME, 
    OPENAI_API_KEY, GROK_API_KEY, GEMINI_API_KEY 
  } = process.env;

  // --- ELIGE TU MOTOR AQUÍ ---
  const MOTOR_ACTIVO = "grok"; // Opciones: "grok", "openai", "gemini"
  // ---------------------------

  if (!req.body.data || !req.body.data.message) return res.status(200).send('OK');
  const incoming = req.body.data;
  if (incoming.key.fromMe) return res.status(200).send('OK');

  const clienteMsg = incoming.message.conversation || incoming.message.extendedTextMessage?.text || "";
  const remoteJid = incoming.key.remoteJid;
  const customerPhone = remoteJid.split('@')[0];

  try {
    const promptIA = `Eres el asistente experto de JRJMarket en Ecuador. Tu misión es CONFIRMAR el pedido y obtener la referencia.
    REGLAS:
    1. Si el cliente confirma o da referencia, responde que el pedido está DESPACHADO y agradece.
    2. Si el cliente dice que NO o quiere cancelar, sé persuasivo, recuerda los beneficios y ofrece ayuda.
    3. Si quiere cambiar cantidades (ej: de 2 a 1), acepta amablemente.
    Sé breve, usa emojis y mantén el estilo amable de JRJMarket.`;

    let textoIA = "";

    // LÓGICA DE MOTORES DE IA
    if (MOTOR_ACTIVO === "grok") {
      const resp = await fetch('https://api.xai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${GROK_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: "grok-beta",
          messages: [{role: "system", content: promptIA}, {role: "user", content: clienteMsg}]
        })
      });
      const data = await resp.json();
      textoIA = data.choices[0].message.content;

    } else if (MOTOR_ACTIVO === "openai") {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{role: "system", content: promptIA}, {role: "user", content: clienteMsg}]
        })
      });
      const data = await resp.json();
      textoIA = data.choices[0].message.content;
    }

    // 1. ENVIAR RESPUESTA DE TEXTO A WHATSAPP
    const headersWA = { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN };
    await fetch(`${EVOLUTION_URL}/message/sendText/${INSTANCE_NAME}`, {
      method: 'POST',
      headers: headersWA,
      body: JSON.stringify({ number: customerPhone, text: textoIA, delay: 1500 })
    });

    // 2. LÓGICA DE ENVÍO DE ARCHIVOS (IMAGEN Y EBOOK)
    const confirmo = textoIA.toLowerCase().includes("despachado") || textoIA.toLowerCase().includes("camino");

    if (confirmo) {
      // ENVIAR IMAGEN DEL PRODUCTO
      await fetch(`${EVOLUTION_URL}/message/sendMedia/${INSTANCE_NAME}`, {
        method: 'POST',
        headers: headersWA,
        body: JSON.stringify({
          number: customerPhone,
          media: "https://cod-backend-xi.vercel.app/producto.jpg", // LINK REAL
          mediatype: "image",
          caption: "Este es el producto que va en camino."
        })
      });

      // ENVIAR EBOOK PDF
      await fetch(`${EVOLUTION_URL}/message/sendMedia/${INSTANCE_NAME}`, {
        method: 'POST',
        headers: headersWA,
        body: JSON.stringify({
          number: customerPhone,
          media: "https://cod-backend-xi.vercel.app/guia-vital.pdf", // LINK REAL
          mediatype: "document",
          fileName: "Ebook_KidGrow_JRJMarket.pdf",
          caption: "Aquí le adjunto el ebook prometido."
        })
      });
    }

    res.status(200).send('SUCCESS');
  } catch (error) {
    console.error('Error:', error);
    res.status(200).send('OK');
  }
}
