import fs from 'fs';
import path from 'path';
import catalogo from './productos.json';

export default async function handler(req, res) {
  const { EVOLUTION_URL, EVOLUTION_TOKEN, INSTANCE_NAME, GROK_API_KEY } = process.env;

  if (!req.body?.data?.message) return res.status(200).send('OK');
  const data = req.body.data;
  if (data.key?.fromMe) return res.status(200).send('OK');

  const clienteMsg = (data.message?.conversation || data.message?.extendedTextMessage?.text || "").toLowerCase();
  const remoteJid = data.key?.remoteJid;

  try {
    // 1. BUSCAR ARCHIVO DE PRODUCTO
    const productoMatch = catalogo.PRODUCTOS.find(p => 
      p.keywords.some(k => clienteMsg.includes(k))
    ) || catalogo.PRODUCTOS[0];

    const filePath = path.join(process.cwd(), 'data', productoMatch.archivo);
    const fichaTecnica = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : "";

    // 2. EL MASTER PROMPT (NEUROVENTAS + COMPORTAMIENTO)
    const masterPrompt = `
    Eres Fiorella, asesora experta en salud natural de JRJMarket. NO eres un bot, eres una amiga cercana y experta vendedora ecuatoriana.
    
    COMPORTAMIENTO HUMANO:
    - Saluda siempre con calidez: "¡Hola! Qué gusto saludarte, soy Fiorella de JRJMarket 🌿".
    - Genera urgencia: "Dame un momentito porfa, que estamos a full por el lanzamiento, pero ya estoy contigo".
    - Usa técnica espejo: valida el dolor del cliente con empatía ("Chuta, te entiendo perfectamente...").
    
    LOGICA DE VENTA (AIDA + NEUROVENTAS):
    - Presenta el producto como la SOLUCIÓN al dolor que el cliente expresó.
    - Si el cliente deja de contestar o duda: "Oye, ¿sigues ahí? No quisiera que te quedes fuera porque me quedan poquísimos con envío gratis. ¿Te reservo uno?".
    - FLEXIBILIDAD: Si el combo es caro, ofrece el producto individual de inmediato.
    - REGLA DE ORO: Máximo 3 oraciones por mensaje. Usa negritas. Siempre termina con una PREGUNTA de cierre (¿A qué ciudad enviamos?, ¿Te anoto el combo?).
    
    INFORMACIÓN DEL PRODUCTO PARA ESTA VENTA:
    ${fichaTecnica}
    `;

    const respIA = await fetch('https://api.xai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROK_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: "grok-beta",
        messages: [{ role: "system", content: masterPrompt }, { role: "user", content: clienteMsg }]
      })
    });

    const resJson = await respIA.json();
    const textoIA = resJson.choices?.[0]?.message?.content || "¡Hola! Soy Fiorella. Dame un segundito que estoy con muchos clientes, ¿en qué ciudad estás?";

    // 3. ENVÍO A WHATSAPP
    const cleanUrl = EVOLUTION_URL.replace(/\/$/, "");
    await fetch(`${cleanUrl}/message/sendText/${INSTANCE_NAME.trim()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
      body: JSON.stringify({ 
        number: remoteJid, 
        text: textoIA,
        delay: 2000 
      })
    });

    return res.status(200).send('OK');
  } catch (error) {
    console.error('Error:', error.message);
    return res.status(200).send('OK');
  }
}
