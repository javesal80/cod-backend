export default async function handler(req, res) {
  const { EVOLUTION_URL, EVOLUTION_TOKEN, INSTANCE_NAME, GROK_API_KEY } = process.env;

  if (!req.body?.data?.message) return res.status(200).send('OK');
  const data = req.body.data;
  if (data.key?.fromMe) return res.status(200).send('OK');

  const clienteMsg = (data.message?.conversation || data.message?.extendedTextMessage?.text || "").trim();
  const remoteJid = data.key?.remoteJid;

  try {
    // 1. PETICIÓN PURA A GROK
    const respIA = await fetch('https://api.xai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${GROK_API_KEY.trim()}`, 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({
        model: "grok-beta",
        messages: [
          { role: "system", content: "Eres Fiorella, una asistente real. Responde corto." },
          { role: "user", content: clienteMsg }
        ]
      })
    });

    const resJson = await respIA.json();

    // 2. LOG PARA SABER QUÉ PASA (Aparecerá en tu consola de Vercel)
    console.log("Respuesta de Grok:", JSON.stringify(resJson));

    if (resJson.choices && resJson.choices[0]) {
      const textoIA = resJson.choices[0].message.content;
      
      // 3. ENVÍO A WHATSAPP
      const baseUrl = EVOLUTION_URL.replace(/\/$/, "");
      await fetch(`${baseUrl}/message/sendText/${INSTANCE_NAME.trim()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
        body: JSON.stringify({ number: remoteJid, text: textoIA })
      });
    } else {
      // Si la IA no contesta, te enviamos el error a ti para que lo veas
      const baseUrl = EVOLUTION_URL.replace(/\/$/, "");
      await fetch(`${baseUrl}/message/sendText/${INSTANCE_NAME.trim()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
        body: JSON.stringify({ number: remoteJid, text: `⚠️ Error IA: ${resJson.error?.message || 'Respuesta vacía'}` })
      });
    }

    return res.status(200).send('OK');
  } catch (error) {
    console.error("Error crítico:", error.message);
    return res.status(200).send('OK');
  }
}
