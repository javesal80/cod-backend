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

    // EXTRACCIÓN DEL TEXTO LIMPIO (Navegando por el JSON que recibiste)
    let textoLimpio = "";
    
    if (Array.isArray(resJson) && resJson[1] && resJson[1].content) {
      // Formato de lista: El mensaje suele estar en la segunda posición (index 1)
      textoLimpio = resJson[1].content[0].text;
    } else if (resJson.output) {
      textoLimpio = resJson.output;
    } else {
      // Respaldo por si el formato varía ligeramente
      textoLimpio = "¡Hola! Soy Fiorella, ¿en qué ciudad estás?"; 
    }

    // ENVIAR SOLO EL TEXTO AL CLIENTE
    await fetch(`${baseUrl}/message/sendText/${INSTANCE_NAME.trim()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
      body: JSON.stringify({ number: remoteJid, text: textoLimpio })
    });

    return res.status(200).send('OK');
  } catch (error) {
    return res.status(200).send('OK');
  }
}
