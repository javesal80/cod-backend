// /api/whatsapp-webhook.js (v2.5 - Corrección Final de Ruta)
export default async function handler(req, res) {
  const { 
    EVOLUTION_URL, EVOLUTION_TOKEN, INSTANCE_NAME, GROK_API_KEY 
  } = process.env;

  if (!req.body || !req.body.data) return res.status(200).send('OK');
  const data = req.body.data;
  if (data.key?.fromMe) return res.status(200).send('OK');

  const clienteMsg = data.message?.conversation || data.message?.extendedTextMessage?.text || "";
  const remoteJid = data.key?.remoteJid;
  if (!clienteMsg || !remoteJid) return res.status(200).send('OK');

  try {
    // 1. Pensamiento de la IA
    const respIA = await fetch('https://api.xai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROK_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: "grok-beta",
        messages: [{ role: "system", content: "Eres el asistente de JRJMarket en Ecuador. Sé amable y breve." }, { role: "user", content: clienteMsg }]
      })
    });
    const resJson = await respIA.json();
    const textoIA = resJson.choices?.[0]?.message?.content || "¡Hola!";

    // 2. ENVÍO A WHATSAPP (Ruta corregida para v2.3.7)
    // Eliminamos barras dobles por si acaso
    const baseUrl = EVOLUTION_URL.replace(/\/$/, ""); 
    const urlFinal = `${baseUrl}/message/sendText/${INSTANCE_NAME}`;
    
    console.log("Intentando enviar a:", urlFinal);

    const responseWA = await fetch(urlFinal, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json', 
        'apikey': EVOLUTION_TOKEN 
      },
      body: JSON.stringify({
        number: remoteJid, // Usamos el ID completo
        text: textoIA,
        delay: 1200
      })
    });

    const respuestaTexto = await responseWA.text();
    console.log("Respuesta Final Evolution:", respuestaTexto);

    return res.status(200).send('OK');
  } catch (error) {
    console.error('Error Crítico:', error.message);
    return res.status(200).send('OK');
  }
}
