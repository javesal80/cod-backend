const fs = require('fs');
const path = require('path');

const historialConversacion = {};

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(200).send('OK');

  const { EVOLUTION_URL, EVOLUTION_TOKEN, INSTANCE_NAME, OPENAI_API_KEY } = process.env;

  if (!req.body?.data?.message || req.body.data.key?.fromMe) {
    return res.status(200).send('OK');
  }

  const data = req.body.data;
  const clienteMsg = (data.message?.conversation || data.message?.extendedTextMessage?.text || "").trim();
  const remoteJid = data.key?.remoteJid;
  const baseUrl = EVOLUTION_URL?.replace(/\/$/, "");
  const instName = req.body.instance || INSTANCE_NAME || "VitaeLAB";

  if (!historialConversacion[remoteJid]) historialConversacion[remoteJid] = [];
  historialConversacion[remoteJid].push({ role: "user", content: clienteMsg });
  if (historialConversacion[remoteJid].length > 10) historialConversacion[remoteJid].shift();

  const dias = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
  const hoy = new Date();
  const mañana = dias[(hoy.getDay() + 1) % 7];
  const pasado = dias[(hoy.getDay() + 2) % 7];

  let baseConocimiento = "";
  try {
    const rootDir = process.cwd();
    const txtPath = path.join(rootDir, 'api', 'combo-regeneracion.txt');
    const jsonPath = path.join(rootDir, 'api', 'productos.json');
    baseConocimiento = `${fs.existsSync(txtPath) ? fs.readFileSync(txtPath, 'utf8') : ""}\n${fs.existsSync(jsonPath) ? fs.readFileSync(jsonPath, 'utf8') : ""}`;
  } catch (e) { console.error("Error archivos:", e); }

  const masterPrompt = `
  IDENTIDAD: Eres Fiorella de JRJMarket, asesora experta en bienestar. Trato de USTED.
  
  GESTIÓN DE INFORMACIÓN:
  1. DATOS DE VENTA (Precios, Combos, Stock): Búscalos estrictamente en el CATÁLOGO adjunto.
  2. DATOS DE SALUD Y AYUDA: Si el cliente pregunta por beneficios, usos o consejos sobre los ingredientes (orégano, colágeno, etc.) y no están detallados en el archivo, USA tu propia base de datos de conocimiento. 
     - REGLA DE ORO: La información debe ser REAL, verídica y profesional. NO inventes datos.
     - Si el producto no lo vendemos, ofrece verificar en bodega y ayuda con consejos de salud (ejercicios o remedios naturales) relacionados al dolor del cliente.

  ESENCIA: Humana, cálida, usa puntos suspensivos (...) y formato CASCADA.

  PROTOCOLO DE DATOS PARA ENVÍO:
  ✅ Nombre y Apellido:
  ✅ Dirección: (Dos calles y referencia detallada).
     Ej: Calle Amazonas S21-45 y Almagro, casa de 1 piso color café, portón negro, frente a Fybeca.
  📍 Agencia Servientrega (opcional).

  LOGÍSTICA: Entrega entre **${mañana}** o **${pasado}**. Pago contra entrega.
  Transportadoras: Servientrega, Gintracon, Veloces o Laar.

  CATÁLOGO OFICIAL:
  ${baseConocimiento}`;

  try {
    const mensajesIA = [
      { role: "system", content: masterPrompt },
      ...historialConversacion[remoteJid]
    ];

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY.trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: mensajesIA,
        temperature: 0.7 // Un poco más de flexibilidad para dar consejos de salud expertos
      })
    });
    
    const json = await resp.json();
    let textoFinal = json.choices?.[0]?.message?.content;

    if (textoFinal) {
      historialConversacion[remoteJid].push({ role: "assistant", content: textoFinal });

      let cascada = textoFinal
        .replace(/([.!?])\s+(?=[A-Z¿¡])/g, "$1\n") 
        .replace(/\.\.\.\s*/g, "...\n")
        .split('\n').map(l => l.trim()).filter(l => l !== "").join('\n');

      const partes = cascada.split('\n');

      if (partes.length > 2) {
        const mitad = Math.ceil(partes.length / 2);
        await fetch(`${baseUrl}/message/sendText/${instName}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
          body: JSON.stringify({ number: remoteJid, text: partes.slice(0, mitad).join('\n') })
        });
        await new Promise(r => setTimeout(r, 1500));
        await fetch(`${baseUrl}/message/sendText/${instName}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
          body: JSON.stringify({ number: remoteJid, text: partes.slice(mitad).join('\n') })
        });
      } else {
        await fetch(`${baseUrl}/message/sendText/${instName}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
          body: JSON.stringify({ number: remoteJid, text: textoFinal })
        });
      }
    }
  } catch (error) { console.error("Error:", error); }

  return res.status(200).send('OK');
};
