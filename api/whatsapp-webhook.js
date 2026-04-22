export default async function handler(req, res) {
  const { 
    EVOLUTION_URL, EVOLUTION_TOKEN, INSTANCE_NAME, 
    GROK_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY,
    IA_PROVIDER // 'grok', 'openai' o 'google'
  } = process.env;

  if (!req.body?.data?.message) return res.status(200).send('OK');
  const data = req.body.data;
  if (data.key?.fromMe) return res.status(200).send('OK');

  const clienteMsg = (data.message?.conversation || data.message?.extendedTextMessage?.text || "Hola").trim();
  const remoteJid = data.key?.remoteJid;
  const baseUrl = EVOLUTION_URL.replace(/\/$/, "");

  const systemPrompt = "Eres Fiorella, asesora de JRJMarket en Ecuador. Sé amable y breve.";

  try {
    let textoFinal = "";

    // --- SELECTOR DE IA ---
    if (IA_PROVIDER === 'grok') {
      const resp = await fetch('https://api.x.ai/v1/responses', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${GROK_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: "grok-4.20-reasoning", input: `${systemPrompt}\nCliente: ${clienteMsg}` })
      });
      const json = await resp.json();
      textoFinal = json[1]?.content?.[0]?.text || json.output;

    } else if (IA_PROVIDER === 'openai') {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: systemPrompt }, { role: "user", content: clienteMsg }]
        })
      });
      const json = await resp.json();
      textoFinal = json.choices[0].message.content;

    } else if (IA_PROVIDER === 'google') {
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GOOGLE_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${systemPrompt}\nCliente: ${clienteMsg}` }] }]
        })
      });
      const json = await resp.json();
      textoFinal = json.candidates[0].content.parts[0].text;
    }

    // --- ENVÍO A WHATSAPP ---
    if (textoFinal) {
      await fetch(`${baseUrl}/message/sendText/${INSTANCE_NAME.trim()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
        body: JSON.stringify({ number: remoteJid, text: textoFinal.trim() })
      });
    }

    return res.status(200).send('OK');
  } catch (error) {
    console.error("Error en el selector:", error.message);
    return res.status(200).send('OK');
  }
}
