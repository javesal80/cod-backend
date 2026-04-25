const fs = require('fs');
const path = require('path');

// Memoria volátil para el hilo de la conversación (Serverless)
const historialConversacion = {};

module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(200).send('OK');

    const { 
        EVOLUTION_URL, EVOLUTION_TOKEN, INSTANCE_NAME, 
        GROK_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, IA_PROVIDER 
    } = process.env;

    const NUMERO_ADMIN = "593992668002"; // Tu número para recibir alertas de venta

    if (!req.body?.data?.message || req.body.data.key?.fromMe) return res.status(200).send('OK');

    const data = req.body.data;
    const clienteMsg = (data.message?.conversation || data.message?.extendedTextMessage?.text || "").trim();
    const remoteJid = data.key?.remoteJid;
    const baseUrl = EVOLUTION_URL?.replace(/\/$/, "");
    const instName = req.body.instance || INSTANCE_NAME || "VitaeLAB";
    const provider = (IA_PROVIDER || 'grok').trim().toLowerCase();

      // Fechas dinámicas
    const dias = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"];
    const hoy = new Date();
    const mañana = dias[(hoy.getDay() + 1) % 5];
    const pasado = dias[(hoy.getDay() + 2) % 5];
    
   // --- GESTIÓN DE MEMORIA ---
    if (!historialConversacion[remoteJid]) historialConversacion[remoteJid] = [];
    historialConversacion[remoteJid].push({ role: "user", content: clienteMsg });
    if (historialConversacion[remoteJid].length > 10) historialConversacion[remoteJid].shift();
    
