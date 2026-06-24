import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL)

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  try {
    const [{ count }] = await sql`SELECT COUNT(*) AS count FROM waitlist`
    return res.status(200).json({ count: Number(count) })
  } catch {
    return res.status(200).json({ count: 0 })
  }
}
