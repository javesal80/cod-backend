// /api/callback.js - Recibe el código OAuth y obtiene el token
export default async function handler(request, response) {
  const { code, shop } = request.query;
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

  if (!code || !shop) {
    return response.status(400).json({ error: 'Missing code or shop' });
  }

  try {
    const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code: code,
      }),
    });

    const tokenData = await tokenResponse.json();

    if (!tokenData.access_token) {
      throw new Error('No access token received');
    }

    return response.status(200).send(`
      <html>
        <body style="font-family:sans-serif;padding:40px;background:#0a0a0a;color:#fff;">
          <h2 style="color:#00cc44;">✅ App instalada correctamente</h2>
          <p>Tienda: <strong>${shop}</strong></p>
          <p>Copia este token y pégalo en Vercel como <code>SHOPIFY_ADMIN_API_TOKEN</code>:</p>
          <div style="background:#1a1a1a;padding:20px;border-radius:8px;border:1px solid #00cc44;margin:20px 0;">
            <code style="font-size:16px;color:#00cc44;word-break:break-all;">${tokenData.access_token}</code>
          </div>
          <p style="color:#888;">Una vez copiado, cierra esta página. El token no expira.</p>
        </body>
      </html>
    `);

  } catch (error) {
    console.error('OAuth error:', error);
    return response.status(500).json({ error: error.message });
  }
}