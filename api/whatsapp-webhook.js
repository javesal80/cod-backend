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

    // EXTRACCIÓN ULTRA-SEGURA: Buscamos el texto donde sea que esté
    let textoFinal = "";

    try {
      // Intentamos la ruta que vimos en tu mensaje anterior
      if (Array.isArray(resJson)) {
        const mensajeObj = resJson.find(item => item.type === "message");
        if (mensajeObj && mensajeObj.content) {
          textoFinal = mensajeObj.content[0].text;
        }
      } 
      // Si no aparece ahí, intentamos convertirlo a texto y buscar el campo "text"
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

    // Si encontramos algo, lo mandamos. Si no, mandamos el error para no estar ciegos.
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
