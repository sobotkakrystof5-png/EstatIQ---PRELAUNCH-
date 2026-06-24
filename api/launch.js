import { neon } from '@neondatabase/serverless'
import { Resend } from 'resend'

const sql = neon(process.env.DATABASE_URL)
const resend = new Resend(process.env.RESEND_API_KEY)

const FROM = process.env.FROM_EMAIL ?? 'EstatIQ <onboarding@resend.dev>'
const LAUNCH_SECRET = process.env.LAUNCH_SECRET
const APP_URL = process.env.APP_URL ?? 'https://estatiq.cz'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  // Auth check
  const authHeader = req.headers['authorization']
  if (!LAUNCH_SECRET || authHeader !== `Bearer ${LAUNCH_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const emails = await sql`
      SELECT id, email FROM waitlist
      WHERE launch_notified = FALSE
      ORDER BY created_at ASC
    `

    if (emails.length === 0) {
      return res.status(200).json({ sent: 0, message: 'Nikdo ke kontaktování.' })
    }

    let sent = 0
    let failed = 0
    const ids = []

    // Send in batches of 10 to respect rate limits
    for (let i = 0; i < emails.length; i += 10) {
      const batch = emails.slice(i, i + 10)

      await Promise.all(batch.map(async ({ id, email }) => {
        try {
          await resend.emails.send({
            from: FROM,
            to: email,
            subject: 'EstatIQ je tady — váš early access 🚀',
            html: launchEmailHtml(APP_URL),
          })
          ids.push(id)
          sent++
        } catch (err) {
          console.error(`Failed to send to ${email}:`, err)
          failed++
        }
      }))

      // Small pause between batches
      if (i + 10 < emails.length) {
        await new Promise(r => setTimeout(r, 300))
      }
    }

    // Mark as notified
    if (ids.length > 0) {
      await sql`UPDATE waitlist SET launch_notified = TRUE WHERE id = ANY(${ids})`
    }

    return res.status(200).json({ sent, failed, total: emails.length })
  } catch (err) {
    console.error('Launch email error:', err)
    return res.status(500).json({ error: 'Interní chyba serveru.' })
  }
}

function launchEmailHtml(appUrl) {
  return `<!DOCTYPE html>
<html lang="cs">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>EstatIQ je spuštěno</title></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td align="center" style="padding:40px 20px;">
      <table width="560" cellpadding="0" cellspacing="0" border="0"
        style="max-width:560px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.07);">

        <!-- Header -->
        <tr>
          <td style="background:#0b0f19;padding:28px 36px;">
            <span style="font-family:'Helvetica Neue',Arial,sans-serif;font-size:22px;font-weight:700;color:#f8fafc;letter-spacing:-0.02em;">
              Estat<span style="color:#10b981;">IQ</span>
            </span>
          </td>
        </tr>
        <tr><td style="height:3px;background:linear-gradient(90deg,#059669,#10b981);"></td></tr>

        <!-- Body -->
        <tr>
          <td style="padding:40px 36px 32px;">
            <h1 style="margin:0 0 8px;font-size:28px;font-weight:700;color:#0f172a;letter-spacing:-0.02em;">
              Jsme spuštěni. 🚀
            </h1>
            <p style="margin:0 0 20px;font-size:16px;color:#059669;font-weight:600;">
              Váš early access je připraven.
            </p>
            <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#475569;">
              Čekali jste a my jsme to dokázali. EstatIQ je teď živé a vy jste jako jeden z prvních na řadě.
            </p>
            <p style="margin:0 0 32px;font-size:15px;line-height:1.7;color:#475569;">
              Správa nájmů, automatické platby, daňový export — všechno na jednom místě. Žádný Excel, žádný papír.
            </p>

            <!-- CTA Button -->
            <table cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="border-radius:12px;background:#059669;">
                  <a href="${appUrl}" target="_blank"
                    style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;letter-spacing:-0.01em;">
                    Vstoupit do EstatIQ →
                  </a>
                </td>
              </tr>
            </table>

            <p style="margin:24px 0 0;font-size:13px;color:#94a3b8;">
              Nebo zkopírujte odkaz: <a href="${appUrl}" style="color:#059669;">${appUrl}</a>
            </p>
          </td>
        </tr>

        <!-- Feature highlights -->
        <tr>
          <td style="padding:0 36px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0"
              style="background:#f0fdf4;border-radius:12px;padding:4px;">
              <tr>
                <td style="padding:16px 20px;font-size:13px;color:#166534;line-height:1.7;">
                  <strong>Co na vás čeká:</strong><br>
                  ✓ Správa nemovitostí a nájemníků<br>
                  ✓ Automatické QR platby a upomínky<br>
                  ✓ Smlouvy s automatickými expiry alerty<br>
                  ✓ Daňový export PDF pro účetního
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:20px 36px 28px;border-top:1px solid #f1f5f9;">
            <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.6;">
              EstatIQ &middot; Pronájem, který se řídí sám 🇨🇿<br>
              Dostali jste tento e-mail, protože jste se přihlásili na čekací listinu.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`
}
