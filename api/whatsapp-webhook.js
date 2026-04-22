export default async function handler(req, res) {
  const { EVOLUTION_URL, EVOLUTION_TOKEN, GROK_API_KEY } = process.env;

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
    let textoFinal = "";

    // Buscamos el mensaje de forma más flexible
    if (Array.isArray(resJson)) {
      // Buscamos cualquier objeto que tenga 'content' y extraemos el texto
      const msgObj = resJson.find(i => i.type === "message" || i.role === "assistant");
      if (msgObj && msgObj.content && msgObj.content[0]) {
        textoFinal = msgObj.content[0].text;
      }
    } 
    
    // Si sigue vacío, buscamos en la raíz del JSON
    if (!textoFinal) {
      textoFinal = resJson.output || resJson.text || JSON.stringify(resJson);
    }

    // Aseguramos que sea un String antes de enviarlo
    const mensajeTexto = String(textoFinal);

    await fetch(`${baseUrl}/message/sendText/VitaeLAB`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
      body: JSON.stringify({ 
        number: remoteJid, 
        text: mensajeTexto
      })
    });

    return res.status(200).send('OK');
  } catch (error) {
    await fetch(`${baseUrl}/message/sendText/VitaeLAB`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
      body: JSON.stringify({ number: remoteJid, text: "Hubo un pequeño salto en la respuesta, intenta de nuevo porfa." })
    });
    return res.status(200).send('OK');
  }
}
