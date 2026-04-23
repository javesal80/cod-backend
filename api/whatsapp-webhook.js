import fs from 'fs';
import path from 'path';

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
  const instanceActual = req.body.instance || INSTANCE_NAME || "VitaeLAB";

  let baseConocimiento = "";
  try {
    const productosPath = path.join(process.cwd(), 'api', 'productos.json');
    const txtPath = path.join(process.cwd(), 'data', 'combo-regeneracion.txt');
    baseConocimiento = `INFO:\n${fs.readFileSync(productosPath, 'utf8')}\n${fs.readFileSync(txtPath, 'utf8')}`;
  } catch (e) { baseConocimiento = "Error de carga."; }

  const masterPrompt = `
  IDENTIDAD: Eres Fiorella de JRJMarket. Asesora de bienestar (Trato de USTED).

  ESTRATEGIA DE SUTILEZA:
  1. EL NOMBRE: No lo pida como requisito. Primero salude y valide que va a ayudar. 
     Ejemplo sutil: "...por cierto, ¿con quién tengo el gusto de hablar? Como para anotarlo en mi agenda de asesoría."
  2. INDAGACIÓN: Su prioridad es que el cliente confiese su dolor (cansancio, gastritis, etc.).
  3. CASCADA ESTÉTICA: Use saltos de línea tras cada signo de puntuación (. ! ? ...).
  4. EMOTICONS: Solo en el saludo y para resaltar salud (🌿, ✨, 😊).

  MANEJO DE OBJECIONES:
  - Local físico: Solo bodegas (Ambato/Quito) por seguridad nacional. 
  - Seguridad del cliente: Pago contra entrega (Servientrega, Laar, etc).
  - Beneficios: Envío gratis 1ra compra. -$2 transferencia/tarjeta.

  CONOCIMIENTO:
  ${baseConocimiento}

  CLIENTE: "${clienteMsg}"`;

  try {
    let textoFinal = "";

    // --- OBTENCIÓN DE RESPUESTA ---
    if (provider === 'grok') {
      const resp = await fetch('https://api.x.ai/v1/responses', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${GROK_API_KEY.trim()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: "grok-4.20-reasoning", input: masterPrompt })
      });
      const resJson = await resp.json();
      if (Array.isArray(resJson)) {
        textoFinal = resJson.find(i => i.type === "message")?.content?.[0]?.text;
      } else {
        const match = JSON.stringify(resJson).match(/"output_text","text":"([^"]+)"/);
        if (match) textoFinal = match[1].replace(/\\n/g, '\n');
      }
    } else {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${OPENAI_API_KEY.trim()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: "Eres Fiorella, sutil y empática." }, { role: "user", content: masterPrompt }]
        })
      });
      const json = await resp.json();
      textoFinal = json.choices?.[0]?.message?.content;
    }

    if (textoFinal) {
      // --- FORMATEO EN CASCADA AUTOMÁTICO ---
      let cascada = textoFinal
        .replace(/([.!?])\s+(?=[A-Z¿¡])/g, "$1\n") 
        .replace(/\.\.\.\s*/g, "...\n")           
        .split('\n').map(line => line.trim()).filter(line => line !== "").join('\n');

      const partes = cascada.split('\n');
      const saludo = partes[0]; 
      const resto = partes.slice(1).join('\n');

      // Globo 1: Saludo
      await fetch(`${baseUrl}/message/sendText/${instanceActual.trim()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
        body: JSON.stringify({ number: remoteJid, text: saludo })
      });

      // Globo 2: Resto del mensaje sutil
      if (resto) {
        await new Promise(r => setTimeout(r, 1200));
        await fetch(`${baseUrl}/message/sendText/${instanceActual.trim()}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
          body: JSON.stringify({ number: remoteJid, text: resto })
        });
      }
    }
    return res.status(200).send('OK');
  } catch (error) { return res.status(200).send('OK'); }
}
