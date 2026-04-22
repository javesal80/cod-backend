let memoriaTemporal = {};

export default async function handler(req, res) {
  console.log("\n========== NUEVO MENSAJE RECIBIDO ==========");
  
  const { EVOLUTION_URL, EVOLUTION_TOKEN, INSTANCE_NAME, GROK_API_KEY } = process.env;

  // 1. Filtrar si no hay mensaje
  if (!req.body?.data?.message) {
    console.log("-> Ignorado: No hay mensaje válido en el webhook.");
    return res.status(200).send('OK');
  }
  
  const data = req.body.data;
  
  // 2. Filtrar si el mensaje es del propio bot
  if (data.key?.fromMe) {
    console.log("-> Ignorado: Mensaje enviado por el bot (fromMe).");
    return res.status(200).send('OK');
  }

  const clienteMsg = (data.message?.conversation || data.message?.extendedTextMessage?.text || "").trim();
  const remoteJid = data.key?.remoteJid;

  console.log(`[Paso 1] Mensaje extraído. De: ${remoteJid} | Texto: "${clienteMsg}"`);

  // 3. Memoria
  if (!memoriaTemporal[remoteJid]) memoriaTemporal[remoteJid] = [];
  memoriaTemporal[remoteJid].push({ role: "user", content: clienteMsg });
  if (memoriaTemporal[remoteJid].length > 4) memoriaTemporal[remoteJid].shift();

  console.log(`[Paso 2] Memoria lista. Historial: ${memoriaTemporal[remoteJid].length} mensajes.`);

  try {
    // 4. Llamada a Grok
    console.log("[Paso 3] Enviando petición a Grok (IA)...");
    const respIA = await fetch('https://api.xai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${GROK_API_KEY}`, 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({
        model: "grok-beta",
        messages: [
          { role: "system", content: "Eres un asistente conversacional básico. Responde corto." },
          ...memoriaTemporal[remoteJid]
        ]
      })
    });

    const resJson = await respIA.json();

    if (resJson.error) {
      console.error("[ERROR GROK API]:", resJson.error);
      return res.status(200).send('OK');
    }

    const textoIA = resJson.choices?.[0]?.message?.content;
    console.log(`[Paso 4] Grok contestó con éxito: "${textoIA}"`);

    // 5. Envío a Evolution API
    if (textoIA) {
      memoriaTemporal[remoteJid].push({ role: "assistant", content: textoIA });
      
      console.log("[Paso 5] Enviando mensaje a WhatsApp...");
      const baseUrl = EVOLUTION_URL.replace(/\/$/, "");
      
      const evolResp = await fetch(`${baseUrl}/message/sendText/${INSTANCE_NAME.trim()}`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json', 
          'apikey': EVOLUTION_TOKEN 
        },
        body: JSON.stringify({ number: remoteJid, text: textoIA })
      });

      if (evolResp.ok) {
        console.log("[Paso 6] ✅ Mensaje enviado exitosamente a WhatsApp.");
      } else {
        const errorEvol = await evolResp.text();
        console.error("[ERROR EVOLUTION API]:", errorEvol);
      }
    }

    console.log("========== FIN DEL PROCESO ==========\n");
    return res.status(200).send('OK');

  } catch (error) {
    console.error("[ERROR CRÍTICO DEL SERVIDOR]:", error.message);
    return res.status(200).send('OK');
  }
}
