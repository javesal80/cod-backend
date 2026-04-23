import fs from 'fs';
import path from 'path';

export default async function handler(req, res) {
  // Solo respondemos a mensajes POST
  if (req.method !== 'POST') return res.status(200).send('OK');

  const { 
    EVOLUTION_URL, EVOLUTION_TOKEN, INSTANCE_NAME, 
    GROK_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY,
    IA_PROVIDER 
  } = process.env;

  // Evitar bucles y mensajes vacíos
  if (!req.body?.data?.message || req.body.data.key?.fromMe) {
    return res.status(200).send('OK');
  }

  const data = req.body.data;
  const clienteMsg = (data.message?.conversation || data.message?.extendedTextMessage?.text || "Hola").trim();
  const remoteJid = data.key?.remoteJid;
  const baseUrl = EVOLUTION_URL?.replace(/\/$/, "");
  const provider = (IA_PROVIDER || 'grok').trim().toLowerCase();
  const instName = req.body.instance || INSTANCE_NAME || "VitaeLAB";

  // --- LECTURA DE ARCHIVOS CON RUTA ABSOLUTA ---
  let baseConocimiento = "";
  try {
    const rootDir = process.cwd();
    const productosPath = path.join(rootDir, 'api', 'productos.json');
    // Probamos primero en 'data' y luego en 'api' según tu imagen
    let txtPath = path.join(rootDir, 'data', 'combo-regeneracion.txt');
    if (!fs.existsSync(txtPath)) {
      txtPath = path.join(rootDir, 'api', 'combo-regeneracion.txt');
    }
    
    const jsonProd = fs.existsSync(productosPath) ? fs.readFileSync(productosPath, 'utf8') : "";
    const txtInfo = fs.existsSync(txtPath) ? fs.readFileSync(txtPath, 'utf8') : "";
    baseConocimiento = `PRODUCTOS:\n${jsonProd}\n\nDETALLES:\n${txtInfo}`;
  } catch (e) {
    console.error("Error leyendo archivos:", e);
  }

  const masterPrompt = `
  Eres Fiorella de JRJMarket. Asesora de bienestar (Trato de USTED).
  
  ESTILO:
  1. Saludo fijo: "¡Hola! 😊 Es un placer atenderle."
  2. Pregunte el dolor antes de pedir el nombre.
  3. Tras el dolor, empatice y pida el nombre sutilmente para su "agenda de pacientes".
  4. Use formato CASCADA: Nueva línea tras cada punto (.), interrogación (?) o exclamación (!).

  LOGÍSTICA: Bodegas Ambato/Quito. Pago contra entrega. Envío gratis 1ra compra.
  INFO PRODUCTO:
  ${baseConocimiento}

  CLIENTE: "${clienteMsg}"`;

  try {
    let textoFinal = "";

    // --- LLAMADA A IA ---
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
        textoFinal = resJson.choices?.[0]?.message?.content || "";
      }
    } else {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${OPENAI_API_KEY.trim()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: "Eres Fiorella." }, { role: "user", content: masterPrompt }]
        })
      });
      const json = await resp.json();
      textoFinal = json.choices?.[0]?.message?.content;
    }

    if (textoFinal) {
      // Formateo Cascada
      let cascada = textoFinal
        .replace(/([.!?])\s+(?=[A-Z¿¡])/g, "$1\n") 
        .replace(/\.\.\.\s*/g, "...\n")
        .split('\n').map(line => line.trim()).filter(l => l !== "").join('\n');

      const partes = cascada.split('\n');
      const saludo = partes[0];
      const resto = partes.slice(1).join('\n');

      // Envío Mensaje 1
      await fetch(`${baseUrl}/message/sendText/${instName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
        body: JSON.stringify({ number: remoteJid, text: saludo })
      });

      if (resto) {
        await new Promise(r => setTimeout(r, 1200));
        await fetch(`${baseUrl}/message/sendText/${instName}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
          body: JSON.stringify({ number: remoteJid, text: resto })
        });
      }
    }
  } catch (error) {
    console.error("Error en proceso:", error);
  }

  return res.status(200).send('OK');
}
