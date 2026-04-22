export default async function handler(req, res) {
  const { EVOLUTION_URL, EVOLUTION_TOKEN, INSTANCE_NAME, GROK_API_KEY } = process.env;

  console.log("=== MENSAJE RECIBIDO ===");
  console.log("Body:", JSON.stringify(req.body));

  if (!req.body?.data?.message) {
    console.log("SIN MENSAJE - saliendo");
    return res.status(200).send('OK');
  }

  const data = req.body.data;
  if (data.key?.fromMe) {
    console.log("MENSAJE PROPIO - saliendo");
    return res.status(200).send('OK');
  }

  const clienteMsg = data.message?.conversation ||
                     data.message?.extendedTextMessage?.text || "";
  const remoteJid = data.key?.remoteJid;

  console.log("Cliente:", remoteJid);
  console.log("Mensaje:", clienteMsg);
  console.log("GROK KEY existe:", !!GROK_API_KEY);
  console.log("EVOLUTION_URL:", EVOLUTION_URL);
  console.log("INSTANCE_NAME:", INSTANCE_NAME);

  try {
    // Llamada a Grok
    const respIA = await fetch('https://api.xai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROK_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: "grok-beta",
        messages: [
          { role: "system", content: "Eres Fiorella de JRJMarket Ecuador. Responde brevemente y con calidez." },
          { role: "user", content: clienteMsg }
        ]
      })
    });
