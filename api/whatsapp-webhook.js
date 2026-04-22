// /api/whatsapp-webhook.js (v2.3 - Depuración Total)
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
    // Llamada a Grok
    const respIA = await fetch('https://api.xai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROK_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: "grok-beta",
        messages: [{ role: "system", content: "Eres el asistente de JRJMarket." }, { role: "user", content: clienteMsg }]
      })
    });

    const resJson = await respIA.json();
    const textoIA = resJson.choices?.[0]?.message?.content || "Hola!";

    // ENVÍO A EVOLUTION
    const responseWA = await fetch(`${EVOLUTION_URL}/message/sendText/${INSTANCE_NAME}`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json', 
        'apikey': EVOLUTION_TOKEN 
      },
      body: JSON.stringify({
        number: remoteJid,
        text: textoIA
      })
    });

    // ESTO ES CLAVE: Ver que dice el servidor en los Logs de Vercel
    const respuestaServidor = await responseWA.text();
    console.log("Resultado Evolution:", respuestaServidor);

    return res.status(200).send('OK');
  } catch (error) {
    console.error('Error:', error);
    return res.status(200).send('OK');
  }
}
