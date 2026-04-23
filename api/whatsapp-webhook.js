const fs = require('fs');
const path = require('path');

// Memoria para coherencia conversacional
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

  // --- GESTIÓN DE MEMORIA ---
  if (!historialConversacion[remoteJid]) {
    historialConversacion[remoteJid] = [];
  }
  historialConversacion[remoteJid].push({ role: "user", content: clienteMsg });
  if (historialConversacion[remoteJid].length > 10) historialConversacion[remoteJid].shift();

  // Lógica de fechas dinámica para Ecuador
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
  ESTILO: Humana, cálida, usa puntos suspensivos (...) para pausas. 
  FORMATO: CASCADA (salto de línea tras cada punto, exclamación o interrogación).

  REGLAS DE MEMORIA Y COHERENCIA:
  - Revisa el historial. Si el cliente ya saludó, NO repitas el saludo inicial. 
  - Si el cliente menciona algo anterior, demuéstrale que lo recuerdas.

  PROTOCOLO SI EL PRODUCTO NO ESTÁ EN EL CATÁLOGO:
  - Si pide algo que no vendes: "Por el momento no lo tenemos... pero déjenos su nombre para verificar en bodegas o en el próximo pedido. Si lo hallamos, le avisamos por aquí."
  - APORTE VALOR: Explique para qué sirve ese producto o dé consejos/ejercicios para el dolor del cliente.
  - REDIRECCIÓN: Mencione cómo el Combo Regeneración (Aceite de Orégano + Colágeno) ayuda a su salud integral.

  BLOQUE DE BIENVENIDA (Solo inicio):
  - "¡Hola! 😊 Es un placer atenderle."
  - "Espero que se encuentre muy bien...\n¿En qué puedo ayudarle hoy?\n¿Está buscando algún producto para mejorar su bienestar? 🌿"

  TOMA DE DATOS (Al confirmar interés):
  - "¡Listo! Por favor ayúdeme con:
    ✅ Nombre y Apellido:
    ✅ Dirección: (Dos calles y referencia detallada).
       Ej: Calle Amazonas S21-45 y Almagro, casa de 1 piso color café, portón negro, frente a Fybeca.
    📍 Agencia Servientrega (opcional)."

  LOGÍSTICA Y SEGURIDAD:
  - Llegada: Entre **${mañana}** o **${pasado}**.
  - Transportadoras: Servientrega, Gintracon, Veloces o Laar.
  - Beneficios: Envío GRATIS 1ra compra. Pago contra entrega.

  CATÁLOGO: ${baseConocimiento}`;

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
