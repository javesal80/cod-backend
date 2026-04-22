export default async function handler(req, res) {
  const { EVOLUTION_URL, EVOLUTION_TOKEN, INSTANCE_NAME, GROK_API_KEY } = process.env;

  if (!req.body?.data?.message) return res.status(200).send('OK');
  const data = req.body.data;
  if (data.key?.fromMe) return res.status(200).send('OK');

  const clienteMsg = (data.message?.conversation || data.message?.extendedTextMessage?.text || "Hola").trim();
  const remoteJid = data.key?.remoteJid;
  const baseUrl = EVOLUTION_URL.replace(/\/$/, "");

  // Mantenemos la esencia: Solo cambiamos lo que se le envía a la IA
  const promptVenta = `Actúa como Fiorella, asesora de JRJMarket en Ecuador. Sé breve, amable y usa un tono ecuatoriano. Responde a esto: ${clienteMsg}`;

  try {
    const respIA = await fetch('https://api.x.ai/v1/responses', {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${GROK_API_KEY.trim()}`, 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({
        model: "grok-4.20-reasoning",
        input: promptVenta // Usamos la variable con la instrucción
      })
    });

    const resJson = await respIA.json();

    // --- AQUÍ ESTÁ LA ESENCIA QUE NO VAMOS A TOCAR ---
    let textoFinal = "";
    try {
      if (Array.isArray(resJson)) {
        const mensajeObj = resJson.find(item => item.type === "message");
        if (mensajeObj && mensajeObj.content) {
          textoFinal = mensajeObj.content[0].text;
        }
      } 
      if (!textoFinal) {
        const stringJson = JSON.stringify(resJson);
        const match = stringJson.match(/"output_text","text":"([^"]+)"/);
        if (match) {
          textoFinal = match[1].replace(/\\n/g, '\n').replace(/\\u[0-9a-fA-F]{4}/g, (m) => String.fromCharCode(parseInt(m.substr(2), 16)));
        }
      }
    } catch (e) {
      console.log("Error extrayendo texto");
    }

    const mensajeAEnviar = textoFinal || "Error: No se pudo procesar la respuesta de la IA.";

    await fetch(`${baseUrl}/message/sendText/${INSTANCE_NAME.trim()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
      body: JSON.stringify({ number: remoteJid, text: mensajeAEnviar })
    });

    return res.status(200).send('OK');
  } catch (error) {
    return res.status(200).send('OK');
  }
}
