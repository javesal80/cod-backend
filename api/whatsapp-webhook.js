export default async function handler(req, res) {
  const { EVOLUTION_URL, EVOLUTION_TOKEN, INSTANCE_NAME, GROK_API_KEY } = process.env;

  if (!req.body?.data?.message) return res.status(200).send('OK');
  const data = req.body.data;
  if (data.key?.fromMe) return res.status(200).send('OK');

  const clienteMsg = (data.message?.conversation || data.message?.extendedTextMessage?.text || "Hola").trim();
  const remoteJid = data.key?.remoteJid;
  const baseUrl = EVOLUTION_URL.replace(/\/$/, "");

  try {
    // 1. LLAMADA DIRECTA Y SIMPLE
    const respIA = await fetch('https://api.xai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${GROK_API_KEY.trim()}`, 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({
        model: "grok-beta",
        messages: [
          { role: "system", content: "Eres Fiorella, una vendedora amable. Responde siempre en menos de 20 palabras." },
          { role: "user", content: clienteMsg }
        ],
        stream: false // Forzamos a que no use streaming para evitar el "vacío"
      })
    });

    const resJson = await respIA.json();

    // 2. EXTRACCIÓN MANUAL (Para ver qué hay dentro si falla)
    let textoFinal = "";
    
    if (resJson.choices && resJson.choices.length > 0 && resJson.choices[0].message) {
      textoFinal = resJson.choices[0].message.content;
    } else {
      // Si sigue saliendo vacío, te enviamos el código de error técnico
      textoFinal = "Error técnico: " + JSON.stringify(resJson);
    }

    // 3. ENVÍO A WHATSAPP
    await fetch(`${baseUrl}/message/sendText/${INSTANCE_NAME.trim()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
      body: JSON.stringify({ number: remoteJid, text: textoFinal })
    });

    return res.status(200).send('OK');

  } catch (error) {
    // Si el fetch falla por red o DNS
    await fetch(`${baseUrl}/message/sendText/${INSTANCE_NAME.trim()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
      body: JSON.stringify({ number: remoteJid, text: "🚨 Error de red: " + error.message })
    });
    return res.status(200).send('OK');
  }
}
