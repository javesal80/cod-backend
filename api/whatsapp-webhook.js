const fs = require('fs');
const path = require('path');

// Memoria volátil para mantener el hilo de la conversación
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

  // --- GESTIÓN DE MEMORIA (Historial de los últimos 6 mensajes) ---
  if (!historialConversacion[remoteJid]) {
    historialConversacion[remoteJid] = [];
  }
  historialConversacion[remoteJid].push({ role: "user", content: clienteMsg });
  if (historialConversacion[remoteJid].length > 6) historialConversacion[remoteJid].shift();

  // Lógica de fechas dinámica
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
  IDENTIDAD: Eres Fiorella de JRJMarket. Asesora de bienestar. Trato de USTED siempre.
  
  REGLA DE ORO (MEMORIA): Revisa el historial de mensajes adjunto. 
  - Si el cliente ya saludó, NO repitas el saludo inicial. 
  - Ten coherencia total: si el cliente menciona algo de un mensaje anterior, reconócelo.

  ESENCIA Y ESTILO (OBLIGATORIO):
  - Humana, cálida, usa puntos suspensivos (...) para pausas naturales.
  - Formato CASCADA: Salto de línea tras cada signo (. ! ? ...).
  
  BLOQUE DE BIENVENIDA (Solo si es el primer mensaje):
  - "¡Hola! 😊 Es un placer atenderle."
  - "Espero que se encuentre muy bien...\n¿En qué puedo ayudarle hoy?\n¿Está buscando algún producto para mejorar su bienestar? 🌿"

  PROTOCOLO DE CIERRE (Cuando hay interés o compra):
  - "¡Listo! Por favor ayúdeme con lo siguiente:
    ✅ Nombre y Apellido:
    ✅ Dirección: (Dos calles y referencia detallada).
    Ej: Calle Amazonas S21-45 y Almagro, casa de 1 piso color café, portón negro, frente a Fybeca.
    📍 Agencia Servientrega (opcional si desea retirar ahí)."

  LOGÍSTICA Y SEGURIDAD:
  - Llegada entre **${mañana}** o **${pasado}**.
  - Transportadoras: Servientrega, Gintracon, Veloces o Laar (por seguridad nacional).
  - Pago contra entrega. Envío GRATIS 1ra compra. -$2 transferencia.

  INFO PRODUCTO: ${baseConocimiento}`;

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
        temperature: 0.7
      })
    });
    
    const json = await resp.json();
    let textoFinal = json.choices?.[0]?.message?.content;

    if (textoFinal) {
      historialConversacion[remoteJid].push({ role: "assistant", content: textoFinal });

      // Procesamiento Cascada
      let cascada = textoFinal
        .replace(/([.!?])\s+(?=[A-Z¿¡])/g, "$1\n") 
        .replace(/\.\.\.\s*/g, "...\n")
        .split('\n').map(l => l.trim()).filter(l => l !== "").join('\n');

      const partes = cascada.split('\n');

      // Envío en dos bloques para mayor naturalidad
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
