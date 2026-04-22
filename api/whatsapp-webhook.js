export default async function handler(req, res) {
  const { EVOLUTION_URL, EVOLUTION_TOKEN, INSTANCE_NAME, GROK_API_KEY } = process.env;

  // 1. Filtros de seguridad para no responder mensajes vacíos o del propio bot
  if (!req.body?.data?.message) return res.status(200).send('OK');
  const data = req.body.data;
  if (data.key?.fromMe) return res.status(200).send('OK');

  const clienteMsg = (data.message?.conversation || data.message?.extendedTextMessage?.text || "").trim();
  const remoteJid = data.key?.remoteJid;

  try {
    // 2. EL CEREBRO DE FIORELLA (Prompt Anti-Robot sin depender de archivos)
    const masterPrompt = `Eres Fiorella, asesora experta de JRJMarket en Ecuador. Vendes un Combo Regeneración (Aceite de Orégano + Multicolágeno) a $37.99. Individuales: Colágeno $25, Orégano $18.50. Envío gratis, pago contra entrega. Beneficios: El orégano limpia bacterias (Helicobacter/Candida) para que el colágeno regenere piel, huesos y energía.

    REGLA ANTI-ROBOT ESTRICTA (DE VIDA O MUERTE):
    Como no tienes el historial de chat, debes ADIVINAR el contexto según lo que diga el cliente:
    - Si el cliente dice "Hola", "Buenas": Preséntate cálidamente ("¡Hola! Soy Fiorella...").
    - Si el cliente responde SOLO una ciudad (ej. "Quito", "Guayaquil"): ASUME que ya te presentaste y le preguntaste dónde vive. NO digas "Hola soy Fiorella". Responde: "¡Qué chévere [Ciudad]! Para allá enviamos full combos. Cuéntame, ¿qué dolores te molestan para asesorarte bien?".
    - Si el cliente dice SOLO un producto (ej. "Orégano"): ASUME que ya están conversando. Dile: "¡Excelente elección! El orégano es buenísimo para... ¿Te lo envío solo o con el combo?".
    - Si el cliente dice "Nada gracias": Despídete amablemente y déjale la puerta abierta.

    ESTILO: Sé empática, humana, usa "chuta", "chévere", "te cuento". 
    MÉTODO AIDA: Valida el dolor y da la solución. 
    CIERRE: Termina SIEMPRE con una pregunta corta para mantener el control. NO envíes párrafos largos (máximo 3 líneas).`;

    // 3. Conexión con la IA de Grok
    const respIA = await fetch('https://api.xai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${GROK_API_KEY}`, 
        'Content-Type': 'application/json' 
      },
      body: JSON.stringify({
        model: "grok-beta",
        messages: [
          { role: "system", content: masterPrompt },
          { role: "user", content: clienteMsg }
        ]
      })
    });

    const resJson = await respIA.json();
    const textoIA = resJson.choices?.[0]?.message?.content;

    // 4. Envío de respuesta a WhatsApp
    if (textoIA) {
      const baseUrl = EVOLUTION_URL.replace(/\/$/, "");
      await fetch(`${baseUrl}/message/sendText/${INSTANCE_NAME.trim()}`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json', 
          'apikey': EVOLUTION_TOKEN 
        },
        body: JSON.stringify({ 
          number: remoteJid, 
          text: textoIA, 
          delay: 1500 // Pequeña pausa para que se vea más humano
        })
      });
    }

    return res.status(200).send('OK');
  } catch (error) {
    console.error("Error en Webhook:", error);
    // Retornamos 200 OK siempre para que Evolution API no se trabe
    return res.status(200).send('OK');
  }
}
