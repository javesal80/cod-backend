// /api/whatsapp-webhook.js (v2.6 - Corrección de Ruta /chat/)
export default async function handler(req, res) {
  const { 
    EVOLUTION_URL, EVOLUTION_TOKEN, INSTANCE_NAME, GROK_API_KEY 
  } = process.env;

  if (!req.body || !req.body.data) return res.status(200).send('OK');
  const data = req.body.data;
  if (data.key?.fromMe) return res.status(200).send('OK');

  const clienteMsg = data.message?.conversation || data.message?.extendedTextMessage?.text || "";
  const remoteJid = data.key?.remoteJid;
  if (!clienteMsg || !remoteJid) return res.status(200).send('OK');

  try {
    // 1. Consultar a Grok
    const respIA = await fetch('https://api.xai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROK_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: "grok-beta",
        messages: [
          { role: "system", content: "Eres el asistente de JRJMarket en Ecuador. Sé amable y breve." },
          { role: "user", content: clienteMsg }
        ]
      })
    });
    const resJson = await respIA.json();
    const textoIA = resJson.choices?.[0]?.message?.content || "¡Hola! ¿En qué puedo ayudarte?";

    // 2. ENVÍO A WHATSAPP (Ruta específica para v2.3.7)
    const baseUrl = EVOLUTION_URL.replace(/\/$/, ""); 
    
    // ATENCIÓN: La ruta correcta es /chat/sendText/
    const urlFinal = `${baseUrl}/chat/sendText/${INSTANCE_NAME}`;
    
    const responseWA = await fetch(urlFinal, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json', 
        'apikey': EVOLUTION_TOKEN 
      },
      body: JSON.stringify({
        number: remoteJid,
        text: textoIA,
        delay: 1200,
        linkPreview: false
      })
    });

    const debugMsg = await responseWA.text();
    console.log("Respuesta Final Evolution:", debugMsg);

    return res.status(200).send('OK');
  } catch (error) {
    console.error('Error Crítico:', error.message);
    return res.status(200).send('OK');
  }
}
