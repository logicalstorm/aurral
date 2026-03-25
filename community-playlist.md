# Community Playlists

Community Playlists are static playlists imported from JSON.

- **Flows** are recommended playlists that refresh weekly
- **Playlists** are static tracklists created from exported JSON or hand-written JSON
- Imported *playlists* stay separate from weekly *flow* refreshes
- Imported *playlists* use the same Soulseek download worker, but they retry the exact imported tracks rather than generating replacements

## What the importer accepts

The importer accepts four JSON shapes:

1. An exported Aurral playlist file
2. A single playlist object with a `tracks` array
3. A raw array of tracks
4. A bundle object with a `playlists` array

## Required track fields

Each track must include:

- `artistName`
- `trackName`

Accepted aliases:

- artist: `artistName`, `artist`, `artist_name`
- track: `trackName`, `title`, `name`, `track`
- album: `albumName`, `album`
- artist id: `artistMbid`, `artistId`, `mbid`

## Accepted JSON examples

### 1. Exported Aurral playlist file

```json
{
  "type": "aurral-static-tracklist",
  "version": 1,
  "exportedAt": "2026-03-25T12:00:00.000Z",
  "name": "Late Night Finds",
  "sourceName": "Friday Flow",
  "sourceFlowId": "abc123",
  "trackCount": 2,
  "tracks": [
    {
      "artistName": "Burial",
      "trackName": "Archangel",
      "albumName": "Untrue",
      "artistMbid": null
    },
    {
      "artistName": "Four Tet",
      "trackName": "Two Thousand and Seventeen",
      "albumName": null,
      "artistMbid": null
    }
  ]
}
```

### 2. Single playlist object

```json
{
  "name": "My Playlist",
  "tracks": [
    { "artistName": "Massive Attack", "trackName": "Teardrop" },
    { "artistName": "Portishead", "trackName": "Roads" }
  ]
}
```

### 3. Raw array of tracks

```json
[
  { "artistName": "Burial", "trackName": "Archangel" },
  { "artistName": "Air", "trackName": "La Femme d'Argent" }
]
```

### 4. Multi-playlist bundle

```json
{
  "playlists": [
    {
      "name": "Warm",
      "tracks": [
        { "artistName": "Bonobo", "trackName": "Kiara" }
      ]
    },
    {
      "name": "Dark",
      "tracks": [
        { "artistName": "Burial", "trackName": "Near Dark" }
      ]
    }
  ]
}
```

### 5. Nested playlist wrapper

```json
{
  "playlist": {
    "name": "Imported Set",
    "tracks": [
      { "artistName": "Air", "trackName": "La Femme d'Argent" }
    ]
  }
}
```

## Notes

- A top-level array of track objects is treated as one playlist
- A top-level array of playlist objects is treated as multiple playlists
- If a playlist name conflicts with an existing imported playlist, Aurral renames it automatically
- Imported playlists queue their own downloads and do not change any flow configuration
- Flows can generate replacement tracks when they come up short
- Imported playlists retry the same tracks from the JSON and do not generate replacements

## Invalid input examples

These will fail import:

- objects with no `tracks` array
- tracks missing artist or title