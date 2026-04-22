// /api/whatsapp-webhook.js — MAESTRO v3.0 (Con memoria de conversación)
import fs from 'fs';
import path from 'path';

// Memoria temporal por número (persiste mientras Vercel no se reinicie)
const conversaciones = {};

export default async function handler(req, res) {
  const { EVOLUTION_URL, EVOLUTION_TOKEN, INSTANCE_NAME, GROK_API_KEY } = process.env;

  if (!req.body?.data?.message) return res.status(200).send('OK');
  const data = req.body.data;
  if (data.key?.fromMe) return res.status(200).send('OK');

  const clienteMsg = data.message?.conversation ||
                     data.message?.extendedTextMessage?.text || "";
  const remoteJid = data.key?.remoteJid;
  if (!clienteMsg || !remoteJid) return res.status(200).send('OK');

  try {
    // 1. CARGAR CATÁLOGO DE PRODUCTOS
    let catalogo = { PRODUCTOS: [] };
    try {
      const catalogoPath = path.join(process.cwd(), 'api', 'productos.json');
      catalogo = JSON.parse(fs.readFileSync(catalogoPath, 'utf8'));
    } catch (e) {
      console.error("No se pudo leer productos.json:", e.message);
    }

    // 2. DETECTAR PRODUCTO POR PALABRAS CLAVE
    const msgLower = clienteMsg.toLowerCase();
    const productoMatch = catalogo.PRODUCTOS.find(p =>
      p.keywords.some(k => msgLower.includes(k))
    ) || catalogo.PRODUCTOS[0];

    // 3. LEER FICHA TÉCNICA DEL PRODUCTO
    let fichaTecnica = "Somos JRJMarket, vendemos suplementos de salud en Ecuador.";
    if (productoMatch) {
      try {
        const filePath = path.join(process.cwd(), 'data', productoMatch.archivo);
        fichaTecnica = fs.readFileSync(filePath, 'utf8');
      } catch (e) {
        console.error("No se pudo leer ficha:", e.message);
      }
    }

    // 4. INICIALIZAR MEMORIA DEL CLIENTE
    if (!conversaciones[remoteJid]) {
      conversaciones[remoteJid] = [];
    }

    // Agregar mensaje del cliente al historial
    conversaciones[remoteJid].push({ role: "user", content: clienteMsg });

    // Mantener máximo 10 mensajes (5 intercambios)
    if (conversaciones[remoteJid].length > 10) {
      conversaciones[remoteJid] = conversaciones[remoteJid].slice(-10);
    }

    // 5. MASTER PROMPT — COMPORTAMIENTO COMPLETO DE FIORELLA
    const masterPrompt = `Eres Fiorella, asesora de ventas de JRJMarket en Ecuador. Eres una persona real, cálida y experta. NUNCA menciones que eres IA o bot.

PERSONALIDAD:
- Hablas como una amiga ecuatoriana de confianza: usas "chévere", "de ley", "te cuento algo", "la verdad es que..."
- Eres entusiasta pero nunca desesperada
- Generas confianza con autoridad natural, no con presión

METODOLOGÍA DE VENTA (AIDA + Neuroventas):
1. ATENCIÓN: Si es el primer mensaje, salúdate calurosamente. Preséntate UNA sola vez: "¡Hola! Qué gusto 😊 Soy Fiorella de JRJMarket. Dame un segundito que estamos a full con el lanzamiento, pero ya estoy contigo."
2. INTERÉS: Detecta el dolor del cliente. Usa técnica espejo: repite sus palabras. Si dice "me siento cansado", dile "recuperar esa energía".
3. DESEO: Magnifica el beneficio usando la ficha técnica. Habla de resultados reales: "Muchos clientes nos dicen que..."
4. ACCIÓN: Cierra siempre con pregunta de envío: "¿A qué ciudad te lo mandamos?" o "¿Te lo dejo apartado con el envío gratis de hoy?"

REGLAS CRÍTICAS:
- NUNCA repitas el saludo si ya lo diste — el historial de conversación está arriba
- NUNCA envíes párrafos largos — máximo 3 líneas por mensaje
- SIEMPRE termina con una pregunta que mueva la venta
- Si el cliente dice "no" o "está caro": NO insistas más de 2 veces. En el primer no, pregunta el motivo. En el segundo, ofrece el producto individual más barato
- Si el cliente no contesta algo, cambia el ángulo: usa escasez ("me quedan 3 combos con envío gratis") o testimonio ("ayer mismo una clienta de Guayaquil me dijo que ya siente la diferencia")
- Si quiere solo un producto del combo, véndelo sin problema — mejor venta parcial que ninguna
- Usa negritas para precios y beneficios clave

INFORMACIÓN TÉCNICA DEL PRODUCTO:
${fichaTecnica}`;

    // 6. LLAMADA A GROK CON HISTORIAL COMPLETO
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
          ...conversaciones[remoteJid]
        ]
      })
    });

    const resJson = await respIA.json();
    const textoIA = resJson.choices?.[0]?.message?.content;

    if (!textoIA) {
      console.error("Grok no devolvió texto:", JSON.stringify(resJson));
      return res.status(200).send('OK');
    }

    // Guardar respuesta de Fiorella en el historial
    conversaciones[remoteJid].push({ role: "assistant", content: textoIA });

    // 7. ENVIAR A WHATSAPP
    const cleanUrl = EVOLUTION_URL.replace(/\/$/, "");
    const waRes = await fetch(`${cleanUrl}/message/sendText/${INSTANCE_NAME.trim()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
      body: JSON.stringify({ number: remoteJid, text: textoIA, delay: 1500 })
    });

    const waJson = await waRes.json();
    console.log("WA response:", JSON.stringify(waJson));

    return res.status(200).send('OK');

  } catch (error) {
    console.error("Error crítico:", error.message);
    return res.status(200).send('OK');
  }
}
