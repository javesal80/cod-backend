export default async function handler(req, res) {
  const { EVOLUTION_URL, EVOLUTION_TOKEN, INSTANCE_NAME, GROK_API_KEY } = process.env;

  if (!req.body?.data?.message) return res.status(200).send('OK');
  const data = req.body.data;
  if (data.key?.fromMe) return res.status(200).send('OK');

  const clienteMsg = (data.message?.conversation || data.message?.extendedTextMessage?.text || "Hola").trim();
  const remoteJid = data.key?.remoteJid;
  const baseUrl = EVOLUTION_URL.replace(/\/$/, "");

  try {
    // 1. LLAMADA AL ENDPOINT CORRECTO DE XAI
    const respIA = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${GROK_API_KEY.trim()}`, 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({
        model: "grok-beta", // USA ESTE MODELO, EL OTRO NO EXISTE
        messages: [
          { role: "system", content: "Eres Fiorella, una asistente amable de JRJMarket." },
          { role: "user", content: clienteMsg }
        ],
        stream: false
      })
    });

    const resJson = await respIA.json();

    // 2. CAPTURAR EL TEXTO O EL ERROR REAL
    let textoFinal = "";
    if (resJson.choices && resJson.choices[0]) {
      textoFinal = resJson.choices[0].message.content;
    } else {
      // Esto te dirá el error real si vuelve a fallar
      textoFinal = "Error de xAI: " + (resJson.error?.message || JSON.stringify(resJson));
    }

    // 3. ENVÍO A WHATSAPP
    await fetch(`${baseUrl}/message/sendText/${INSTANCE_NAME.trim()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
      body: JSON.stringify({ number: remoteJid, text: textoFinal })
    });

    return res.status(200).send('OK');

  } catch (error) {
    console.error("Fallo total:", error.message);
    return res.status(200).send('OK');
  }
}
