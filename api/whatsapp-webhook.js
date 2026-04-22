// /api/whatsapp-webhook.js (Versión Persuasiva JRJMarket)
export default async function handler(req, res) {
  const { EVOLUTION_URL, EVOLUTION_TOKEN, INSTANCE_NAME, GEMINI_API_KEY } = process.env;

  if (!req.body.data || !req.body.data.message) return res.status(200).send('OK');
  const incoming = req.body.data;
  if (incoming.key.fromMe) return res.status(200).send('OK');

  const clienteMsg = incoming.message.conversation || incoming.message.extendedTextMessage?.text || "";
  const remoteJid = incoming.key.remoteJid;
  const customerPhone = remoteJid.split('@')[0];

  try {
    const promptIA = `
      Eres el asistente experto de JRJMarket en Ecuador. Tu misión es CONFIRMAR el pedido y obtener la referencia de entrega.
      
      ESCENARIOS:
      1. SI EL CLIENTE CONFIRMA O DA REFERENCIA: Dile que el producto ha sido despachado, que esté atento y que le envías el ebook.
      2. SI EL CLIENTE DICE QUE "NO" O QUIERE CANCELAR: No aceptes el no de inmediato. Pregunta amablemente el motivo. Si es por el precio, recuérdale los beneficios de salud/crecimiento. Intenta ofrecerle una cantidad menor (ej: 1 en lugar de 2) para no perder el cliente.
      3. SI EL CLIENTE TIENE DUDAS: Responde con autoridad y amabilidad.
      
      REGLAS DE ORO:
      - Usa un tono ecuatoriano, amable y profesional.
      - Sé breve. No uses párrafos largos.
      - Si logras que cambie de opinión y confirme, usa la palabra "DESPACHADO" en tu respuesta.
    `;

    const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${promptIA}\n\nCliente dice: "${clienteMsg}"\nRespuesta persuasiva:` }] }]
      })
    });

    const dataIA = await geminiRes.json();
    const textoIA = dataIA.candidates[0].content.parts[0].text;

    const headers = { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN };
    
    // 1. Enviar la respuesta inteligente de la IA
    await fetch(`${EVOLUTION_URL}/message/sendText/${INSTANCE_NAME}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ number: customerPhone, text: textoIA, delay: 1500 })
    });

    // 2. ENVIAR MULTIMEDIA SOLO SI CONFIRMÓ (Contiene la palabra clave)
    const confirmo = textoIA.toLowerCase().includes("despachado") || 
                     textoIA.toLowerCase().includes("camino");

    if (confirmo) {
      // Enviar Ebook (PDF)
      await fetch(`${EVOLUTION_URL}/message/sendMedia/${INSTANCE_NAME}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          number: customerPhone,
          media: "https://tu-dominio.com/guia.pdf", // PON TU LINK REAL
          mediatype: "document",
          fileName: "Ebook_KidGrow_JRJMarket.pdf",
          caption: "Aquí tiene el ebook prometido. ¡Disfrútelo!"
        })
      });
      
      // OPCIONAL: Enviar Foto del producto también
      /*
      await fetch(`${EVOLUTION_URL}/message/sendMedia/${INSTANCE_NAME}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          number: customerPhone,
          media: "https://tu-dominio.com/foto.jpg", // PON TU LINK REAL
          mediatype: "image",
          caption: "Su paquete se ve así y ya va en camino."
        })
      });
      */
    }

    res.status(200).send('SUCCESS');
  } catch (error) {
    console.error('Error:', error);
    res.status(200).send('OK');
  }
}
