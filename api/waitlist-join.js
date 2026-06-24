import { neon } from '@neondatabase/serverless'
import { Resend } from 'resend'

const sql = neon(process.env.DATABASE_URL)
const resend = new Resend(process.env.RESEND_API_KEY)

const FROM = process.env.FROM_EMAIL ?? 'EstatIQ <onboarding@resend.dev>'
const OWNER_EMAIL = process.env.OWNER_EMAIL ?? 'sobotkakrystof5@gmail.com'
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? 'https://estatiq.cz'
const VALID_LOCALES = ['cs', 'en', 'sk', 'de']
const RATE_LIMIT_MAX = 5

function getIp(req) {
  const forwarded = req.headers['x-forwarded-for']
  if (forwarded) return forwarded.split(',')[0].trim()
  return req.socket?.remoteAddress ?? 'unknown'
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

async function ensureTables() {
  await sql`
    CREATE TABLE IF NOT EXISTS waitlist (
      id              SERIAL PRIMARY KEY,
      email           TEXT UNIQUE NOT NULL,
      name            TEXT,
      locale          TEXT DEFAULT 'cs',
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      launch_notified BOOLEAN DEFAULT FALSE
    )
  `
  await sql`ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS name TEXT`
  await sql`
    CREATE TABLE IF NOT EXISTS rate_limits (
      ip       TEXT PRIMARY KEY,
      count    INTEGER NOT NULL DEFAULT 1,
      reset_at TIMESTAMPTZ NOT NULL
    )
  `
}

async function isRateLimited(ip) {
  const result = await sql`
    INSERT INTO rate_limits (ip, count, reset_at)
    VALUES (${ip}, 1, NOW() + INTERVAL '1 hour')
    ON CONFLICT (ip) DO UPDATE SET
      count    = CASE WHEN rate_limits.reset_at < NOW() THEN 1 ELSE rate_limits.count + 1 END,
      reset_at = CASE WHEN rate_limits.reset_at < NOW() THEN NOW() + INTERVAL '1 hour' ELSE rate_limits.reset_at END
    RETURNING count
  `
  return result[0].count > RATE_LIMIT_MAX
}

export default async function handler(req, res) {
  const origin = req.headers['origin']
  if (origin === ALLOWED_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN)
    res.setHeader('Vary', 'Origin')
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { email, name = '', locale = 'cs', _hp = '' } = req.body ?? {}

  // Honeypot — bots fill hidden fields, humans don't
  if (_hp !== '') return res.status(200).json({ count: 0 })

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Neplatný e-mail.' })
  }

  const sanitizedLocale = VALID_LOCALES.includes(locale) ? locale : 'cs'

  try {
    await ensureTables()

    const ip = getIp(req)
    if (await isRateLimited(ip)) {
      return res.status(429).json({ error: 'Příliš mnoho pokusů. Zkuste to za hodinu.' })
    }

    const existing = await sql`SELECT id FROM waitlist WHERE email = ${email}`
    if (existing.length > 0) {
      const [{ count }] = await sql`SELECT COUNT(*) AS count FROM waitlist`
      return res.status(200).json({ count: Number(count) })
    }

    const sanitizedName = name ? String(name).trim().slice(0, 100) : ''
    await sql`INSERT INTO waitlist (email, name, locale) VALUES (${email}, ${sanitizedName || null}, ${sanitizedLocale})`

    const [{ count }] = await sql`SELECT COUNT(*) AS count FROM waitlist`
    const currentCount = Number(count)

    const [confirmResult, ownerResult] = await Promise.allSettled([
      resend.emails.send({
        from: FROM,
        to: email,
        subject: 'Děkujeme za zájem o EstatIQ',
        html: confirmationHtml(sanitizedName),
      }),
      resend.emails.send({
        from: FROM,
        to: OWNER_EMAIL,
        subject: `Nový zápis na waitlist: ${escapeHtml(email)}`,
        html: ownerNotificationHtml(email, sanitizedName, currentCount),
      }),
    ])

    if (confirmResult.status === 'rejected') console.error('Confirmation email failed:', confirmResult.reason)
    if (ownerResult.status === 'rejected') console.error('Owner notification failed:', ownerResult.reason)
    if (confirmResult.value?.error) console.error('Confirmation email error:', JSON.stringify(confirmResult.value.error))
    if (ownerResult.value?.error) console.error('Owner notification error:', JSON.stringify(ownerResult.value.error))

    return res.status(200).json({ count: currentCount })
  } catch (err) {
    console.error('waitlist-join error:', err)
    return res.status(500).json({ error: 'Interní chyba serveru.' })
  }
}

