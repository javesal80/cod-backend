export default async function handler(req, res) {
  const { 
    EVOLUTION_URL, EVOLUTION_TOKEN, INSTANCE_NAME, 
    GROK_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY,
    IA_PROVIDER 
  } = process.env;

  if (!req.body?.data?.message) return res.status(200).send('OK');
  const data = req.body.data;
  if (data.key?.fromMe) return res.status(200).send('OK');

  const clienteMsg = (data.message?.conversation || data.message?.extendedTextMessage?.text || "Hola").trim();
  const remoteJid = data.key?.remoteJid;
  const baseUrl = EVOLUTION_URL.replace(/\/$/, "");
  const provider = (IA_PROVIDER || 'grok').trim().toLowerCase();

  // Instrucción para la IA
  const instra = "Eres Fiorella, asesora amable de JRJMarket en Ecuador. Sé breve.";

  try {
    let textoFinal = "";

    // --- BLOQUE GROK (LA ESENCIA) ---
    if (provider === 'grok') {
      const resp = await fetch('https://api.x.ai/v1/responses', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${GROK_API_KEY.trim()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: "grok-4.20-reasoning",
          input: `${instra}\nCliente: ${clienteMsg}`
        })
      });
      const resJson = await resp.json();
      
      // Extracción idéntica a tu código funcional
      if (Array.isArray(resJson)) {
        const mensajeObj = resJson.find(item => item.type === "message");
        if (mensajeObj && mensajeObj.content) textoFinal = mensajeObj.content[0].text;
      }
      if (!textoFinal) {
        const stringJson = JSON.stringify(resJson);
        const match = stringJson.match(/"output_text","text":"([^"]+)"/);
        if (match) {
          textoFinal = match[1].replace(/\\n/g, '\n').replace(/\\u[0-9a-fA-F]{4}/g, (m) => String.fromCharCode(parseInt(m.substr(2), 16)));
        }
      }
    }

    // --- BLOQUE OPENAI ---
    else if (provider === 'openai') {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${OPENAI_API_KEY.trim()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: instra }, { role: "user", content: clienteMsg }]
        })
      });
      const json = await resp.json();
      textoFinal = json.choices?.[0]?.message?.content;
    }

    // --- BLOQUE GOOGLE ---
    else if (provider === 'google') {
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GOOGLE_API_KEY.trim()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${instra}\nCliente: ${clienteMsg}` }] }]
        })
      });
      const json = await resp.json();
      textoFinal = json.candidates?.[0]?.content?.parts?.[0]?.text;
    }

    // --- ENVÍO FINAL (PARA TODAS) ---
    const mensajeAEnviar = textoFinal || "Error: La IA no respondió correctamente.";

    await fetch(`${baseUrl}/message/sendText/${INSTANCE_NAME.trim()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
      body: JSON.stringify({ number: remoteJid, text: mensajeAEnviar })
    });

    return res.status(200).send('OK');
  } catch (error) {
    return res.status(200).send('OK');
  }
}
