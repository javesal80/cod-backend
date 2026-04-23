const fs = require('fs');
const path = require('path');

// Memoria persistente mientras la instancia de Vercel esté activa
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

  // --- GESTIÓN ESTRICTA DE MEMORIA ---
  if (!historialConversacion[remoteJid]) {
    historialConversacion[remoteJid] = [];
  }
  
  // Determinamos si es el primer mensaje para forzar el saludo solo al inicio
  const esPrimerMensaje = historialConversacion[remoteJid].length === 0;

  // Guardamos mensaje del cliente
  historialConversacion[remoteJid].push({ role: "user", content: clienteMsg });
  if (historialConversacion[remoteJid].length > 12) historialConversacion[remoteJid].shift();

  // Fechas dinámicas
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
  ESTILO: Humana, cálida, usa puntos suspensivos (...) y formato CASCADA.

  REGLA DE ORO DE COHERENCIA (MEMORIA):
  - REVISA EL HISTORIAL. Si ya saludaste, NO repitas el saludo.
  - Si el cliente te hace una pregunta directa (ej: "Orégano"), responde directamente SIN saludar de nuevo.
  - Usa el historial para saber qué productos ya mencionaste.

  PROTOCOLO SI EL PRODUCTO NO ESTÁ (ORÉGANO):
  - Si pide algo que no vendes solo (como orégano seco): "No lo tenemos solito... pero lo tenemos como ingrediente principal en nuestro Combo Regeneración Total... es mucho más potente."
  - USA TU BASE DE DATOS para dar consejos reales de salud, ejercicios o beneficios del producto pedido, pero SIEMPRE busca el PRECIO en el catálogo adjunto.

  SALUDO INICIAL (SOLO SI NO HAS HABLADO ANTES):
  "¡Hola! 😊 Es un placer atenderle.\nEspero que se encuentre muy bien...\n¿En qué puedo ayudarle hoy?\n¿Está buscando algún producto para mejorar su bienestar? 🌿"

  LOGÍSTICA: Entrega entre **${mañana}** o **${pasado}**. Pago contra entrega. (Servientrega, Laar, Gintracon, Veloces).

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
        temperature: 0.7
      })
    });
    
    const json = await resp.json();
    let textoFinal = json.choices?.[0]?.message?.content;

    if (textoFinal) {
      // Guardar en memoria para que sepa que ya respondió
      historialConversacion[remoteJid].push({ role: "assistant", content: textoFinal });

      // Formateo Cascada
      let cascada = textoFinal
        .replace(/([.!?])\s+(?=[A-Z¿¡])/g, "$1\n") 
        .replace(/\.\.\.\s*/g, "...\n")
        .split('\n').map(l => l.trim()).filter(l => l !== "").join('\n');

      const partes = cascada.split('\n');

      // Envío por globos
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
