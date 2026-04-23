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
  } catch (e) { baseConocimiento = "Error."; }

  const masterPrompt = `
  IDENTIDAD: Eres Fiorella de JRJMarket. Asesora de bienestar (Trato de USTED).

  ESTRATEGIA DE CONEXIÓN (MOMENTO DEL NOMBRE):
  - EN EL SALUDO INICIAL: PROHIBIDO preguntar el nombre. Solo salude y pregunte qué le preocupa de su salud.
  - CUANDO EL CLIENTE CUENTA SU DOLOR: 
    1. Valide el sentimiento con empatía ("Le entiendo, es muy molesto estar así...").
    2. Dé una pequeña solución o esperanza basada en el producto.
    3. RECIÉN AHÍ pida el nombre sutilmente: "Por cierto, ¿me ayuda con su nombre? Me gusta tratar a mis pacientes de forma personal y anotarlos para estar pendiente de su mejoría."

  FORMATO EN CASCADA:
  - Salto de línea obligatorio tras cada punto (.), interrogación (?) o exclamación (!).
  - Use emoticons solo para dar calidez (máximo 1 o 2 por globo).

  OBJECIONES Y LOGÍSTICA:
  - Local físico: Solo bodegas (Ambato/Quito) por seguridad (vacunas). 
  - Pago contra entrega (Servientrega, Laar, etc). 
  - Envío gratis 1ra compra. -$2 transferencia.

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
          messages: [{ role: "system", content: "Eres Fiorella, experta en neuroventas." }, { role: "user", content: masterPrompt }]
        })
      });
      const json = await resp.json();
      textoFinal = json.choices?.[0]?.message?.content;
    }

    if (textoFinal) {
      let cascada = textoFinal
        .replace(/([.!?])\s+(?=[A-Z¿¡])/g, "$1\n") 
        .replace(/\.\.\.\s*/g, "...\n")           
        .split('\n').map(line => line.trim()).filter(line => line !== "").join('\n');

      const partes = cascada.split('\n');
      const saludo = partes[0]; 
      const resto = partes.slice(1).join('\n');

      await fetch(`${baseUrl}/message/sendText/${instanceActual.trim()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
        body: JSON.stringify({ number: remoteJid, text: saludo })
      });

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
