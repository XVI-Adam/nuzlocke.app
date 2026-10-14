<script>
  // Preview of how accepting this save updates tracker records. Nothing is
  // written until the player presses Accept on the Sync page.
  import MonIcon from '$lib/components/Unbound/MonIcon.svelte'
  import { locationFor } from '$lib/unbound/locations'

  export let base, // plan without the player's decisions (drives the review list)
    plan, // plan with decisions (what Accept applies)
    tracker,
    choices = {},
    graveyardBox = 24

  const FIELD = { pokemon: 'species', nickname: 'nickname', nature: 'nature' }
  const REASON = {
    'missing-identity': 'save has no PID/trainer ID',
    'duplicate-identity': 'same identity appears twice in the save',
    'invalid-identity': 'malformed link',
    'record-missing': 'tracker record no longer exists',
    'record-claimed-twice': 'two Pokémon linked to one record',
    'species-mismatch': 'record now holds a different species',
    'dead-in-party': 'marked dead in the tracker but in your party',
    'record-not-active': 'record is no longer Captured/Received/Traded/Shiny'
  }

  // Met location from the save, when its id is mapped (a hint only)
  const metOf = (mon) => {
    if (mon.metLocationId == null) return null
    const loc = locationFor(mon.metLocationId)
    return loc.known ? loc : null
  }
  const recordLabel = (key) => {
    const r = tracker[key] || {}
    return `${key}${r.nickname ? ` · ${r.nickname}` : ''}${r.pokemon ? ` (${r.pokemon})` : ''}`
  }
  const monLabel = (m) => (m.nickname === m.species ? m.species : `${m.nickname} (${m.species})`)
  const fmt = (v) => (v === null || v === undefined || v === '' ? '—' : v)

  const choose = (identity, value) => {
    const next = { ...choices }
    if (value === '') delete next[identity]
    else next[identity] = value === '__skip' ? null : value
    choices = next
  }

  $: newLinks = plan.autoLinks
  $: counts = {
    updates: plan.updates.length,
    links: newLinks.length,
    review: base.review.length
  }
</script>

