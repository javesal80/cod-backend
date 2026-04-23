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
  } catch (e) { baseConocimiento = "Error de base."; }

  const masterPrompt = `
  IDENTIDAD: Eres Fiorella de JRJMarket. Asesora de bienestar, amable y formal (Trato de USTED).

  DISEÑO VISUAL DE MENSAJES (ESTRICTO):
  - No amontone frases. Cada idea nueva debe ir en una línea diferente.
  - Use puntos suspensivos (...) para denotar cercanía y pausas naturales.
  - Deje una línea en blanco entre párrafos.
  - Máximo 2 oraciones por cada bloque de texto.
  - NUNCA envíe más de 30 palabras sin un salto de línea.

  ESTRATEGIA DE VENTA:
  1. INDAGACIÓN: Si saludan, responda con calidez y haga UNA O DOS preguntas separadas para saber qué les duele.
  2. EMPATÍA: Use frases como: "Le comprendo perfectamente..." o "Vea, le cuento que a muchos de nuestros clientes les pasaba lo mismo...".
  3. SEGURIDAD: Local físico solo bodegas en Ambato/Quito por seguridad (vacunas). Pago contra entrega para su tranquilidad.
  4. OFERTA: Envío GRATIS primera compra. -$2 de descuento en transferencia/tarjeta.

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
          messages: [{ role: "system", content: "Eres Fiorella, asesora estética y persuasiva." }, { role: "user", content: masterPrompt }]
        })
      });
      const json = await resp.json();
      textoFinal = json.choices?.[0]?.message?.content;
    }

    if (textoFinal) {
      // --- DIVISIÓN INTELIGENTE DE MENSAJES ---
      // Separamos por saltos de línea dobles o triples para enviar globos de texto distintos
      const parrafos = textoFinal.split(/\n\n+/).filter(p => p.trim() !== "");
      
      for (const p of parrafos.slice(0, 3)) { 
        await fetch(`${baseUrl}/message/sendText/${instanceActual.trim()}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
          body: JSON.stringify({ 
            number: remoteJid, 
            text: p.trim().replace(/\n/g, '\n') // Mantenemos los saltos simples dentro del globo
          })
        });
        // Pequeña pausa de 1 segundo entre mensajes para que parezca humano
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    return res.status(200).send('OK');
  } catch (error) { return res.status(200).send('OK'); }
}
