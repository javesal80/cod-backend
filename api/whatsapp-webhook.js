export default async function handler(req, res) {
  const { EVOLUTION_URL, EVOLUTION_TOKEN, INSTANCE_NAME, GROK_API_KEY } = process.env;

  if (!req.body?.data?.message) return res.status(200).send('OK');
  const data = req.body.data;
  if (data.key?.fromMe) return res.status(200).send('OK');

  const clienteMsg = data.message?.conversation || data.message?.extendedTextMessage?.text || "";
  const remoteJid = data.key?.remoteJid;

  try {
    // 1. IA - Grok
    const respIA = await fetch('https://api.xai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROK_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: "grok-beta",
        messages: [{ role: "system", content: "Eres el asistente de JRJMarket." }, { role: "user", content: clienteMsg }]
      })
    });
    const resJson = await respIA.json();
    const textoIA = resJson.choices?.[0]?.message?.content || "¡Hola!";

    const cleanUrl = EVOLUTION_URL.replace(/\/$/, "");
    
    // 2. PROBAR AMBAS RUTAS SIMULTÁNEAMENTE
    const rutaA = `${cleanUrl}/message/sendText/${INSTANCE_NAME}`;
    const rutaB = `${cleanUrl}/chat/sendText/${INSTANCE_NAME}`;

    const payload = { number: remoteJid, text: textoIA };
    const headers = { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN };

    console.log("Probando Ruta A:", rutaA);
    const resA = await fetch(rutaA, { method: 'POST', headers, body: JSON.stringify(payload) });
    
    if (resA.status === 404) {
      console.log("Ruta A falló (404), intentando Ruta B...");
      const resB = await fetch(rutaB, { method: 'POST', headers, body: JSON.stringify(payload) });
      const finalRes = await resB.json();
      console.log("RESULTADO FINAL B:", finalRes);
    } else {
      const finalRes = await resA.json();
      console.log("RESULTADO FINAL A:", finalRes);
    }

    return res.status(200).send('OK');
  } catch (error) {
    console.error('ERROR:', error.message);
    return res.status(200).send('OK');
  }
}