<section class="flex flex-col gap-y-3 text-sm" data-testid="reconcile">
  <h3 class="font-bold">Tracker updates</h3>
  <p class="opacity-75">
    Linked Pokémon get their species, nickname and nature from the save. Encounters, locations, statuses and
    deaths are never changed, and nothing is created or deleted.
  </p>

  {#if !counts.updates && !counts.links && !counts.review && plan.team.status !== 'changed'}
    <p data-testid="reconcile-nothing">Nothing to update in your tracker.</p>
  {/if}

  {#if base.review.length}
    <div class="rounded-lg border-2 border-yellow-500 px-3 py-2" data-testid="reconcile-review">
      <b>Needs your decision</b>
      <p class="text-xs opacity-75">Not linked automatically because the match isn't certain. Unresolved ones are left for later.</p>
      <ul class="mt-1 flex flex-col gap-y-2">
        {#each base.review as r (r.identity)}
          <li class="flex flex-wrap items-center gap-2">
            <MonIcon speciesId={r.mon.speciesId} small />
            <span class="min-w-0">{monLabel(r.mon)} · Lv {r.mon.level} · {r.mon.where}{metOf(r.mon) ? ` · met ${metOf(r.mon).label}${metOf(r.mon).confirmed ? '' : '?'}` : ''}
              <span class="text-xs opacity-60">({r.reason === 'ambiguous' ? 'several possible records' : 'nickname differs'})</span></span>
            <select
              class="h-8 rounded border-2 bg-transparent px-1 text-xs"
              value={choices[r.identity] === null ? '__skip' : choices[r.identity] || ''}
              on:change={(e) => choose(r.identity, e.currentTarget.value)}
              data-testid="reconcile-choice"
            >
              <option value="">Decide later</option>
              {#each r.candidates as c}
                <option value={c.key}>Link to {recordLabel(c.key)}{c.nicknameMatch ? ' ✓ nickname' : ''}{metOf(r.mon)?.key === c.key ? ' ✓ met here' : ''}</option>
              {/each}
              <option value="__skip">Not in my tracker</option>
            </select>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if newLinks.length}
    <div>
      <b>New links</b>
      <ul>
        {#each newLinks as l (l.identity)}
          <li class="flex items-center gap-x-1"><MonIcon speciesId={l.mon.speciesId} small />{monLabel(l.mon)} → {recordLabel(l.key)}
            <span class="text-xs opacity-60">{l.by === 'player' ? '(your choice)' : '(nickname match)'}</span></li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if plan.updates.length}
    <div data-testid="reconcile-updates">
      <b>Record updates</b>
      <ul>
        {#each plan.updates as u (u.key)}
          <li class="flex flex-wrap items-center gap-x-1">
            <MonIcon speciesId={u.mon.speciesId} small /><span class="font-medium">{u.key}</span>:
            {#each Object.entries(u.changes) as [field, c], i}
              <span>{i ? '·' : ''} {FIELD[field]} {fmt(c.from)} → <b>{c.to}</b></span>
            {/each}
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  <div>
    <b>Active team</b>
    {#if plan.team.status === 'changed'}
      <p>{plan.team.from.join(', ') || '—'} → <b>{plan.team.to.join(', ') || '—'}</b></p>
    {:else if plan.team.status === 'unresolved'}
      <p class="opacity-75">Not synced: {plan.team.unresolved.map(monLabel).join(', ')} in your party {plan.team.unresolved.length === 1 ? "isn't" : "aren't"} linked yet.</p>
    {:else}
      <p class="opacity-75">Already matches your party.</p>
    {/if}
  </div>

  {#if plan.possibleDeaths.length}
    <div class="rounded-lg border-2 border-red-500 px-3 py-2">
      <b>Possible deaths</b> (in box {graveyardBox}, still alive in your tracker):
      {plan.possibleDeaths.map((d) => recordLabel(d.key)).join(', ')}
      <p class="text-xs opacity-75">Not applied. Mark them dead in the tracker if they fainted.</p>
    </div>
  {/if}

  {#if plan.conflicts.length}
    <div class="rounded-lg border-2 border-yellow-500 px-3 py-2">
      <b>Left unchanged</b>
      <ul>{#each plan.conflicts as c}<li>{recordLabel(c.key)}: {REASON[c.reason] || c.reason}</li>{/each}</ul>
    </div>
  {/if}

  <details>
    <summary class="cursor-pointer">Other details</summary>
    <ul class="mt-1 flex flex-col gap-y-1 text-xs">
      {#if plan.unmatched.length}<li><b>In save, not in tracker:</b> {plan.unmatched.map((u) => monLabel(u.mon)).join(', ')} <span class="opacity-60">(no records are created)</span></li>{/if}
      {#if plan.skipped.length}<li><b>Marked not in tracker:</b> {plan.skipped.map((u) => monLabel(u.mon)).join(', ')}</li>{/if}
      {#if plan.notFound.length}<li><b>Linked but not in this save:</b> {plan.notFound.map((n) => recordLabel(n.key)).join(', ')} <span class="opacity-60">(unchanged)</span></li>{/if}
      {#if plan.unmappedSpecies.length}<li><b>Species not updated</b> (no matching tracker form): {plan.unmappedSpecies.map((u) => `${u.key} → ${u.species}`).join(', ')}</li>{/if}
      {#if plan.unmatchable.length}<li><b>Can't be matched:</b> {plan.unmatchable.map((u) => `${monLabel(u.mon)} (${REASON[u.reason]})`).join(', ')}</li>{/if}
      {#if plan.staleLinks.length}<li><b>Old links removed:</b> {plan.staleLinks.map((s) => `${s.key} (${REASON[s.reason] || s.reason})`).join(', ')}</li>{/if}
      <li class="opacity-60">{Object.keys(plan.links).length} Pokémon linked to tracker records after accepting.</li>
    </ul>
  </details>
</section>
