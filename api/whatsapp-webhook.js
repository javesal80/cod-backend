import fs from 'fs';
import path from 'path';
import catalogo from './productos.json';

export default async function handler(req, res) {
  const { EVOLUTION_URL, EVOLUTION_TOKEN, INSTANCE_NAME, GROK_API_KEY } = process.env;

  if (!req.body?.data?.message) return res.status(200).send('OK');
  const data = req.body.data;
  if (data.key?.fromMe) return res.status(200).send('OK');

  const clienteMsg = (data.message?.conversation || data.message?.extendedTextMessage?.text || "").toLowerCase();
  const remoteJid = data.key?.remoteJid;

  try {
    const productoMatch = catalogo.PRODUCTOS.find(p => 
      p.keywords.some(k => clienteMsg.includes(k))
    ) || catalogo.PRODUCTOS[0];

    const filePath = path.join(process.cwd(), 'data', productoMatch.archivo);
    const fichaTecnica = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : "";

    const promptMaestro = `
    Eres ${catalogo.CONFIG_MAESTRA.agente}. NO eres un bot de atención al cliente. Eres una amiga de confianza del cliente.
    TONO: ${catalogo.CONFIG_MAESTRA.tono}

    ESTRATEGIA DE NEUROVENTAS (AMIGO):
    1. EMPATÍA REAL: Si el cliente dice que le duele algo, responde como una persona: "Ay no, qué feo eso, te entiendo porque a mi tía le pasaba igual...".
    2. RECOMENDACIÓN NATURAL: No vendas el producto, recomiéndalo: "Mira, te digo la verdad, prueba este combo... es buenísimo porque el orégano te limpia y ahí sí el colágeno te hace efecto."
    3. CIERRE SIN PRESIÓN: "Si quieres te lo mando hoy mismo para que ya empieces a sentirte bien, ¿te parece? Pagas cuando te llegue a la casa."
    4. FLEXIBILIDAD: Si el combo le parece mucho, dile: "Tranqui, si quieres prueba solo con el colágeno primero, lo importante es que empieces."

    REGLAS DE ORO:
    - Máximo 2 o 3 oraciones. No párrafos largos.
    - Usa negritas solo en lo más importante.
    - Si confirma datos, di: "¡Excelente decisión! Ya te dejé tu pedido DESPACHADO."

    BIBLIOTECA TÉCNICA:
    ${fichaTecnica}
    `;

    const respIA = await fetch('https://api.xai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${GROK_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: "grok-beta",
        messages: [{ role: "system", content: promptMaestro }, { role: "user", content: clienteMsg }]
      })
    });

    const resJson = await respIA.json();
    const textoIA = resJson.choices?.[0]?.message?.content || "Deme un momentito para ayudarle.";

    const cleanUrl = EVOLUTION_URL.replace(/\/$/, "");
    await fetch(`${cleanUrl}/message/sendText/${INSTANCE_NAME.trim()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
      body: JSON.stringify({ number: remoteJid, text: textoIA })
    });

    return res.status(200).send('OK');
  } catch (error) {
    console.error('Error:', error.message);
    return res.status(200).send('OK');
  }
}
