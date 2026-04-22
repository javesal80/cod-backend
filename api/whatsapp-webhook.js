// /api/whatsapp-webhook.js (El Cerebro que decide qué archivos enviar)
export default async function handler(req, res) {
  const { EVOLUTION_URL, EVOLUTION_TOKEN, INSTANCE_NAME, GEMINI_API_KEY } = process.env;

  // 1. Validar que sea un mensaje real del cliente
  if (!req.body.data || !req.body.data.message) return res.status(200).send('OK');
  const incoming = req.body.data;
  if (incoming.key.fromMe) return res.status(200).send('OK');

  const clienteMsg = incoming.message.conversation || incoming.message.extendedTextMessage?.text || "";
  const remoteJid = incoming.key.remoteJid;
  const customerPhone = remoteJid.split('@')[0];

  try {
    // 2. IA: Google Gemini analiza la respuesta
    const promptIA = `
      Eres el asistente de JRJMarket en Ecuador. El cliente acaba de recibir un mensaje de confirmación de pedido.
      REGLAS:
      - Si el cliente da una referencia o confirma (ej: "claro", "frente a la tienda"), agradécele y dile que su pedido ha sido despachado.
      - Si el cliente tiene dudas sobre el precio o cantidad, respóndele amablemente.
      - Tu objetivo es ser amable y cerrar la confirmación.
    `;

    const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${promptIA}\n\nCliente: "${clienteMsg}"` }] }]
      })
    });

    const dataIA = await geminiRes.json();
    const textoIA = dataIA.candidates[0].content.parts[0].text;

    // 3. ENVIAR RESPUESTA DE TEXTO
    const headers = { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN };
    await fetch(`${EVOLUTION_URL}/message/sendText/${INSTANCE_NAME}`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ number: customerPhone, text: textoIA, delay: 1500 })
    });

    // 4. LÓGICA MULTIMEDIA: ¿Qué enviamos al confirmar?
    const esConfirmacion = textoIA.toLowerCase().includes("despachado") || 
                           textoIA.toLowerCase().includes("atento") || 
                           textoIA.toLowerCase().includes("camino");

    if (esConfirmacion) {
      
      // OPCIÓN A: ENVIAR IMAGEN DEL PRODUCTO (Descomenta si la quieres enviar)
      /*
      await fetch(`${EVOLUTION_URL}/message/sendMedia/${INSTANCE_NAME}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          number: customerPhone,
          media: "https://tu-dominio.com/foto-producto.jpg", 
          mediatype: "image",
          caption: "Aquí tienes una foto de tu producto que va en camino."
        })
      });
      */

      // OPCIÓN B: ENVIAR EL EBOOK (PDF)
      // Este es el que sueles enviar según tu ejemplo
      await fetch(`${EVOLUTION_URL}/message/sendMedia/${INSTANCE_NAME}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          number: customerPhone,
          media: "https://tu-dominio.com/ebook-regalo.pdf", 
          mediatype: "document",
          fileName: "Ebook_JRJMarket.pdf",
          caption: "Le adjunto el ebook del producto prometido."
        })
      });
    }

    res.status(200).send('SUCCESS');
  } catch (error) {
    console.error('Error en Webhook:', error);
    res.status(200).send('OK');
  }
}
