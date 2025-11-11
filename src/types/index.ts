// Type definitions voor Animato Koor Website

import type { D1Database } from '@cloudflare/workers-types'

// =====================================================
// ENVIRONMENT BINDINGS
// =====================================================

export type Bindings = {
  DB: D1Database
  // R2: R2Bucket // Uncomment wanneer R2 toegevoegd wordt
  JWT_SECRET: string
  SESSION_SECRET: string
  RESEND_API_KEY: string
  STRIPE_SECRET_KEY: string
  STRIPE_PUBLISHABLE_KEY: string
  STRIPE_WEBHOOK_SECRET: string
  SITE_URL: string
  ADMIN_EMAIL: string
}

// =====================================================
// USER & AUTHENTICATION
// =====================================================

export type UserRole = 'admin' | 'moderator' | 'stemleider' | 'lid' | 'bezoeker'
export type Stemgroep = 'S' | 'A' | 'T' | 'B'
export type UserStatus = 'actief' | 'inactief' | 'proeflid' | 'uitgenodigd'

export interface User {
  id: number
  email: string
  password_hash: string
  role: UserRole
  stemgroep: Stemgroep | null
  status: UserStatus
  two_fa_enabled: boolean
  two_fa_secret: string | null
  email_verified: boolean
  last_login_at: string | null
  created_at: string
  updated_at: string
}

export interface Profile {
  id: number
  user_id: number
  voornaam: string
  achternaam: string
  telefoon: string | null
  adres: string | null
  postcode: string | null
  stad: string | null
  geboortedatum: string | null
  foto_url: string | null
  bio: string | null
  muzikale_ervaring: string | null
  instrument: string | null
  noodcontact_naam: string | null
  noodcontact_telefoon: string | null
}

export interface UserWithProfile extends User {
  profile: Profile | null
}

export interface SessionUser {
  id: number
  email: string
  role: UserRole
  stemgroep: Stemgroep | null
  voornaam: string
  achternaam: string
}

// =====================================================
// CONTENT
// =====================================================

export type PostType = 'nieuws' | 'board'
export type PostCategorie = 'algemeen' | 'sopraan' | 'alt' | 'tenor' | 'bas' | 'bestuur'
export type PostZichtbaarheid = 'publiek' | 'leden' | 'sopraan' | 'alt' | 'tenor' | 'bas'

export interface Post {
  id: number
  titel: string
  slug: string
  body: string
  excerpt: string | null
  auteur_id: number
  type: PostType
  categorie: PostCategorie | null
  tags: string | null // JSON array
  is_pinned: boolean
  is_published: boolean
  zichtbaarheid: PostZichtbaarheid
  views: number
  published_at: string | null
  created_at: string
  updated_at: string
}

export interface PostWithAuteur extends Post {
  auteur_voornaam: string
  auteur_achternaam: string
  auteur_foto_url: string | null
}

export interface PostReply {
  id: number
  post_id: number
  parent_reply_id: number | null
  auteur_id: number
  body: string
  is_deleted: boolean
  created_at: string
  updated_at: string
}

// =====================================================
// EVENTS & AGENDA
// =====================================================

export type EventType = 'repetitie' | 'concert' | 'ander'
export type AttendanceStatus = 'aanwezig' | 'afwezig' | 'misschien' | 'onbekend'

export interface Event {
  id: number
  type: EventType
  titel: string
  slug: string | null
  beschrijving: string | null
  start_at: string
  end_at: string
  locatie: string
  adres: string | null
  doelgroep: string // 'all', 'S', 'A', 'T', 'B', 'SA', 'TB', etc.
  is_publiek: boolean
  herinnering_verzonden: boolean
  ics_uid: string | null
  created_at: string
  updated_at: string
}

export interface EventAttendance {
  id: number
  event_id: number
  user_id: number
  status: AttendanceStatus
  reden: string | null
  responded_at: string | null
  created_at: string
  updated_at: string
}

// =====================================================
// CONCERTS & TICKETING
// =====================================================

