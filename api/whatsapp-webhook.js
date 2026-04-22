const memoria = {};

export default async function handler(req, res) {
  const { EVOLUTION_URL, EVOLUTION_TOKEN, INSTANCE_NAME, GROK_API_KEY } = process.env;

  if (!req.body?.data?.message) return res.status(200).send('OK');
  const data = req.body.data;
  if (data.key?.fromMe) return res.status(200).send('OK');

  const clienteMsg = data.message?.conversation || data.message?.extendedTextMessage?.text || "";
  const remoteJid = data.key?.remoteJid;
  if (!clienteMsg || !remoteJid) return res.status(200).send('OK');

  try {
    // MEMORIA
    if (!memoria[remoteJid]) memoria[remoteJid] = [];
    memoria[remoteJid].push({ role: "user", content: clienteMsg });
    if (memoria[remoteJid].length > 10) memoria[remoteJid] = memoria[remoteJid].slice(-10);

    const masterPrompt = `Eres Fiorella, asesora de JRJMarket en Ecuador. 
    Habla como una amiga real por WhatsApp. Usa frases como "Te cuento algo", "La verdad...", "Chévere".
    TUS REGLAS:
    - No seas un robot. Fluye con la conversación naturalmente.
    - NUNCA repitas el saludo si ya lo diste antes. El historial está arriba.
    - Usa AIDA: detecta el dolor, genera deseo, cierra con pregunta de envío.
    - Máximo 3 líneas por mensaje. Usa negritas.
    - Siempre termina con una pregunta.
    INFO PRODUCTO: Vendes combo Aceite de Orégano más Colágeno. Combo $37.99 envío gratis. Solo Colágeno $25. Solo Orégano $18.50. Pago contra entrega.`;

    const respIA = await fetch('https://api.xai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROK_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: "grok-beta",
        messages: [
          { role: "system", content: masterPrompt },
          ...memoria[remoteJid]
        ]
      })
    });

    const resJson = await respIA.json();
    const textoIA = resJson.choices?.[0]?.message?.content || "¡Hola! Soy Fiorella, ¿en qué ciudad estás?";

    memoria[remoteJid].push({ role: "assistant", content: textoIA });

    const cleanUrl = EVOLUTION_URL.replace(/\/$/, "");
    await fetch(`${cleanUrl}/message/sendText/${INSTANCE_NAME.trim()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
      body: JSON.stringify({ number: remoteJid, text: textoIA, delay: 1200 })
    });

    return res.status(200).send('OK');
  } catch (error) {
    console.error("Error:", error.message);
    return res.status(200).send('OK');
  }
}
