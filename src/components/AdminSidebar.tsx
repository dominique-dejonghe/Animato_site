import type { FC } from 'hono/jsx'

interface AdminSidebarProps {
  activeSection?: string
  pendingRegistrationsCount?: number
  isBestuurslid?: boolean  // Show board-only items (override)
  userRole?: string        // User role for board access check
}

export const AdminSidebar: FC<AdminSidebarProps> = ({ 
  activeSection = 'dashboard', 
  pendingRegistrationsCount = 0,
  isBestuurslid = false,
  userRole = ''
}) => {
  // Access tiers:
  //  - admin/moderator → ziet alles
  //  - bestuurslid (zonder admin role) → ziet alleen bestuurssecties (boardOnly + altijd-zichtbare items)
  //  - default fallback (geen userRole doorgegeven) → toon alles, voor backwards compatibility
  const isFullAdmin = !userRole || userRole === 'admin' || userRole === 'moderator'
  const hasBoardAccess = isFullAdmin || isBestuurslid

  // bestuurOnly = true → alleen voor bestuursleden / admin / moderator (verborgen voor anderen)
  // adminOnly   = true → strikt admin-only sub-secties: niet zichtbaar voor pure bestuursleden
  const allLinks = [
    { id: 'dashboard', label: 'Dashboard', href: '/admin', icon: 'fas fa-tachometer-alt' },
    { id: 'leden', label: 'Leden', href: '/admin/leden', icon: 'fas fa-users', badge: pendingRegistrationsCount > 0 ? pendingRegistrationsCount : undefined, adminOnly: true },
    { id: 'verjaardagen', label: 'Verjaardagslijst', href: '/leden/verjaardagen', icon: 'fas fa-birthday-cake' },
    { id: 'content', label: 'Nieuws & Berichten', href: '/admin/content', icon: 'fas fa-newspaper', adminOnly: true },
    { id: 'ai-news', label: 'AI Nieuwsgenerator', href: '/admin/ai-nieuws', icon: 'fas fa-robot', adminOnly: true },
    { id: 'events', label: 'Agenda & Activiteiten', href: '/admin/events', icon: 'fas fa-calendar-alt', adminOnly: true },
    { id: 'tickets', label: 'Ticketbeheer', href: '/admin/tickets', icon: 'fas fa-ticket-alt', adminOnly: true },
    { id: 'attendance', label: 'Aanwezigheid & Streaks', href: '/admin/attendance', icon: 'fas fa-qrcode', adminOnly: true },
    { id: 'seating', label: 'Zaalplannen', href: '/admin/seating', icon: 'fas fa-chair', adminOnly: true },
    { id: 'finance', label: 'Financiën & Lidgeld', href: '/admin/lidgelden', icon: 'fas fa-euro-sign', adminOnly: true },
    // #117: 'Communicatie' wegens niet-gebruikt verborgen — routes blijven bestaan
    // { id: 'communications', label: 'Communicatie', href: '/admin/communicatie', icon: 'fas fa-envelope' },
    { id: 'meetings', label: 'Vergaderingen', href: '/admin/meetings', icon: 'fas fa-handshake', boardOnly: true },
    { id: 'projects', label: 'Projecten', href: '/admin/projects', icon: 'fas fa-project-diagram', boardOnly: true },
    { id: 'prints', label: 'Printservice', href: '/admin/prints', icon: 'fas fa-print', adminOnly: true },
    { id: 'materials', label: 'Oefenmateriaal', href: '/admin/bestanden', icon: 'fas fa-music', adminOnly: true },
    { id: 'photos', label: "Foto's & Video's", href: '/admin/fotoboek', icon: 'fas fa-images', adminOnly: true },
    { id: 'modules', label: 'Module Beheer', href: '/admin/modules', icon: 'fas fa-toggle-on', adminOnly: true },
    { id: 'analytics', label: 'Analytics & Statistieken', href: '/admin/analytics', icon: 'fas fa-chart-bar', adminOnly: true },
    { id: 'feedback', label: 'Beta Feedback', href: '/admin/feedback', icon: 'fas fa-bug', adminOnly: true },
    { id: 'walkthrough', label: 'Walkthrough Tours', href: '/admin/walkthrough', icon: 'fas fa-route', adminOnly: true },
    { id: 'settings', label: 'Instellingen', href: '/admin/settings', icon: 'fas fa-cogs', adminOnly: true },
  ]

  // Filter:
  //  - boardOnly: alleen voor bestuur+ (admin/mod/bestuurslid)
  //  - adminOnly: alleen voor admin/moderator, NIET voor pure bestuursleden
  const links = allLinks.filter(link => {
    if ((link as any).boardOnly && !hasBoardAccess) return false
    if ((link as any).adminOnly && !isFullAdmin) return false
    return true
  })

  return (
    <aside class="w-64 bg-animato-secondary text-white hidden md:block flex-shrink-0 min-h-screen">
      <div class="p-6">
        <h2 class="text-2xl font-bold" style="font-family: 'Playfair Display', serif;">Admin</h2>
      </div>
      <nav class="mt-4 px-4 space-y-1">
        {links.map(link => {
          const isActive = activeSection === link.id
          return (
            <a
              href={link.href}
              class={`block py-2.5 px-4 rounded-lg transition-all flex items-center justify-between ${
                isActive
                  ? 'bg-white text-animato-secondary font-bold shadow-md'
                  : 'text-white hover:bg-white hover:bg-opacity-15'
              }`}
            >
              <div class="flex items-center">
                <i class={`${link.icon} w-6 mr-2.5 text-center ${isActive ? 'text-animato-secondary' : 'text-white text-opacity-80'}`}></i>
                <span class={isActive ? 'text-animato-secondary' : ''}>{link.label}</span>
                {link.boardOnly && (
                  <i class="fas fa-shield-alt text-xs ml-1.5 text-yellow-300 opacity-70" title="Alleen bestuur"></i>
                )}
              </div>
              {link.badge && (
                <span class="bg-blue-500 text-white text-xs font-bold px-2 py-0.5 rounded-full shadow-sm">
                  {link.badge}
                </span>
              )}
              {isActive && (
                <i class="fas fa-chevron-right text-xs text-animato-secondary ml-1"></i>
              )}
            </a>
          )
        })}
      </nav>
    </aside>
  )
}
