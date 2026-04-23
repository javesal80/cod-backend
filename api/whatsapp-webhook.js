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
  const instanceActual = req.body.instance || INSTANCE_NAME || "VitaeLAB";

  // --- CARGA DE CONOCIMIENTO (PRODUCTOS Y DETALLES) ---
  let baseConocimiento = "";
  try {
    const productosPath = path.join(process.cwd(), 'api', 'productos.json');
    const txtPath = path.join(process.cwd(), 'data', 'combo-regeneracion.txt');
    baseConocimiento = `CATÁLOGO Y DATOS:\n${fs.readFileSync(productosPath, 'utf8')}\n${fs.readFileSync(txtPath, 'utf8')}`;
  } catch (e) { baseConocimiento = "Info no disponible."; }

  // --- MASTER PROMPT: EL CEREBRO DE FIORELLA ---
  const masterPrompt = `
  IDENTIDAD:
  Eres Fiorella de JRJMarket. No eres una vendedora, eres una asesora de bienestar que ayuda a sus amigos. 
  Tu trato es de USTED, con calidez ecuatoriana (amable, respetuosa, empática).

  FILOSOFÍA DE VENTA (NEUROVENTAS + AIDA):
  1. EDUCACIÓN Y EMPATÍA: Antes de vender, explique el "por qué". Si el cliente tiene un dolor, valide su sentir: "Le entiendo perfectamente, es muy frustrante sentirse así...".
  2. INTERÉS GENUINO: Usted se preocupa por la salud del cliente. Si el cliente pregunta precio de entrada, salude y diga: "Con todo gusto le ayudo, pero antes cuénteme, ¿qué es lo que más le preocupa de su salud hoy?".
  3. SEGURIDAD Y CONFIANZA: 
     - Si piden LOCAL FÍSICO: Informe que por seguridad del país y las vacunas (extorsiones), solo manejamos bodegas cerradas en Ambato y Quito. Por eso, protegemos al cliente con PAGO CONTRA ENTREGA mediante Servientrega, Gintracon, Veloces o Laar.
  4. GATILLOS MENTALES:
     - ENVÍO GRATIS en la primera compra.
     - DESCUENTO EXTRA: $2 menos si paga por transferencia o tarjeta (incentiva el pago anticipado).
     - PRUEBA SOCIAL: "Muchos clientes me dicen que tras la primera semana ya sienten el cambio".

  REGLAS DE FORMATO (ESTÉTICA):
  - PROHIBIDO bloques de texto largos. Use párrafos cortos de 2 oraciones máximo.
  - Use saltos de línea (doble Enter) para que el mensaje "respire".
  - Use negritas solo en palabras clave de beneficio.
  - Máximo 3 mensajes cortos por respuesta.
  - Use Emojis con moderación (solo para dar calidez).

  CONOCIMIENTO TÉCNICO:
  ${baseConocimiento}

  MENSAJE DEL CLIENTE A PROCESAR: "${clienteMsg}"`;

  try {
    let textoFinal = "";

    // --- LÓGICA DE IA ---
    if (provider === 'grok') {
      const resp = await fetch('https://api.x.ai/v1/responses', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${GROK_API_KEY.trim()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: "grok-4.20-reasoning", input: masterPrompt })
      });
      const resJson = await resp.json();
      if (Array.isArray(resJson)) {
        textoFinal = resJson.find(i => i.type === "message")?.content?.[0]?.text;
      }
      if (!textoFinal) {
        const match = JSON.stringify(resJson).match(/"output_text","text":"([^"]+)"/);
        if (match) textoFinal = match[1].replace(/\\n/g, '\n');
      }
    } else {
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${OPENAI_API_KEY.trim()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [{ role: "system", content: "Asesora de bienestar experta." }, { role: "user", content: masterPrompt }]
        })
      });
      const json = await resp.json();
      textoFinal = json.choices?.[0]?.message?.content;
    }

    // --- ENVÍO A EVOLUTION ---
    if (textoFinal) {
      // Dividimos el mensaje por párrafos dobles para enviarlos como mensajes separados si es necesario
      const parrafos = textoFinal.split('\n\n').filter(p => p.trim() !== "");
      
      for (const p of parrafos.slice(0, 3)) { // Máximo 3 mensajes
        await fetch(`${baseUrl}/message/sendText/${instanceActual.trim()}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
          body: JSON.stringify({ number: remoteJid, text: p.trim() })
        });
      }
    }
    return res.status(200).send('OK');
  } catch (error) { return res.status(200).send('OK'); }
}
