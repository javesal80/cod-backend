// ================== DATOS FIJOS ==================
const DATOS_TRANSFERENCIA =
`👤 *Nombre:* Javier Espín

🏦 *Banco Pichincha:* cuenta # 4082653600
🏦 *Banco Produbanco:* cuenta # 12001090841
🏦 *Banco del Pacífico:* cuenta # 1016255178`;

const LINKS_PAYPHONE = [
    { clave: "americanfit",      nombre: "American Fit + regalo",       link: "https://ppls.me/oy2Uq77FkeQzPhSK5n0kkQ" },
    { clave: "krecupcapsulas",   nombre: "Krec'UP Cápsulas + regalo",   link: "https://ppls.me/sQvTLUw6C16H5Ba7dxzA" },
    { clave: "krecupgomitas",    nombre: "Krec'UP Gomitas + regalo",    link: "https://ppls.me/ImmvljoInwB69F0pjRu4jQ" },
    { clave: "glucosamina",      nombre: "Glucosamina + regalo",        link: "https://ppls.me/Gdrg3MBteqA2hUtgE1B7Ow" },
    { clave: "curvymagic",       nombre: "Curvy Magic + regalo",        link: "https://ppls.me/Gh5r0HIxJceLV3Ux7aTxFQ" },
    { clave: "ashwagandha",      nombre: "Ashwagandha + regalo",        link: "https://ppls.me/T8PPMkkxIyQoG4Tur5iA" },
    { clave: "magnesiumcomplex", nombre: "Magnesium Complex + regalo",  link: "https://ppls.me/jWpt1y5Tf8OPCXdqcJZVA" },
    { clave: "7days",            nombre: "7 Days Dtox Clen + regalo",   link: "https://ppls.me/1Azwhlxqha7vam6FOqCtg" },
    { clave: "audiomax",         nombre: "Audiomax + regalo",           link: "https://ppls.me/SqH3kt4bn3L7WMCDMl5aag" }
];

const norm = s => String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");

// ================== FUNCIÓN PRINCIPAL ==================
module.exports = async (request, response) => {
    // Manejo de CORS
    const origin = request.headers.origin || '';
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (request.method === 'OPTIONS') return response.status(200).end();

    const { EVOLUTION_URL, INSTANCE_DESPACHO, EVOLUTION_TOKEN_DESPACHO } = process.env;

    const orderData = request.body;

    try {
        if (!orderData || !orderData["Teléfono"]) return response.status(200).json({ success: false });

            let cleanPhone = String(orderData["Teléfono"]).replace(/\D/g, '');
        if (cleanPhone.length === 10 && cleanPhone.startsWith('0')) cleanPhone = '593' + cleanPhone.substring(1);
        if (cleanPhone.length === 9 && cleanPhone.startsWith('9')) cleanPhone = '593' + cleanPhone;

        const nombreCompleto = String(orderData["Cliente"] || "").trim();

        // --- Tipo de cobro ---
        const metodoRaw = String(orderData["Tipo de cobro"] || "")
            .toLowerCase()
            .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        let metodo = "contraentrega";
        if (metodoRaw.includes("transfer")) metodo = "transferencia";
        else if (metodoRaw.includes("tarjeta") || metodoRaw.includes("payphone")) metodo = "tarjeta";

        // --- Productos y total ---
        const productosRaw = String(orderData["Productos"] || "");

       const productosFormateados = productosRaw
        .replace(/\(\$([\d.,]+)\)/g, (m, valor) => `por *$${valor}*`)
        .replace(/,/g, ".");

        const listaProductosFinal = productosFormateados.split(' y ')
            .map(item => `▪️ ${item.trim()}`)
            .join('\n');

        let totalGeneral = orderData["Total"] || "";
        if (totalGeneral) totalGeneral = String(totalGeneral).replace(/,/g, ".");
        const textoTotal = totalGeneral ? `\n\n💰 *Total pedido:* *$${totalGeneral}*` : "";

        // --- Mensajes comunes ---
        const mensajesAEnviar = [
            `Hola, muy buenas... Un gusto saludarle 😊`,
            `Nos comunicamos por confirmar el siguiente pedido:\n\n📦 *Productos:*\n${listaProductosFinal} ${textoTotal}`,
            `📍 *Para:* ${nombreCompleto}\n🏙️ *Ciudad:* ${orderData["Ciudad"] || ""}${orderData["Provincia"] ? `\n🗺️ *Provincia:* ${orderData["Provincia"]}` : ""}\n🏠 *Dirección:* ${orderData["Dirección"] || ""}`
        ];

        // --- Mensajes según tipo de cobro ---
        if (metodo === "contraentrega") {
            mensajesAEnviar.push(`¿Es esto correcto?`);

        } else if (metodo === "transferencia") {
            mensajesAEnviar.push(
                `A continuación los datos para la transferencia${totalGeneral ? ` por *$${totalGeneral}*` : ""}.\n\nPor favor realízala de preferencia *del mismo banco* para que sea inmediata:\n▪️ Pichincha → Pichincha\n▪️ Produbanco → Produbanco\n▪️ Pacífico → Pacífico\n Si la realizas de diferente banco no hay inconveniente apenas se visualize la misma procederemos al despacho`,
                DATOS_TRANSFERENCIA,
                `Una vez realizada, por favor adjúntanos el comprobante de pago 📎 y confírmanos si los datos de entrega son correctos.`
            );

        } else if (metodo === "tarjeta") {
            const items = productosRaw.split(' y ').map(it => {
                const titulo = it.replace(/\s*\(\$.*$/, "").trim();
                const precio = ((it.match(/\(\$([\d.,]+)\)/) || [])[1] || "").replace(",", ".");
                const k = norm(titulo);
                return { precio, p: LINKS_PAYPHONE.find(x => k.startsWith(x.clave)) };
            });

            if (items.length && items.every(x => x.p)) {
                const varios = items.length > 1;
                const lineas = items.map(x => `▪️ *${x.p.nombre}* — $${x.precio}\n👉 ${x.p.link}`).join('\n\n');
                mensajesAEnviar.push(
                    `🔒 *PAGO SEGURO CON TARJETA* 🔒\n\n💳 Te adjunto ${varios ? "tus links" : "tu link"} de pago seguro vía *PayPhone* para pagar con tarjeta de crédito o débito.\n\n✅ Pagas dentro de la plataforma de PayPhone\n✅ Nosotros no vemos ni guardamos los datos de tu tarjeta\n✅ Una vez confirmado el pago, despachamos tu pedido`,
                    `${lineas}${varios ? `\n\n💰 *Total a pagar:* $${totalGeneral}\n(paga cada link por separado)` : ""}`,
                    `Cuando termines el pago, envíanos aquí la captura 📎 y confírmanos si los datos de entrega son correctos.`
                );
            } else {
                mensajesAEnviar.push(`💳 En unos minutos un asesor te enviará tu link de pago seguro vía PayPhone.`);
            }
        }

        console.log(`🚀 [CEREBRO-CONFIRMAR] Método: ${metodo} | ${mensajesAEnviar.length} mensajes`);

        for (const msgTexto of mensajesAEnviar) {
            const r = await fetch(`${EVOLUTION_URL}/message/sendText/${INSTANCE_DESPACHO}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'apikey': EVOLUTION_TOKEN_DESPACHO },
                body: JSON.stringify({ number: cleanPhone, text: msgTexto })
            });
            if (!r.ok) console.error("Evolution respondió", r.status, await r.text());
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        return response.status(200).json({ success: true });
    } catch (error) {
        console.error("Error general Cerebro:", error.message);
        return response.status(200).json({ error: error.message });
    }
};
