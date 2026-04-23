// /api/ai-despacho.js (El motor que lee el Prompt y el TXT)
export default async function handler(request, response) {
  if (request.method !== 'POST') return response.status(405).end();

  const { data } = request.body; // Datos que envía Evolution API
  if (!data.message || data.key.fromMe) return response.status(200).end();

  const customerPhone = data.key.remoteJid.replace(/\D/g, '');
  const customerMessage = data.message.conversation || data.message.extendedTextMessage?.text;

  // 1. LLAMAMOS AL "LIBRO" (TXT y Prompt Maestro desde GitHub)
  const GITHUB_RAW_URL = "https://raw.githubusercontent.com/TU_USUARIO/TU_REPO/main";
  
  try {
    const [promptRes, productosRes] = await Promise.all([
      fetch(`${GITHUB_RAW_URL}/prompt-maestro-despacho.json`),
      fetch(`${GITHUB_RAW_URL}/productos.txt`)
    ]);

    const promptMaestro = await promptRes.json();
    const infoProductos = await productosRes.text();

    // 2. CONFIGURAMOS LA IA (Gemini o GPT)
    // Aquí le enviamos las reglas del JSON y la info del TXT
    const promptFinal = `
      ${JSON.stringify(promptMaestro)}
      
      INFORMACIÓN TÉCNICA DE PRODUCTOS:
      ${infoProductos}
      
      MENSAJE DEL CLIENTE: ${customerMessage}
      (Recuerda mirar el historial para saber qué compró y ser persuasivo con Servientrega).
    `;

    // 3. ENVIAMOS A LA IA Y LUEGO EL RESULTADO A WHATSAPP
    // (Aquí iría tu llamado a la API de Google Gemini o OpenAI)
    const respuestaIA = await llamarIA(promptFinal); 

    await fetch(`${process.env.EVOLUTION_URL}/message/sendText/${process.env.INSTANCE_DESPACHO}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': process.env.TOKEN_DESPACHO },
      body: JSON.stringify({ number: customerPhone, text: respuestaIA })
    });

    return response.status(200).json({ success: true });

  } catch (error) {
    console.error("Error en el cerebro de despacho:", error);
    return response.status(500).end();
  }
}

// Función genérica para conectar con la IA
async function llamarIA(prompt) {
  // Aquí pones tu lógica de Gemini/OpenAI
  // Retorna el texto humanizado, persuasivo y validado.
  return "Respuesta generada por la IA basándose en el Prompt Maestro...";
}
