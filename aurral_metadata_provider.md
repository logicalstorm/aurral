**Purpose and Constraints**  
- Build a standalone Aurral Metadata Provider for a Cloudflare Worker + D1 database.  
- It must be MBID-first and never use artist name lookups.  
- It must only store fields currently used by Aurral. If a field is not used today, it must not be stored.  
- It must not include any Last.fm-derived fields.  
- It must not host or cache image binaries. It only prebuilds Cover Art Archive links.

**Inputs and Outputs**  
- Inputs: Artist MBID, Release MBID, Release Group MBID.  
- Outputs: Minimal metadata fields listed below plus prebuilt Cover Art Archive links.  
- Required behavior: return stable, deterministic results for the same MBID.

**Minimal Data to Keep (Only What Aurral Uses Today)**  
- Artist: mbid, name.  
- Release Group: mbid, title, artist_credit_id, canonical_release_mbid.  
- Release: mbid, title, release_group_mbid, artist_credit_id.  
- Artist Credit: credit_id, artist_mbid, name, join_phrase, position.  
- Relationships: Only those required to map artist → release_group → release.  
- Images: Prebuilt Cover Art Archive URLs for releases and release_groups.

**Explicitly Not Kept**  
- Tags, related artists, biographies, listener counts, or any fields sourced from Last.fm.  
- Any artist demographics, dates, countries, labels, barcodes, or status fields not currently used by Aurral.  
- Any locally hosted image binaries.  
- Any extra MusicBrainz metadata not required by the fields listed above.

**Ingestion Plan (MB Dump → D1)**  
- Import the MusicBrainz PostgreSQL dump into staging.  
- Extract only the required rows into a slim “Aurral Metadata DB” model.  
- Tables needed in staging:  
  - artist  
  - artist_credit  
  - artist_credit_name  
  - release_group  
  - release  
  - release_group_release (or equivalent join)  
- Create a deterministic mapping for “canonical_release_mbid” per release_group:  
  - Prefer official status, earliest date, or first import order.  
- Precompute Cover Art Archive links for release and release_group.  
- Export the slim dataset into Cloudflare D1 on a weekly schedule.

**Update Strategy**  
- Provider rebuilds weekly from the latest MB dump.  
- No live MusicBrainz API calls are used in production requests.  
- Recompute canonical_release_mbid during each weekly rebuild.

**Cover Art Archive Strategy**  
- Precompute CAA URLs for each release and release_group during the weekly build.  
- Store only the prebuilt URLs in D1.  
- Clients receive direct CAA URLs and never build links on-device.  

**CAA URL Rules**  
- Release: https://coverartarchive.org/release/{mbid}/front-500  
- Release Group: https://coverartarchive.org/release-group/{mbid}/front-500  
- If a canonical_release_mbid exists for a release_group, return both release-group and release URLs.  
- If no canonical_release_mbid exists, return only the release-group URL.

**API Surface (Aurral Metadata Provider)**  
- Read-only endpoints keyed by MBID:  
  - /artist/{mbid} → artist + image URLs  
  - /release-group/{mbid} → release_group + cover art URL(s)  
  - /release/{mbid} → release + cover art URL  
- Optional batch endpoint for prefetching:  
  - /batch?artist_mbid=…&release_group_mbid=…  
- Responses contain only the minimal fields listed above.

**Response Shape (Required)**  
- Artist response: { mbid, name, images: { release_group, release } }  
- Release Group response: { mbid, title, artist_credit: [...], images: { release_group, release } }  
- Release response: { mbid, title, release_group_mbid, artist_credit: [...], images: { release } }

**Performance & UX**  
- MBID-first lookups are constant-time from D1.  
- Cache metadata responses at the Cloudflare edge for fast repeated access.  
- No client-side link construction for cover art.

**Infrastructure Components**  
- Ingestion service: imports dump, builds the slim dataset, writes to D1 weekly.  
- Metadata API: Cloudflare Worker serving D1 with low latency.  
- Observability: track rebuild success/failure and D1 query latency.

**Rollout Plan**  
- Phase 1: Build slim DB and metadata API (MBID-only).  
- Phase 2: Precompute CAA links in weekly builds.  
- Phase 3: Switch UI to MBID-first resolution and remove Deezer/Last.fm for images.  

**Deliverables for the New Agent**  
- Cloudflare Worker code for the metadata API.  
- D1 schema and migration files.  
- Ingestion pipeline that produces the weekly D1 dataset.  
- A build script that runs weekly and replaces D1 data atomically.  
- A short validation script that checks a sample of MBIDs and URLs.