function confirmationHtml(name) {
  const greeting = name ? `Ahoj ${escapeHtml(name)},` : 'Ahoj,'
  return `<!DOCTYPE html>
<html lang="cs">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Děkujeme za zájem o EstatIQ</title></head>
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

        <!-- Green accent stripe -->
        <tr><td style="height:3px;background:linear-gradient(90deg,#059669,#10b981);"></td></tr>

        <!-- Body -->
        <tr>
          <td style="padding:36px 36px 28px;">
            <p style="margin:0 0 8px;font-size:15px;line-height:1.7;color:#475569;">${greeting}</p>
            <h1 style="margin:0 0 20px;font-size:26px;font-weight:700;color:#0f172a;letter-spacing:-0.01em;">
              Moc ti děkujeme za zájem! ✓
            </h1>
            <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#475569;">
              Jsme startup a teprve chystáme launch. Jakmile EstatIQ spustíme, dáme ti vědět jako jednomu z prvních.
            </p>
            <p style="margin:0 0 28px;font-size:15px;line-height:1.7;color:#475569;">
              Díky za trpělivost — stojí to za to. 🙌
            </p>

            <!-- Info box -->
            <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:18px 22px;">
              <p style="margin:0;font-size:14px;color:#166534;line-height:1.6;">
                Jakmile bude EstatIQ připraveno, pošleme ti e-mail s&nbsp;přímým odkazem. Zdarma, bez závazků.
              </p>
            </div>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:20px 36px 28px;border-top:1px solid #f1f5f9;">
            <p style="margin:0;font-size:13px;color:#94a3b8;line-height:1.6;">
              EstatIQ &middot; Pronájem, který se řídí sám 🇨🇿<br>
              Dostali jste tento e-mail, protože jste se zaregistrovali na waitlistu EstatIQ.
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`
}

function ownerNotificationHtml(email, name, count) {
  const safeEmail = escapeHtml(email)
  const safeName = name ? escapeHtml(name) : '—'
  const now = new Date().toLocaleString('cs-CZ', { timeZone: 'Europe/Prague' })
  return `<!DOCTYPE html>
<html lang="cs">
<head><meta charset="UTF-8"><title>Nový zápis</title></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td align="center" style="padding:40px 20px;">
      <table width="520" cellpadding="0" cellspacing="0" border="0"
        style="max-width:520px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.07);">

        <tr><td style="background:#0b0f19;padding:22px 32px;">
          <span style="font-family:'Helvetica Neue',Arial,sans-serif;font-size:18px;font-weight:700;color:#f8fafc;">
            Estat<span style="color:#10b981;">IQ</span> &mdash; Admin
          </span>
        </td></tr>

        <tr><td style="height:3px;background:#10b981;"></td></tr>

        <tr><td style="padding:28px 32px;">
          <h2 style="margin:0 0 20px;font-size:18px;font-weight:700;color:#0f172a;">
            🎉 Nový zápis na waitlist
          </h2>

          <table width="100%" cellpadding="0" cellspacing="0" border="0"
            style="background:#f8fafc;border-radius:10px;overflow:hidden;">
            <tr>
              <td style="padding:12px 18px;font-size:13px;color:#64748b;font-weight:600;width:30%;border-bottom:1px solid #e2e8f0;">Jméno</td>
              <td style="padding:12px 18px;font-size:14px;color:#0f172a;font-weight:600;border-bottom:1px solid #e2e8f0;">${safeName}</td>
            </tr>
            <tr>
              <td style="padding:12px 18px;font-size:13px;color:#64748b;font-weight:600;width:30%;border-bottom:1px solid #e2e8f0;">E-mail</td>
              <td style="padding:12px 18px;font-size:14px;color:#0f172a;font-weight:600;border-bottom:1px solid #e2e8f0;">${safeEmail}</td>
            </tr>
            <tr>
              <td style="padding:12px 18px;font-size:13px;color:#64748b;font-weight:600;border-bottom:1px solid #e2e8f0;">Čas</td>
              <td style="padding:12px 18px;font-size:14px;color:#0f172a;border-bottom:1px solid #e2e8f0;">${now}</td>
            </tr>
            <tr>
              <td style="padding:12px 18px;font-size:13px;color:#64748b;font-weight:600;">Celkem na listině</td>
              <td style="padding:12px 18px;font-size:18px;font-weight:700;color:#10b981;">${count}</td>
            </tr>
          </table>
        </td></tr>

        <tr><td style="padding:0 32px 24px;">
          <p style="margin:0;font-size:12px;color:#94a3b8;">Automatická notifikace · EstatIQ Prelaunch</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`
}
