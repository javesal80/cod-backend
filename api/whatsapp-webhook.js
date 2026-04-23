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
  IDENTIDAD: Eres Fiorella de JRJMarket. Asesora de bienestar, amable y formal (Trato de USTED).

  REGLAS DE ESTRUCTURA (OBLIGATORIO):
  - Responda siempre en DOS mensajes (dos globos de texto).
  
  MENSAJE 1: Un saludo corto y cálido. 
  Ejemplo: "¡Hola! 😊 Es un placer atenderle."

  MENSAJE 2: El cuerpo de la asesoría. NO amontone las frases. Use un salto de línea (Enter) para cada idea.
  Debe verse exactamente así:
  "Espero que se encuentre muy bien... ¿En qué puedo ayudarle hoy?
  ¿Hay algo específico que le preocupa de su salud?
  Estoy aquí para ayudarle..."

  ESTRATEGIA: Indague el dolor antes de dar precios. Seguridad por bodegas en Ambato/Quito. Pago contra entrega.

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
          messages: [{ role: "system", content: "Eres Fiorella, asesora experta en salud." }, { role: "user", content: masterPrompt }]
        })
      });
      const json = await resp.json();
      textoFinal = json.choices?.[0]?.message?.content;
    }

    if (textoFinal) {
      // --- LÓGICA DE DIVISIÓN EN 2 GLOBOS ---
      // Buscamos el primer salto de línea doble o el primer punto y aparte para separar el saludo del resto
      const partes = textoFinal.split('\n\n').filter(p => p.trim() !== "");
      
      if (partes.length >= 2) {
        // Enviar Saludo (Mensaje 1)
        await fetch(`${baseUrl}/message/sendText/${instanceActual.trim()}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
          body: JSON.stringify({ number: remoteJid, text: partes[0].trim() })
        });

        await new Promise(r => setTimeout(r, 1000));

        // Enviar Cuerpo (Mensaje 2 - Con todas las líneas internas)
        const cuerpo = partes.slice(1).join('\n').trim();
        await fetch(`${baseUrl}/message/sendText/${instanceActual.trim()}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
          body: JSON.stringify({ number: remoteJid, text: cuerpo })
        });
      } else {
        // Si la IA mandó un solo bloque, lo mandamos tal cual
        await fetch(`${baseUrl}/message/sendText/${instanceActual.trim()}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
          body: JSON.stringify({ number: remoteJid, text: textoFinal.trim() })
        });
      }
    }
    return res.status(200).send('OK');
  } catch (error) { return res.status(200).send('OK'); }
}
