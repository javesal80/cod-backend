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
    // 1. Llamada a la IA
    const respIA = await fetch('https://api.xai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROK_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: "grok-beta",
        messages: [
          { role: "system", content: "Eres el asistente de JRJMarket en Ecuador. Confirma pedidos. Si confirman, responde 'DESPACHADO'." },
          { role: "user", content: clienteMsg }
        ]
      })
    });
    const resJson = await respIA.json();
    const textoIA = resJson.choices?.[0]?.message?.content || "¡Hola! Enseguida le ayudo.";

    // 2. RUTA DEFINITIVA PARA v2.3.7
    // La ruta correcta segun documentacion oficial es: /message/sendText/{instance}
    const cleanUrl = EVOLUTION_URL.replace(/\/$/, "");
    const urlFinal = `${cleanUrl}/message/sendText/${INSTANCE_NAME}`;

    const responseWA = await fetch(urlFinal, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
      body: JSON.stringify({
        number: remoteJid,
        text: textoIA,
        delay: 1000
      })
    });

    const debug = await responseWA.json();
    console.log("LOG FINAL:", debug);

    return res.status(200).send('OK');
  } catch (error) {
    console.error('ERROR CRITICO:', error.message);
    return res.status(200).send('OK');
  }
}
