import fs from 'fs';
import path from 'path';
import catalogo from './productos.json';

// Objeto simple para guardar la memoria temporal (en producción se recomienda base de datos)
const memoriaTemporal = {}; 

export default async function handler(req, res) {
  const { EVOLUTION_URL, EVOLUTION_TOKEN, INSTANCE_NAME, GROK_API_KEY } = process.env;

  if (!req.body?.data?.message) return res.status(200).send('OK');
  const data = req.body.data;
  if (data.key?.fromMe) return res.status(200).send('OK');

  const clienteMsg = data.message?.conversation || data.message?.extendedTextMessage?.text || "";
  const remoteJid = data.key?.remoteJid;

  try {
    // 1. GESTIÓN DE MEMORIA (Para no repetir el saludo)
    if (!memoriaTemporal[remoteJid]) memoriaTemporal[remoteJid] = [];
    memoriaTemporal[remoteJid].push({ role: "user", content: clienteMsg });

    // Mantener solo los últimos 6 mensajes para no saturar
    if (memoriaTemporal[remoteJid].length > 6) memoriaTemporal[remoteJid].shift();

    // 2. BUSCAR FICHA TÉCNICA
    const productoMatch = catalogo.PRODUCTOS.find(p => 
      p.keywords.some(k => clienteMsg.toLowerCase().includes(k))
    ) || catalogo.PRODUCTOS[0];

    const filePath = path.join(process.cwd(), 'data', productoMatch.archivo);
    const fichaTecnica = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : "";

    // 3. MASTER PROMPT (Neuroventas y Comportamiento Humano)
    const masterPrompt = {
      role: "system",
      content: `Eres Fiorella de JRJMarket. NO eres una IA, eres una asesora humana y cercana.
      
      REGLAS DE HUMANIDAD:
      - Si el cliente ya te saludó o ya te dijo de dónde es, NO te vuelvas a presentar. Continúa la charla.
      - Habla fluido, como una amiga ("Qué chévere que seas de Quito", "Te cuento que hoy estamos a full").
      - Usa neuroventas: detecta el dolor y recomienda el producto de la biblioteca.
      
      ESTRATEGIA AIDA:
      - Atención: Valida lo que dice.
      - Interés/Deseo: Usa la info de la biblioteca para persuadir.
      - Acción: Cierra siempre con pregunta de venta.
      
      BIBLIOTECA DEL PRODUCTO:
      ${fichaTecnica}`
    };

    // 4. LLAMADA A LA IA CON HISTORIAL
    const respIA = await fetch('https://api.xai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROK_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: "grok-beta",
        messages: [masterPrompt, ...memoriaTemporal[remoteJid]]
      })
    });

    const resJson = await respIA.json();
    const textoIA = resJson.choices?.[0]?.message?.content || "¡Chuta! Se me cortó la señal, ¿qué me decías?";

    // Guardar respuesta en memoria
    memoriaTemporal[remoteJid].push({ role: "assistant", content: textoIA });

    // 5. ENVÍO A WHATSAPP
    const cleanUrl = EVOLUTION_URL.replace(/\/$/, "");
    await fetch(`${cleanUrl}/message/sendText/${INSTANCE_NAME.trim()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
      body: JSON.stringify({ number: remoteJid, text: textoIA, delay: 1500 })
    });

    return res.status(200).send('OK');
  } catch (error) {
    return res.status(200).send('OK');
  }
}
