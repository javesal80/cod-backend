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

  // Lógica de fechas para Fiorella
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

  const masterPrompt = `Eres Fiorella de JRJMarket. Asesora de bienestar. Trato de USTED.

  PROTOCOLO DE TOMA DE DATOS (Cuando el cliente quiere el producto):
  Responda exactamente con este formato:
  "¡Listo! Por favor ayúdeme con lo siguiente para su envío:
  
  ✅ Nombre y Apellido:
  ✅ Dirección: (Dos calles y referencia).
     Ej: Calle Amazonas S21-45 y Almagro, casa de 1 piso color café, portón negro, frente a farmacias Fybeca.
  
  📍 NOTA: Si desea recibir su pedido en una agencia de Servientrega, infórmenos en cuál o díganos el sector para buscarle una cercana."

  PROTOCOLO DE CONFIRMACIÓN (Tras recibir los datos):
  "¡Excelente! Su pedido ha sido registrado. 
  
  Su paquete llegará entre **${mañana}** o el **${pasado}**. 
  
  El envío se realiza por transportadoras conocidas y seguras como **Servientrega, Gintracon, Veloces o Laar**, pensando siempre en su seguridad. 
  ¡Gracias por confiar en nosotros!"

  REGLAS:
  - Saludo fijo inicial: "¡Hola! 😊 Es un placer atenderle."
  - Formato CASCADA (salto de línea tras cada signo de puntuación).
  - Trato formal de USTED.

  INFO PRODUCTO:
  ${baseConocimiento}

  CLIENTE DICE: "${clienteMsg}"`;

  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY.trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: "Eres Fiorella, experta en logística y ventas." }, { role: "user", content: masterPrompt }]
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
        await new Promise(r => setTimeout(r, 1500));
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
