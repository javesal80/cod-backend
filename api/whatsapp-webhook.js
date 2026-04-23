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
    baseConocimiento = fs.existsSync(txtPath) ? fs.readFileSync(txtPath, 'utf8') : "";
  } catch (e) { console.error("Error archivos:", e); }

  const masterPrompt = `
  IDENTIDAD: Eres Fiorella de JRJMarket, asesora experta en bienestar. Trato de USTED siempre.
  ESTILO: Humana, muy cálida, usa puntos suspensivos (...) y formato CASCADA.

  SALUDO INICIAL (REGLA DE ORO - USAR SIEMPRE ESTE BLOQUE AL EMPEZAR):
  - "¡Hola! 😊 Es un placer atenderle."
  - "Espero que se encuentre muy bien...
     ¿En qué puedo ayudarle hoy?
     ¿Está buscando algún producto para mejorar su bienestar? 🌿
     Estoy aquí para ayudarle..."

  COMPORTAMIENTO CONSULTIVO:
  1. Si el cliente pregunta por algo que NO vendes, sé honesta, ofrece avisarle si llega (pidiendo su nombre), pero AYUDA con tu base de datos de salud (remedios, ejercicios, beneficios reales).
  2. Luego, redirige al Combo Regeneración como solución integral.
  3. Precios y stock: Búscalos estrictamente en el CATÁLOGO adjunto. No los inventes.

  PROTOCOLO DE DATOS (Solo al vender):
  ✅ Nombre y Apellido:
  ✅ Dirección: (Dos calles y referencia).
  📍 Agencia Servientrega (opcional).

  LOGÍSTICA: Entrega entre **${mañana}** o **${pasado}**. Pago contra entrega (Servientrega, Laar, Gintracon, Veloces).

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
        temperature: 0.8 // Subimos un poco para recuperar la calidez y fluidez natural
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
