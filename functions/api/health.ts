export const onRequestGet: PagesFunction = async () =>
  Response.json({ ok: true, time: new Date().toISOString() })
