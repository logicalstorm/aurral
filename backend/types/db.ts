export interface SettingRow {
  key: string;
  value: string;
}

export interface DiscoveryCacheRow {
  key: string;
  value: string;
  last_updated: string;
}

export interface ImageCacheRow {
  mbid: string;
  image_url: string | null;
  cache_age: number | null;
  created_at: string;
}

export interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  role: string;
  permissions: string | null;
  discover_layout: string | null;
  lastfm_username: string | null;
  listen_history_provider: string | null;
  listen_history_username: string | null;
  listen_history_url: string | null;
  lidarr_root_folder_path: string | null;
  lidarr_quality_profile_id: number | null;
}

export interface SessionRow {
  id: number;
  user_id: number;
  token: string;
  created_at: number;
  expires_at: number;
  ip_address: string | null;
  user_agent: string | null;
}

export interface PlaylistDownloadJobRow {
  id: string;
  artist_name: string;
  track_name: string;
  album_name: string | null;
  reason: string | null;
  artist_mbid: string | null;
  album_mbid: string | null;
  track_mbid: string | null;
  release_year: string | null;
  duration_ms: number | null;
  track_number: number | null;
  album_track_count: number | null;
  album_track_titles: string | null;
  artist_aliases: string | null;
  playlist_id: string;
  playlist_type: string | null;
  status: string;
  staging_path: string | null;
  final_path: string | null;
  error: string | null;
  started_at: number | null;
  completed_at: number | null;
  created_at: number;
  download_source: string | null;
  download_client: string | null;
  download_client_id: string | null;
  release_guid: string | null;
  release_title: string | null;
  indexer_id: string | null;
  indexer_name: string | null;
  slskd_search_id: string | null;
  slskd_batch_id: string | null;
  remote_username: string | null;
  remote_filename: string | null;
  external_path: string | null;
}

export interface DeezerMbidCacheRow {
  cache_key: string;
  mbid: string;
}

export interface MusicbrainzArtistMbidCacheRow {
  artist_name_key: string;
  mbid: string | null;
  updated_at: number;
}

export interface ArtistOverrideRow {
  mbid: string;
  musicbrainz_id: string | null;
  deezer_artist_id: string | null;
  updated_at: number | null;
}

export interface AurralHistoryRow {
  id: string;
  kind: string;
  title: string;
  subtitle: string | null;
  status: string;
  status_label: string | null;
  href: string | null;
  metadata: string | null;
  created_at: number;
}

export interface SlskdTransferHistoryRow {
  id: string;
  job_id: string | null;
  username: string;
  remote_filename: string | null;
  transfer_id: string | null;
  search_id: string | null;
  batch_id: string | null;
  status: string;
  reason: string | null;
  score: number | null;
  artist_name: string | null;
  track_name: string | null;
  album_name: string | null;
  source_path: string | null;
  final_path: string | null;
  actual_duration_ms: number | null;
  created_at: number;
  cleaned_at: number | null;
}

export interface HonkerTaskRunRow {
  id: number;
  job_id: number;
  queue: string;
  name: string | null;
  payload: string | null;
  worker_id: string | null;
  attempt: number | null;
  status: string;
  error: string | null;
  queued_at: number | null;
  run_at: number | null;
  started_at: number;
  ended_at: number | null;
  duration_ms: number | null;
  created_at: number;
}

export interface CountRow {
  count: number;
}