export type TicketStatus = 'pending' | 'paid' | 'cancelled' | 'refunded' | 'used'

export interface Concert {
  id: number
  event_id: number
  programma: string | null
  prijsstructuur: string | null // JSON array
  capaciteit: number | null
  verkocht: number
  ticketing_enabled: boolean
  ticketing_provider: 'intern' | 'extern'
  externe_ticket_url: string | null
  uitverkocht: boolean
  poster_url: string | null
}

export interface Ticket {
  id: number
  concert_id: number
  order_ref: string
  koper_email: string
  koper_naam: string
  koper_telefoon: string | null
  aantal: number
  categorie: string
  prijs_totaal: number
  status: TicketStatus
  betaalmethode: string | null
  betaling_id: string | null
  qr_code: string
  gescand: boolean
  gescand_at: string | null
  betaald_at: string | null
  created_at: string
}

// =====================================================
// MUSIC & MATERIALS
// =====================================================

export interface Work {
  id: number
  componist: string
  titel: string
  beschrijving: string | null
  jaar: number | null
  genre: string | null
  created_at: string
}

export interface Piece {
  id: number
  work_id: number
  titel: string
  nummer: number | null
  opustype: string | null
  toonsoort: string | null
  tempo: string | null
  duur_minuten: number | null
  moeilijkheidsgraad: 'beginner' | 'gemiddeld' | 'gevorderd' | 'expert' | null
  opmerking: string | null
  created_at: string
}

export type MaterialType = 'pdf' | 'audio' | 'video' | 'zip' | 'link'
export type MaterialStem = 'S' | 'A' | 'T' | 'B' | 'SA' | 'TB' | 'SATB' | 'piano' | 'orgel' | 'algemeen'

export interface Material {
  id: number
  piece_id: number
  stem: MaterialStem
  type: MaterialType
  titel: string
  bestandsnaam: string | null
  url: string
  mime_type: string | null
  grootte_bytes: number | null
  versie: number
  zichtbaar_voor: 'alle_leden' | 'stem_specifiek' | 'admin'
  beschrijving: string | null
  upload_door: number
  is_actief: boolean
  created_at: string
}

// =====================================================
// MEDIA & ALBUMS
// =====================================================

export interface Album {
  id: number
  titel: string
  slug: string
  beschrijving: string | null
  cover_url: string | null
  is_publiek: boolean
  event_id: number | null
  sorteer_volgorde: number
  created_at: string
}

export interface Photo {
  id: number
  album_id: number
  url: string
  thumbnail_url: string | null
  caption: string | null
  tags: string | null // JSON array
  mime_type: string | null
  grootte_bytes: number | null
  breedte: number | null
  hoogte: number | null
  upload_door: number
  sorteer_volgorde: number
  created_at: string
}

// =====================================================
// FORMS & SUBMISSIONS
// =====================================================

export type FormType = 'word_lid' | 'contact' | 'ander'

export interface FormSubmission {
  id: number
  type: FormType
  payload: string // JSON
  email: string | null
  naam: string | null
  status: 'nieuw' | 'verwerkt' | 'gearchiveerd'
  consent: boolean
  ip_adres: string | null
  user_agent: string | null
  verwerkt_door: number | null
  verwerkt_at: string | null
  notities: string | null
  created_at: string
}

// =====================================================
// SYSTEM
// =====================================================

export interface Setting {
  id: number
  key: string
  value: string
  type: 'string' | 'number' | 'boolean' | 'json'
  beschrijving: string | null
  updated_at: string
}

export interface AuditLog {
  id: number
  user_id: number | null
  actie: string
  entity_type: string
  entity_id: number | null
  meta: string | null // JSON
  ip_adres: string | null
  user_agent: string | null
  created_at: string
}

export interface Notification {
  id: number
  user_id: number
  type: 'nieuws' | 'materiaal' | 'repetitie' | 'concert' | 'board' | 'systeem'
  titel: string
  body: string | null
  link: string | null
  is_gelezen: boolean
  gelezen_at: string | null
  created_at: string
}
