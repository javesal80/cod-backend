export default async function handler(req, res) {
  const { EVOLUTION_URL, EVOLUTION_TOKEN, INSTANCE_NAME, GROK_API_KEY } = process.env;

  if (!req.body?.data?.message) return res.status(200).send('OK');
  const data = req.body.data;
  if (data.key?.fromMe) return res.status(200).send('OK');

  const clienteMsg = (data.message?.conversation || data.message?.extendedTextMessage?.text || "Hola").trim();
  const remoteJid = data.key?.remoteJid;
  const baseUrl = EVOLUTION_URL.replace(/\/$/, "");

  try {
    // LLAMADA SEGÚN TU CAPTURA: /v1/responses
    const respIA = await fetch('https://api.x.ai/v1/responses', {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${GROK_API_KEY.trim()}`, 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({
        model: "grok-4.20-reasoning",
        input: clienteMsg // En este modelo se usa 'input', no 'messages'
      })
    });

    const resJson = await respIA.json();

    // Según este nuevo formato, la respuesta suele venir en resJson.output o resJson.message
    let textoIA = resJson.output || (resJson.choices && resJson.choices[0]?.message?.content) || JSON.stringify(resJson);

    // Si el texto es un objeto (JSON), lo limpiamos para WhatsApp
    if (typeof textoIA === 'object') textoIA = JSON.stringify(textoIA);

    await fetch(`${baseUrl}/message/sendText/${INSTANCE_NAME.trim()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
      body: JSON.stringify({ number: remoteJid, text: textoIA })
    });

    return res.status(200).send('OK');
  } catch (error) {
    return res.status(200).send('OK');
  }
}
