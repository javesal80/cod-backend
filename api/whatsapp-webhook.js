export default async function handler(req, res) {
  const { EVOLUTION_URL, EVOLUTION_TOKEN, INSTANCE_NAME, GROK_API_KEY } = process.env;

  if (!req.body?.data?.message) return res.status(200).send('OK');
  const data = req.body.data;
  if (data.key?.fromMe) return res.status(200).send('OK');

  const clienteMsg = (data.message?.conversation || data.message?.extendedTextMessage?.text || "Hola").trim();
  const remoteJid = data.key?.remoteJid;
  const baseUrl = EVOLUTION_URL.replace(/\/$/, "");

  try {
    const respIA = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${GROK_API_KEY.trim()}`, 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({
        model: "grok-2", // CAMBIADO: grok-2 es el modelo estándar actual
        messages: [
          { role: "system", content: "Eres Fiorella, una asistente amable." },
          { role: "user", content: clienteMsg }
        ],
        stream: false
      })
    });

    const resJson = await respIA.json();

    if (resJson.choices && resJson.choices[0]) {
      const textoFinal = resJson.choices[0].message.content;
      await fetch(`${baseUrl}/message/sendText/${INSTANCE_NAME.trim()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
        body: JSON.stringify({ number: remoteJid, text: textoFinal })
      });
    } else {
      // Si grok-2 también falla, este mensaje nos dirá exactamente cuáles modelos TIENES disponibles
      await fetch(`${baseUrl}/message/sendText/${INSTANCE_NAME.trim()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
        body: JSON.stringify({ number: remoteJid, text: "Error de xAI: " + (resJson.error?.message || JSON.stringify(resJson)) })
      });
    }

    return res.status(200).send('OK');
  } catch (error) {
    return res.status(200).send('OK');
  }
}
