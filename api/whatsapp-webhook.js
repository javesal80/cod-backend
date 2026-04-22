export default async function handler(req, res) {
  // Solo usamos estas 3 variables que son las fijas
  const { EVOLUTION_URL, EVOLUTION_TOKEN, GROK_API_KEY } = process.env;

  // 1. Validar que llegue mensaje
  if (!req.body?.data?.message) return res.status(200).send('OK');
  const data = req.body.data;
  if (data.key?.fromMe) return res.status(200).send('OK');

  const clienteMsg = (data.message?.conversation || data.message?.extendedTextMessage?.text || "Hola").trim();
  const remoteJid = data.key?.remoteJid;
  const baseUrl = EVOLUTION_URL.replace(/\/$/, "");

  try {
    // 2. LLAMADA DIRECTA A GROK (Formato que nos funcionó a las 16:15)
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

    // 3. EXTRACCIÓN DEL TEXTO (Buscando el objeto 'message')
    let textoFinal = "";
    if (Array.isArray(resJson)) {
      const msgObj = resJson.find(i => i.type === "message");
      textoFinal = msgObj?.content?.[0]?.text;
    } else {
      textoFinal = resJson.output || JSON.stringify(resJson);
    }

    // 4. ENVÍO FORZADO A LA INSTANCIA VitaeLAB
    if (textoFinal) {
      await fetch(`${baseUrl}/message/sendText/VitaeLAB`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json', 
          'apikey': EVOLUTION_TOKEN 
        },
        body: JSON.stringify({ 
          number: remoteJid, 
          text: textoFinal.trim() 
        })
      });
    }

    return res.status(200).send('OK');
  } catch (error) {
    // Si falla, intentamos enviarte el error a tu WhatsApp para saber por qué
    await fetch(`${baseUrl}/message/sendText/VitaeLAB`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
      body: JSON.stringify({ number: remoteJid, text: "Error: " + error.message })
    });
    return res.status(200).send('OK');
  }
}
