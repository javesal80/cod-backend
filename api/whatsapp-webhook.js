export default async function handler(req, res) {
  const { EVOLUTION_URL, EVOLUTION_TOKEN, INSTANCE_NAME, GROK_API_KEY } = process.env;

  if (!req.body?.data?.message) return res.status(200).send('OK');
  const data = req.body.data;
  if (data.key?.fromMe) return res.status(200).send('OK');

  const clienteMsg = (data.message?.conversation || data.message?.extendedTextMessage?.text || "Hola").trim();
  const remoteJid = data.key?.remoteJid;
  const baseUrl = EVOLUTION_URL.replace(/\/$/, "");

  try {
    const respIA = await fetch('https://api.x.ai/v1/responses', {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${GROK_API_KEY.trim()}`, 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({
        model: "grok-4.20-reasoning",
        input: clienteMsg
      })
    });

    const resJson = await respIA.json();

    // --- BUSCADOR AUTOMÁTICO DE TEXTO ---
    let textoFinal = "";

    if (Array.isArray(resJson)) {
      // Buscamos en cada objeto del array el que tenga el contenido del assistant
      for (const item of resJson) {
        if (item.role === "assistant" && item.content) {
          // Buscamos dentro de 'content' el 'output_text'
          const contentObj = item.content.find(c => c.type === "output_text");
          if (contentObj) {
            textoFinal = contentObj.text;
            break; 
          }
        }
      }
    }

    // Si por alguna razón el buscador falla, intentamos la ruta directa que vimos antes
    if (!textoFinal && resJson[1]?.content?.[0]?.text) {
      textoFinal = resJson[1].content[0].text;
    }

    // --- ENVÍO A WHATSAPP ---
    if (textoFinal) {
      await fetch(`${baseUrl}/message/sendText/${INSTANCE_NAME.trim()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
        body: JSON.stringify({ number: remoteJid, text: textoFinal.trim() })
      });
    } else {
      // Si todo falla, al menos te avisa para saber que la ruta cambió
      console.log("No se pudo extraer texto del JSON:", JSON.stringify(resJson));
    }

    return res.status(200).send('OK');
  } catch (error) {
    console.error("Error:", error);
    return res.status(200).send('OK');
  }
}
