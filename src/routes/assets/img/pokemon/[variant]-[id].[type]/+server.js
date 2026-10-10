// Sprites are proxied from PokeAPI's GitHub rather than bundled from the
// `pokemon-sprites` git dependency (a ~17GB repo that npm clones on install).
const SPRITES = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon'

export async function GET({ params, fetch }) {
  const { id, variant } = params
  const path = variant === 'shiny' ? `shiny/${id}` : id

  const res = await fetch(`${SPRITES}/${path}.png`)
  if (!res.ok) return new Response(null, { status: 404 })

  return new Response(await res.arrayBuffer(), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=86400, s-maxage=31536000, immutable'
    }
  })
}
