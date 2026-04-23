// /api/cerebro-confirmar.js (El alma de la IA - Despacho & Postventa)
export default async function handler(request, response) {
  const { data } = request.body;
  if (!data.message || data.key.fromMe) return response.status(200).end();

  const customerPhone = data.key.remoteJid.replace(/\D/g, '');
  const customerMessage = (data.message.conversation || data.message.extendedTextMessage?.text || "").toLowerCase();

  // 1. RUTAS DE ARCHIVOS EN GITHUB (Asegúrate de que sean correctas)
  const GITHUB_BASE = "https://raw.githubusercontent.com/TU_USUARIO/TU_REPO/main";

  try {
    // 2. LEER CATÁLOGO Y PROMPT MAESTRO
    const [catRes, promptRes] = await Promise.all([
      fetch(`${GITHUB_BASE}/api/productos.json`),
      fetch(`${GITHUB_BASE}/prompt-maestro-despacho.json`)
    ]);

    const catalogo = await catRes.json();
    const promptMaestro = await promptRes.json();

    // 3. BUSCAR PRODUCTO PARA POSTVENTA (AQUÍ USA LA CARPETA DATA/)
    let infoProducto = "Información general de JRJMarket.";
    for (const p of catalogo.PRODUCTOS) {
      if (p.keywords.some(k => customerMessage.includes(k.toLowerCase()))) {
        const txtRes = await fetch(`${GITHUB_BASE}/data/${p.archivo}`);
        infoProducto = await txtRes.text();
        break;
      }
    }

    // 4. CONSTRUIR CONTEXTO PARA IA
    const fullPrompt = `
      ${JSON.stringify(promptMaestro)}
      
      CONOCIMIENTO TÉCNICO DEL PRODUCTO:
      ${infoProducto}
      
      MENSAJE DEL CLIENTE: "${customerMessage}"
    `;

    // 5. LLAMAR A TU IA (Implementar llamado a Gemini/GPT aquí)
    const respuestaIA = await llamarAI(fullPrompt);

    // 6. ENVIAR RESPUESTA
    await fetch(`${process.env.EVOLUTION_URL}/message/sendText/${process.env.INSTANCE_DESPACHO}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': process.env.TOKEN_DESPACHO },
      body: JSON.stringify({ number: customerPhone, text: respuestaIA })
    });

    return response.status(200).end();
  } catch (error) {
    return response.status(500).end();
  }
}

async function llamarAI(prompt) {
  // Aquí pones tu fetch a la API de Google Gemini o OpenAI
  // Debe devolver el texto persuasivo y humano.
  return "Respuesta procesada con el alma de Fiorella...";
}
