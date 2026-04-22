let memoriaTemporal = {};

export default async function handler(req, res) {
  const { EVOLUTION_URL, EVOLUTION_TOKEN, INSTANCE_NAME, GROK_API_KEY } = process.env;
  const baseUrl = EVOLUTION_URL ? EVOLUTION_URL.replace(/\/$/, "") : "";

  if (!req.body?.data?.message) return res.status(200).send('OK');
  const data = req.body.data;
  if (data.key?.fromMe) return res.status(200).send('OK');

  const clienteMsg = (data.message?.conversation || data.message?.extendedTextMessage?.text || "").trim();
  const remoteJid = data.key?.remoteJid;

  const enviarLog = async (msg) => {
    await fetch(`${baseUrl}/message/sendText/${INSTANCE_NAME}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
      body: JSON.stringify({ number: remoteJid, text: `📢 LOG: ${msg}` })
    });
  };

  try {
    await enviarLog(`Mensaje recibido: "${clienteMsg}"`);

    if (!memoriaTemporal[remoteJid]) memoriaTemporal[remoteJid] = [];
    memoriaTemporal[remoteJid].push({ role: "user", content: clienteMsg });

    await enviarLog("Conectando con Grok IA...");
    
    const respIA = await fetch('https://api.xai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${GROK_API_KEY}`, 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({
        model: "grok-beta", // Asegúrate que este sea el nombre del modelo en tu consola de xAI
        messages: [
          { role: "system", content: "Responde de forma muy breve y amigable." },
          ...memoriaTemporal[remoteJid]
        ]
      })
    });

    const resJson = await respIA.json();
    
    // VALIDACIÓN ROBUSTA DE LA RESPUESTA
    let textoIA = "";
    if (resJson.choices && resJson.choices[0] && resJson.choices[0].message) {
      textoIA = resJson.choices[0].message.content;
    } else {
      // Si no viene en el formato estándar, vemos qué devolvió
      textoIA = "Error: La IA no devolvió contenido válido. " + JSON.stringify(resJson).substring(0, 50);
    }

    await enviarLog(`IA contestó: "${textoIA}"`);

    if (textoIA && !textoIA.startsWith("Error:")) {
      memoriaTemporal[remoteJid].push({ role: "assistant", content: textoIA });
      
      await fetch(`${baseUrl}/message/sendText/${INSTANCE_NAME}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
        body: JSON.stringify({ number: remoteJid, text: textoIA })
      });
      
      await enviarLog("✅ Respuesta enviada al cliente.");
    }

    return res.status(200).send('OK');

  } catch (error) {
    await enviarLog(`🚨 ERROR CRÍTICO: ${error.message}`);
    return res.status(200).send('OK');
  }
}
