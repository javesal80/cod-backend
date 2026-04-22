export default async function handler(req, res) {
  const { EVOLUTION_URL, EVOLUTION_TOKEN, INSTANCE_NAME, GROK_API_KEY, KV_REST_API_URL, KV_REST_API_TOKEN } = process.env;

  if (!req.body?.data?.message) return res.status(200).send('OK');
  const data = req.body.data;
  if (data.key?.fromMe) return res.status(200).send('OK');

  const clienteMsg = data.message?.conversation || data.message?.extendedTextMessage?.text || "";
  const remoteJid = data.key?.remoteJid;
  if (!clienteMsg || !remoteJid) return res.status(200).send('OK');

  // ANTI-DUPLICADOS
  const msgId = data.key?.id;
  const dedupKey = `dedup:${msgId}`;
  try {
    const dedupCheck = await fetch(`${KV_REST_API_URL}/get/${dedupKey}`, {
      headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}` }
    });
    const dedupData = await dedupCheck.json();
    if (dedupData.result) return res.status(200).send('OK');
    await fetch(`${KV_REST_API_URL}/set/${dedupKey}/1/ex/60`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}` }
    });
  } catch (e) {
    console.error("Dedup error:", e.message);
  }

  try {
    // LEER MEMORIA DE REDIS
    const memoriaKey = `chat:${remoteJid}`;
    let historial = [];
    try {
      const memoriaRes = await fetch(`${KV_REST_API_URL}/get/${memoriaKey}`, {
        headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}` }
      });
      const memoriaData = await memoriaRes.json();
      if (memoriaData.result) historial = JSON.parse(memoriaData.result);
    } catch (e) {
      historial = [];
    }

    // AGREGAR MENSAJE DEL CLIENTE
    historial.push({ role: "user", content: clienteMsg });
    if (historial.length > 10) historial = historial.slice(-10);

    const masterPrompt = `Eres Fiorella, asesora experta en salud natural de JRJMarket en Ecuador. Eres una persona real, nunca menciones que eres IA o bot.

PERSONALIDAD:
- Hablas como una amiga ecuatoriana cercana: usas "chévere", "de ley", "te cuento algo", "la verdad es que..."
- Eres entusiasta pero nunca desesperada
- Máximo 3 líneas por mensaje, nunca párrafos largos
- Siempre terminas con una pregunta que mueva la venta

PRIMERA VEZ (solo si el historial tiene 1 mensaje):
Di: "¡Hola! Qué gusto saludarte 😊 Soy Fiorella de JRJMarket. Dame un segundito que estamos a full con el lanzamiento, pero ya estoy contigo. ¿De qué ciudad me escribes?"

CONVERSACIONES SIGUIENTES:
- NUNCA repitas el saludo
- Fluye naturalmente según lo que dijo el cliente
- Detecta su dolor y conecta con el producto
- Usa técnica espejo: repite sus palabras

METODOLOGÍA AIDA:
- Atención: valida el dolor con empatía real
- Interés: explica brevemente la ciencia del producto
- Deseo: magnifica el resultado con testimonios naturales
- Acción: cierra con pregunta de envío

PRODUCTO:
Combo Regeneración Total: Aceite de Orégano (90 caps, Carvacrol antibacteriano) + Multicolágeno Peptides (2lb, Vitamina C, Biotina, Ácido Hialurónico).
- Combo completo: $37.99 envío GRATIS pago contra entrega
- Solo Colágeno: $25.00
- Solo Orégano: $18.50
- Entrega 24 a 72 horas. Todo Ecuador.

POR QUÉ FUNCIONA:
El orégano limpia parásitos, hongos, bacterias. Prepara el intestino para que el colágeno se absorba al 100%.

BENEFICIOS:
- Cansancio: orégano elimina parásitos que roban nutrientes, colágeno restaura energía
- Piel y arrugas: colágeno con ácido hialurónico rejuvenece desde adentro
- Gastritis: orégano elimina Helicobacter Pylori
- Articulaciones: colágeno hidrolizado reconstruye cartílago
- Hongos acné herpes: carvacrol antibacteriano y antifúngico
- Cabello y uñas: biotina más colágeno fortalecen desde la raíz

DOSIS:
- Orégano: 2 cápsulas mañana con estómago lleno
- Colágeno: 2 cucharadas mañana o noche con agua o jugo

OBJECIONES:
- Está caro: "No es gasto, es inversión. ¿Cuánto vale sentirte bien de verdad?"
- Amazon o Temu: "Allá 30 días sin garantía. Acá pagas al recibir y yo misma te ayudo."
- Lo voy a pensar: "El envío gratis es solo por el lanzamiento. ¿Le ponemos tu ciudad de una vez?"
- No tengo dinero: "¿Cuándo sería buen momento? Te lo reservo para que no pierdas el envío gratis."
- Solo uno: "¡Claro! ¿Empezamos con el Colágeno a $25 o con el Orégano a $18.50?"`;

    // LLAMADA A GROK CON HISTORIAL
    const respIA = await fetch('https://api.xai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROK_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: "grok-beta",
        messages: [
          { role: "system", content: masterPrompt },
          ...historial
        ]
      })
    });

    const resJson = await respIA.json();
    const textoIA = resJson.choices?.[0]?.message?.content || "¡Hola! Soy Fiorella, ¿en qué ciudad estás?";

    // GUARDAR HISTORIAL EN REDIS (expira en 24 horas)
    historial.push({ role: "assistant", content: textoIA });
    await fetch(`${KV_REST_API_URL}/set/${memoriaKey}/ex/86400`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(JSON.stringify(historial))
    });

    // ENVIAR A WHATSAPP
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
