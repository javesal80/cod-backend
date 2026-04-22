let memoriaTemporal = {};

export default async function handler(req, res) {
  const { EVOLUTION_URL, EVOLUTION_TOKEN, INSTANCE_NAME, GROK_API_KEY } = process.env;
  const baseUrl = EVOLUTION_URL ? EVOLUTION_URL.replace(/\/$/, "") : "";

  if (!req.body?.data?.message) return res.status(200).send('OK');
  const data = req.body.data;
  if (data.key?.fromMe) return res.status(200).send('OK');

  const clienteMsg = (data.message?.conversation || data.message?.extendedTextMessage?.text || "").trim();
  const remoteJid = data.key?.remoteJid;

  // FUNCIÓN PARA ENVIARTE EL LOG DIRECTO A WHATSAPP
  const enviarLog = async (msg) => {
    await fetch(`${baseUrl}/message/sendText/${INSTANCE_NAME}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
      body: JSON.stringify({ number: remoteJid, text: `📢 LOG: ${msg}` })
    });
  };

  try {
    await enviarLog(`Mensaje recibido: "${clienteMsg}"`);

    // 1. Memoria
    if (!memoriaTemporal[remoteJid]) memoriaTemporal[remoteJid] = [];
    memoriaTemporal[remoteJid].push({ role: "user", content: clienteMsg });

    // 2. Llamada a Grok
    await enviarLog("Conectando con Grok IA...");
    const respIA = await fetch('https://api.xai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROK_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: "grok-beta",
        messages: [{ role: "system", content: "Responde corto." }, ...memoriaTemporal[remoteJid]]
      })
    });

    const resJson = await respIA.json();
    
    if (resJson.error) {
      await enviarLog(`❌ Error en Grok: ${resJson.error.message}`);
      return res.status(200).send('OK');
    }

    const textoIA = resJson.choices?.[0]?.message?.content;
    await enviarLog(`IA contestó: "${textoIA}"`);

    // 3. Envío final
    if (textoIA) {
      const evolResp = await fetch(`${baseUrl}/message/sendText/${INSTANCE_NAME}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
        body: JSON.stringify({ number: remoteJid, text: textoIA })
      });

      if (evolResp.ok) {
        await enviarLog("✅ Proceso completado. Deberías ver la respuesta ahora.");
      } else {
        const errText = await evolResp.text();
        await enviarLog(`❌ Error Evolution: ${errText}`);
      }
    }

    return res.status(200).send('OK');

  } catch (error) {
    await enviarLog(`🚨 ERROR CRÍTICO: ${error.message}`);
    return res.status(200).send('OK');
  }
}
