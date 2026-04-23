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

  // --- LECTURA DINÁMICA DE TU BASE DE DATOS ---
  let baseConocimiento = "";
  try {
    const productosPath = path.join(process.cwd(), 'api', 'productos.json');
    const txtPath = path.join(process.cwd(), 'data', 'combo-regeneracion.txt');
    
    const jsonProductos = fs.existsSync(productosPath) ? fs.readFileSync(productosPath, 'utf8') : "";
    const textoDetalles = fs.existsSync(txtPath) ? fs.readFileSync(txtPath, 'utf8') : "";
    
    baseConocimiento = `
      LISTA DE PRODUCTOS Y PALABRAS CLAVE:
      ${jsonProductos}
      
      INFORMACIÓN DETALLADA PARA PERSUASIÓN:
      ${textoDetalles}
    `;
  } catch (err) {
    console.error("Error al leer archivos de conocimiento");
  }

  // --- MASTER PROMPT: FIORELLA NEUROVENDEDORA ---
  const masterPrompt = `Eres Fiorella, la vendedora estrella de JRJMarket en Ecuador. 
  Tu especialidad son las Neuroventas y el cierre con el modelo AIDA.

  CONTEXTO DE PRODUCTOS:
  ${baseConocimiento}

  INSTRUCCIONES DE RESPUESTA:
  1. Identifica qué producto busca el cliente mediante las palabras clave del JSON.
  2. Usa la información del archivo TXT para dar beneficios (no solo características).
  3. Aplica NEUROVENTAS: Habla a la "supervivencia" y "bienestar".
  4. TONO: Muy ecuatoriana, amable y profesional.
  5. CIERRE: Siempre termina con una pregunta tipo: "¿A qué parte de Quito te lo enviamos?" o "¿Te gustaría aprovechar el envío gratis hoy?".
  
  MENSAJE DEL CLIENTE: "${clienteMsg}"`;

  try {
    let textoFinal = "";

    // --- BLOQUE GROK (LA ESENCIA QUE FUNCIONA) ---
    if (provider === 'grok') {
      const resp = await fetch('https://api.x.ai/v1/responses', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${GROK_API_KEY.trim()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: "grok-4.20-reasoning", input: masterPrompt })
      });
      const resJson = await resp.json();
      
      if (Array.isArray(resJson)) {
        const msg = resJson.find(i => i.type === "message");
        textoFinal = msg?.content?.[0]?.text;
      }
      if (!textoFinal) {
        const match = JSON.stringify(resJson).match(/"output_text","text":"([^"]+)"/);
        if (match) textoFinal = match[1].replace(/\\n/g, '\n');
      }
    }

    // --- BLOQUE OPENAI ---
    else if (provider === 'openai') {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${OPENAI_API_KEY.trim()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: "Eres Fiorella, experta en cierres de ventas y AIDA." },
            { role: "user", content: masterPrompt }
          ]
        })
      });
      const json = await resp.json();
      textoFinal = json.choices?.[0]?.message?.content;
    }

    // --- BLOQUE GOOGLE ---
    else if (provider === 'google') {
      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GOOGLE_API_KEY.trim()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: masterPrompt }] }] })
      });
      const json = await resp.json();
      textoFinal = json.candidates?.[0]?.content?.parts?.[0]?.text;
    }

    // --- ENVÍO A WHATSAPP ---
    if (textoFinal) {
      await fetch(`${baseUrl}/message/sendText/${INSTANCE_NAME.trim()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
        body: JSON.stringify({ number: remoteJid, text: textoFinal.trim() })
      });
    }

    return res.status(200).send('OK');
  } catch (error) {
    return res.status(200).send('OK');
  }
}