// --- 1. BUSCAR QUÉ PRODUCTO CORRESPONDE ---
    let infoEspecifica = "";
    let nombreProducto = "";
    let baseConocimiento = "";
    
    try {
        const productosPath = path.join(process.cwd(), 'api', 'productos.json');
        if (fs.existsSync(productosPath)) {
            const dataProductos = JSON.parse(fs.readFileSync(productosPath, 'utf8'));
            const msgLower = clienteMsg.toLowerCase();
            
            // Buscamos si alguna keyword del JSON está en el mensaje del cliente
            const productoEncontrado = dataProductos.PRODUCTOS.find(p => 
                p.keywords.some(k => clienteMsg.includes(k.toLowerCase()))
            );

            if (productoEncontrado) {
                nombreProducto = productoEncontrado.nombre;
                const txtPath = path.join(process.cwd(), 'api', productoEncontrado.archivo);
                
                if (fs.existsSync(txtPath)) {
                    infoEspecifica = fs.readFileSync(txtPath, 'utf8');
                    console.log(`🔎 Match encontrado: ${nombreProducto}. Usando: ${productoEncontrado.archivo}`);
                }
            }
        }
    } catch (e) {
        console.error("Error en el enrutador de productos:", e.message);
    }

    // --- 2. CONSTRUIR EL CONOCIMIENTO PARA LA IA ---
    // Si no encontró match, usamos un mensaje genérico o el catálogo base
    baseConocimiento = infoEspecifica 
        ? `EL CLIENTE ESTÁ INTERESADO EN: ${nombreProducto}.\nUSA ESTA INFO:\n${infoEspecifica}`
        : "El cliente está saludando o preguntando algo general. Responde con calidez, sé amable, indaga qué le duele y no pidas el nombre todavía.";
    
    const masterPrompt = `
    IDENTIDAD: Eres Fiorella de JRJMarket, asesora experta en bienestar. No eres una vendedora común, eres una amiga que ayuda. Trato de USTED siempre.
    PERSONALIDAD: Empática, sutil, experta en neuroventas.
    ESTILO: Humana, usa puntos suspensivos (...) y empaquetado en cascada.
    
    FILOSOFÍA (AIDA + NEUROVENTAS):
    1. EMPATÍA: Si el cliente tiene un dolor, valídalo. "Le entiendo, es muy frustrante sentirse así...".
    2. INTERÉS: Antes de dar precio, indaga: "¿Qué es lo que más le preocupa de su salud hoy?".
    3. SUTILEZA: Pide el nombre solo después de haber conectado con su dolor: "¿Me ayuda con su nombre? Me gusta tratar a mis pacientes de forma personal".
    4. PERSUASIÓN: Si el cliente duda, usa PRUEBA SOCIAL y no dejes que se vaya sin una solución.
    5. SEGURIDAD: Bodegas cerradas (Ambato/Quito) por seguridad nacional. Pago contra entrega.

    ESTRATEGIA: 
    - No seas vendedora de catálogo. Sé la amiga que da el consejo justo.
    - Explica que no hay local por seguridad (vacunas/extorsiones) pero que el Pago Contra Entrega protege al cliente.
    - Envío GRATIS en su primera compra.
    - Si el conocimiento especifica un producto, enfócate en sus beneficios para el dolor del cliente.
    - Si no hay un producto claro, indaga qué le preocupa de su salud hoy y aconcejale un producto que tengamos.
    
    REGLAS DE FORMATO (CASCADA):
    - Puntos suspensivos (...) para pausas humanas.
    - Salto de línea tras cada punto, exclamación o pregunta.
    - NO bloques largos.

    LOGÍSTICA: Llegada entre ${mañana} o ${pasado}. Envío GRATIS 1ra compra. -$2 transferencia.
    
    CONOCIMIENTO ACTUAL: ${baseConocimiento}
    HISTORIAL RECIENTE: ${JSON.stringify(historialConversacion[remoteJid])}`;
             
      
    // --- 2. CONSTRUIR EL CONOCIMIENTO PARA LA IA ---
    // Si no encontró match, usamos un mensaje genérico o el catálogo base
    baseConocimiento = infoEspecifica 
        ? `EL CLIENTE ESTÁ INTERESADO EN: ${nombreProducto}.\nDETALLES TÉCNICOS:\n${infoEspecifica}`
        : "El cliente está saludando o preguntando algo general. Responde con calidez sobre JRJMarket.";
    
    
    try {
        let textoFinal = "";

        // --- LÓGICA MULTI-IA ---
        if (provider === 'grok') {
            const respIA = await fetch('https://api.x.ai/v1/responses', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${GROK_API_KEY.trim()}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ "model": "grok-4.20-reasoning", "input": masterPrompt + `\nCliente dice: "${clienteMsg}"\nResponde:` })
            });
            const jsonIA = await respIA.json();
            const msgObj = jsonIA.output?.find(o => o.type === 'message');
            textoFinal = msgObj?.content?.find(c => c.type === 'output_text')?.text || "";
        } else {
            const respIA = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${OPENAI_API_KEY.trim()}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: "gpt-4o-mini",
                    messages: [{ role: "system", content: masterPrompt }, ...historialConversacion[remoteJid]],
                    temperature: 0.7
                })
            });
            const jsonIA = await respIA.json();
            textoFinal = jsonIA.choices?.[0]?.message?.content || "";
        }

        if (textoFinal) {
            textoFinal = textoFinal.replace(/^\*\*Fiorella:\*\*\s*/i, "").trim();
            historialConversacion[remoteJid].push({ role: "assistant", content: textoFinal });

            // --- NOTIFICACIÓN DE VENTA ---
            const keywords = ["confirmado", "registrado", "agendado", "dirección", "nombre"];
            if (keywords.some(k => textoFinal.toLowerCase().includes(k)) && clienteMsg.length > 15) {
                await fetch(`${baseUrl}/message/sendText/${instName}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
                    body: JSON.stringify({ number: NUMERO_ADMIN, text: `📢 *NUEVA POSIBLE VENTA*\nDe: ${remoteJid}\nDatos: ${clienteMsg}` })
                });
            }

            // --- FORMATEO CASCADA Y ENVÍO ---
            let cascada = textoFinal
                .replace(/([.!?])\s+(?=[A-Z¿¡])|([.!?])$/gm, "$1\n") 
                .replace(/\.\.\.\s*/g, "...\n")           
                .split('\n').map(l => l.trim()).filter(l => l !== "").join('\n');

            const partes = cascada.split('\n');
            for (const parte of partes) {
                await fetch(`${baseUrl}/message/sendText/${instName}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN },
                    body: JSON.stringify({ number: remoteJid, text: parte })
                });
                await new Promise(r => setTimeout(r, 1300));
            }
        }
    } catch (error) { console.error("Error Maestro:", error.message); }

    return res.status(200).send('OK');
};
