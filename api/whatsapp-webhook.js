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

  let baseConocimiento = "";
  try {
    const productosPath = path.join(process.cwd(), 'api', 'productos.json');
    const txtPath = path.join(process.cwd(), 'data', 'combo-regeneracion.txt');
    baseConocimiento = `INFO:\n${fs.readFileSync(productosPath, 'utf8')}\n${fs.readFileSync(txtPath, 'utf8')}`;
  } catch (e) { baseConocimiento = "Error."; }

  const masterPrompt = `
  IDENTIDAD: Eres Fiorella de JRJMarket. Asesora de bienestar (Trato de USTED).

  ESTRUCTURA DE SALUDO (FIJO):
  - Inicie siempre con: "¡Hola! 😊 Es un placer atenderle." (o una variante muy similar y cálida).

  ESTRATEGIA DE CONEXIÓN:
  1. EN EL SALUDO INICIAL: Solo salude y pregunte qué le preocupa de su salud. NO pida nombre aún.
  2. TRAS DETECTAR EL DOLOR: 
     - Empatice con el síntoma (ej: dolor de rodillas, gastritis).
     - Explique brevemente cómo el producto ayuda a ESE dolor específico.
     - Pida el nombre sutilmente: "¿Me ayuda con su nombre? Me gusta tratar a mis pacientes de forma personal para estar pendiente de su mejoría."

  REGLAS DE FORMATO (CASCADA):
  - Salto de línea obligatorio tras cada signo de puntuación (. ! ? ...).
  - Use emoticons solo para dar calidez (máximo 1 o 2 por mensaje).

  DATOS LOGÍSTICOS:
  - Bodegas: Ambato y Quito (por seguridad). Pago contra entrega. Envío gratis 1ra compra. -$2 transferencia/tarjeta.

  CONOCIMIENTO:
  ${baseConocimiento}

  CLIENTE: "${clienteMsg}"`;

  try {
    let textoFinal = "";

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
        const match = JSON.stringify(resJson).match(/"output_text","text":"([^"]+)"/);
        if (match) textoFinal = match[1].replace(/\\n/g,
