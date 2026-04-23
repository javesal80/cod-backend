const fs = require('fs');
const path = require('path');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(200).send('OK');

  const { 
    EVOLUTION_URL, EVOLUTION_TOKEN, INSTANCE_NAME, 
    OPENAI_API_KEY
  } = process.env;

  if (!req.body?.data?.message || req.body.data.key?.fromMe) {
    return res.status(200).send('OK');
  }

  const data = req.body.data;
  const clienteMsg = (data.message?.conversation || data.message?.extendedTextMessage?.text || "Hola").trim();
  const remoteJid = data.key?.remoteJid;
  const baseUrl = EVOLUTION_URL?.replace(/\/$/, "");
  const instName = req.body.instance || INSTANCE_NAME || "VitaeLAB";

  // Lógica de fechas (Dinámica)
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
  IDENTIDAD: Eres Fiorella de JRJMarket. Asesora de bienestar. Trato de USTED.
  ESTILO: Humana, cálida, usa puntos suspensivos (...) para crear pausas.

  1. SALUDO INICIAL (RECUPERAR ESENCIA):
     - Mensaje 1: "¡Hola! 😊 Es un placer atenderle."
     - Mensaje 2 (Exactamente este estilo): 
       "Espero que se encuentre muy bien...
       ¿En qué puedo ayudarle hoy?
       ¿Está buscando algún producto para mejorar su bienestar? 🌿
       Estoy aquí para ayudarle..."

  2. TOMA DE DATOS (SUTILEZA):
     - Pida el nombre solo tras detectar el dolor.
     - Si desea comprar, diga: 
       "¡Listo! Por favor ayúdeme con lo siguiente:
       ✅ Nombre y Apellido:
       ✅ Dirección: (Dos calles y referencia).
       Ej: Calle Amazonas S21-45 y Almagro, casa de 1 piso color café, portón negro, frente a Fybeca.
       📍 Indíquenos si desea retirar en alguna agencia Servientrega específica."

  3. CONFIRMACIÓN LOGÍSTICA:
     - Informe que llega entre **${mañana}** o **${pasado}**.
     - Mencione: Servientrega, Gintracon, Veloces o Laar (por su seguridad).

  FORMATO CASCADA: Salto de línea tras cada signo de puntuación (. ! ? ...).

  INFO PRODUCTO: ${baseConocimiento}
  CLIENTE: "${clienteMsg}"`;

  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY.trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: "Eres Fiorella, mantén siempre tu esencia cálida y el formato en cascada." }, { role: "user", content: masterPrompt }]
      })
    });
    
    const json = await resp.json();
    let textoFinal = json.choices?.[0]?.message?.content;

    if (textoFinal) {
      let cascada = textoFinal
        .replace(/([.!?])\s+(?=[A-Z¿¡])/g, "$1\n") 
        .replace(/\.\.\.\s*/g, "...\n")
        .split('\n').map(l => l.trim()).filter(l => l !== "").join('\n');

      const partes = cascada.split('\n');
      const saludo = partes[0];
      const resto = partes.slice(1).join('\n');

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
  } catch (error) { console.error("Error:", error); }

  return res.status(200).send('OK');
};
