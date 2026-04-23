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
    baseConocimiento = `INFO PRODUCTOS:\n${fs.readFileSync(productosPath, 'utf8')}\n${fs.readFileSync(txtPath, 'utf8')}`;
  } catch (e) { baseConocimiento = "Error de carga."; }

  const masterPrompt = `
  IDENTIDAD: Eres Fiorella de JRJMarket. Asesora de bienestar, amable y formal (Trato de USTED).

  REGLAS DE FORMATO (ESTRICTO):
  - TODO EL TEXTO DEBE IR EN UN MÁXIMO DE 2 MENSAJES (Globos de texto).
  - Use saltos de línea (Enter) para separar ideas dentro del mismo mensaje.
  - Use puntos suspensivos (...) para crear una pausa natural.
  - Ejemplo de estructura deseada:
    "Espero que se encuentre muy bien... ¿En qué puedo ayudarle hoy?
    ¿Hay algo específico que le preocupa de su salud?
    Estoy aquí para ayudarle..."

  ESTRATEGIA DE VENTA:
  1. INDAGACIÓN: Si saludan, responda con calidez. No dé el precio sin preguntar por el dolor del cliente.
  2. EMPATÍA: "Le comprendo perfectamente...". Use la información técnica para educar brevemente.
  3. SEGURIDAD: Local físico solo bodegas en Ambato/Quito (seguridad). Pago contra entrega para su confianza.
  4. OFERTA: Envío GRATIS primera compra. -$2 de descuento por transferencia/tarjeta.

  CONOCIMIENTO:
  ${baseConocimiento}

  CLIENTE DICE: "${clienteMsg}"`;

  try {
    let textoFinal = "";

    if (provider === 'grok') {
      const resp = await fetch('https://api.x.ai/v1/responses', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${GROK_API_KEY.trim()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: "grok-4.20-reasoning", input: masterPrompt })
      });
      const resJson = await resp.json();
      if (Array.isArray(resJson)) {
        textoFinal = resJson.find(i => i.type === "message")?.content?.[0]?.text;
      }
      if (!textoFinal) {
        const match = JSON.stringify(resJson).match(/"output_text","text":"([^"]+)"/);
        if (match) textoFinal = match[1].replace(/\\n/g, '\n');
      }
    } else {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${OPENAI_API_KEY.trim()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: "Eres Fiorella, asesora humana y estética." }, { role: "user", content: masterPrompt }]
        })
      });
      const json = await resp.json();
      textoFinal = json.choices?.[0]?.message?.content;
    }

    if (textoFinal) {
      // --- ENVÍO EN MÁXIMO 2 MENSAJES ---
      // Separamos solo si la IA generó una división muy marcada, si no, enviamos todo junto.
      const parrafos = textoFinal.split('\n\n').filter(p => p.trim() !== "");
      
      if (parrafos.length > 1) {
        // Mensaje 1 (Saludo/Introducción)
        await fetch(`${baseUrl}/message/sendText/${instanceActual.trim()}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
          body: JSON.stringify({ number: remoteJid, text: parrafos[0].trim() })
        });
        
        // Mensaje 2 (Cuerpo/Preguntas con sus propios saltos internos)
        const restoTexto = parrafos.slice(1).join('\n\n');
        if (restoTexto) {
          await new Promise(res => setTimeout(res, 1200));
          await fetch(`${baseUrl}/message/sendText/${instanceActual.trim()}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
            body: JSON.stringify({ number: remoteJid, text: restoTexto.trim() })
          });
        }
      } else {
        // Si es un solo bloque, se envía tal cual
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
