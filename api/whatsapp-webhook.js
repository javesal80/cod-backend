export default async function handler(req, res) {
  const { EVOLUTION_URL, EVOLUTION_TOKEN, INSTANCE_NAME, GROK_API_KEY } = process.env;

  // 1. Validar mensaje entrante
  if (!req.body?.data?.message) return res.status(200).send('OK');
  const data = req.body.data;
  if (data.key?.fromMe) return res.status(200).send('OK');

  const clienteMsg = data.message?.conversation || data.message?.extendedTextMessage?.text || "";
  const remoteJid = data.key?.remoteJid;

  try {
    // 2. IA - Grok
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

    // 3. ENVÍO DIRECTO (Ruta universal de Evolution API)
    const cleanUrl = EVOLUTION_URL.replace(/\/$/, "");
    const urlFinal = `${cleanUrl}/message/sendText/${INSTANCE_NAME.trim()}`;

    const responseWA = await fetch(urlFinal, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN.trim() },
      body: JSON.stringify({
        number: remoteJid, // El ID completo 593...
        text: textoIA
      })
    });

    const resultado = await responseWA.json();
    console.log("INTENTO DE ENVÍO:", resultado);

    return res.status(200).send('OK');
  } catch (error) {
    console.error('ERROR:', error.message);
    return res.status(200).send('OK');
  }
}
