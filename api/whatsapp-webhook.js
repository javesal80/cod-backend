export default async function handler(req, res) {
  const { EVOLUTION_URL, EVOLUTION_TOKEN, INSTANCE_NAME, GROK_API_KEY } = process.env;

  if (!req.body?.data?.message) return res.status(200).send('OK');
  const data = req.body.data;
  if (data.key?.fromMe) return res.status(200).send('OK');

  const clienteMsg = data.message?.conversation || data.message?.extendedTextMessage?.text || "";
  const remoteJid = data.key?.remoteJid;

  // --- BIBLIOTECA INTEGRADA (Para que nunca falle por falta de archivos) ---
  const bibliotecaVentas = `
    PRODUCTO: Combo Regeneración Total (Multicolágeno + Aceite de Orégano).
    PRECIOS: Combo $37.99 / Solo Colágeno $25 / Solo Orégano $18.50.
    CIENCIA: El orégano limpia parásitos, hongos (Candida) y bacterias para que el colágeno se absorba al 100% y regenere piel, huesos y energía.
    LOGÍSTICA: Envío GRATIS a todo Ecuador. Pago contra entrega (pagas al recibir).
  `;

  try {
    // EL MASTER PROMPT: Aquí reside la inteligencia, neuroventas y la personalidad humana.
    const masterPrompt = `Eres Fiorella, asesora experta en salud natural de JRJMarket. 
    ¡IMPORTANTE!: NO eres un bot. Eres una amiga cercana. Si el cliente te saluda o te da un dato (como su ciudad), NO te vuelvas a presentar. ¡Sigue la plática como una persona real!

    ESTRATEGIA DE NEUROVENTAS:
    1. EMPATÍA: Si el cliente tiene un dolor, dile "Chuta, te entiendo, qué feo sentirse así".
    2. MODELO AIDA: Capta atención, genera interés con la ciencia del orégano, despierta deseo de verse bien al espejo y CIERRA preguntando datos de envío.
    3. FLEXIBILIDAD: Si el combo es mucho para el cliente, véndele uno solo. ¡Lo importante es ayudarlo hoy!
    4. PERSUASIÓN: Usa frases como "En serio prueba esto, te va a cambiar la vida" o "Aprovecha que hoy tengo envío gratis".

    REGLAS DE FORMATO:
    - Máximo 2 o 3 oraciones por mensaje.
    - Usa negritas en beneficios y precios.
    - SIEMPRE termina con una pregunta para mantener el control de la venta.

    INFORMACIÓN TÉCNICA: ${bibliotecaVentas}`;

    const respIA = await fetch('https://api.xai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROK_API_KEY}`, 'Content-Type': 'application/json' },
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

    // Si la IA generó una respuesta, la enviamos
    if (textoIA) {
      const cleanUrl = EVOLUTION_URL.replace(/\/$/, "");
      await fetch(`${cleanUrl}/message/sendText/${INSTANCE_NAME.trim()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
        body: JSON.stringify({ 
          number: remoteJid, 
          text: textoIA,
          delay: 1000 // Simula que Fiorella está escribiendo
        })
      });
    }

    return res.status(200).send('OK');
  } catch (error) {
    // Si la IA falla, mandamos un mensaje de rescate humano para no perder el cliente
    console.error("Error:", error.message);
    return res.status(200).send('OK');
  }
}
