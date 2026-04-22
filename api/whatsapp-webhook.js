// /api/whatsapp-webhook.js (v2.1 - Corrección de Errores)
export default async function handler(req, res) {
  const { 
    EVOLUTION_URL, EVOLUTION_TOKEN, INSTANCE_NAME, 
    OPENAI_API_KEY, GROK_API_KEY, GEMINI_API_KEY 
  } = process.env;

  const MOTOR_ACTIVO = "grok"; // Asegúrate de tener la KEY en Vercel

  // 1. Verificación de seguridad para evitar que el código se rompa
  if (!req.body || !req.body.data) {
    console.log("Cuerpo del mensaje vacío o mal formado");
    return res.status(200).send('OK');
  }

  const data = req.body.data;
  
  // Extraemos el mensaje de forma segura
  const clienteMsg = data.message?.conversation || 
                     data.message?.extendedTextMessage?.text || 
                     data.message?.imageMessage?.caption || "";
                     
  const remoteJid = data.key?.remoteJid;
  const fromMe = data.key?.fromMe;

  // Si no hay mensaje o es nuestro, ignoramos
  if (!clienteMsg || fromMe) return res.status(200).send('OK');

  const customerPhone = remoteJid.split('@')[0];

  try {
    const promptIA = `Eres el asistente de JRJMarket en Ecuador. Confirma pedidos de salud. Si dan referencia, di: "Pedido DESPACHADO". Sé breve y amable.`;

    let textoIA = "";

    // Lógica Grok
    const resp = await fetch('https://api.xai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROK_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: "grok-beta",
        messages: [{role: "system", content: promptIA}, {role: "user", content: clienteMsg}]
      })
    });
    
    const resData = await resp.json();
    textoIA = resData.choices?.[0]?.message?.content || "Lo siento, tuve un problema al pensar la respuesta.";

    // ENVIAR A WHATSAPP
    await fetch(`${EVOLUTION_URL}/message/sendText/${INSTANCE_NAME}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
      body: JSON.stringify({ number: customerPhone, text: textoIA, delay: 1000 })
    });

    // Lógica de Archivos
    if (textoIA.toLowerCase().includes("despachado")) {
        // Aquí puedes añadir el fetch de sendMedia si ya tienes los links
    }

    res.status(200).send('SUCCESS');
  } catch (error) {
    console.error('Error detallado:', error.message);
    res.status(200).send('OK');
  }
}
